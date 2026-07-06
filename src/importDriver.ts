// ZTB-14 dev/37: the multi-input driver for `ztrack import <path-or-glob>...` — expands a mix of
// files/directories/quoted globs into the concrete `.md` files to import (recursive, with default
// excludes), runs ONE batch-wide, single-pass id allocation across all of them (plus every already
// configured tracker source), and reports a per-file outcome. `--register` (opt-in) is the only
// thing that ever touches `.volter/tracker-config.json`, and only by APPENDING `sources` entries.
//
// Pure orchestration — no CLI flag parsing or terminal rendering here (that's src/cliImport.ts).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseMarkdownDocumentSource } from './documentParser.ts';
import { markdownStoreDir } from './config.ts';
import { existingIdsInFile, IdAllocator, planAndMaterialize, type ImportPlan } from './importBacklog.ts';
import { resolveSources, type ResolvedSource } from './sources.ts';
import type { TrackerSourceConfig } from './types.ts';
import { parseTrackerConfig } from './configSchema.ts';

// ── input expansion (files / directories / quoted globs) ───────────────────────────────────────

const DEFAULT_EXCLUDE_SEGMENTS = new Set(['node_modules', '.volter']);
const GLOB_META = /[*?[\]{}]/;

function isGlobPattern(p: string): boolean {
  return GLOB_META.test(p);
}

/** `**`-aware glob -> RegExp over an ABSOLUTE, `/`-separated path. `**` matches zero or more whole
 *  path segments (including none, so `a/**\/b.md` matches `a/b.md` too); `*` matches within one
 *  segment; `?` matches one non-separator character. Hand-rolled: no glob dependency is declared
 *  (package.json), and the shipped CLI is bundled `--target=node` (dist/cli.js), so a Bun-only
 *  glob API is not available at runtime either. */
function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') i++;
      out += '(?:.*/)?';
      continue;
    }
    if (c === '*') { out += '[^/]*'; continue; }
    if (c === '?') { out += '[^/]'; continue; }
    if ('.+^$()|[]{}\\'.includes(c)) { out += `\\${c}`; continue; }
    out += c;
  }
  return new RegExp(`^${out}$`);
}

function isExcludedPath(absPath: string, excludeDirs: readonly string[]): boolean {
  const segments = absPath.split(sep);
  if (segments.some((s) => DEFAULT_EXCLUDE_SEGMENTS.has(s))) return true;
  return excludeDirs.some((dir) => absPath === dir || absPath.startsWith(`${dir}${sep}`));
}

/** Recursively collect every `.md` file under `root`, skipping default-excluded directories and
 *  any directory already covered by a configured `issue-per-file` source. */
function walkMarkdownFiles(root: string, excludeDirs: readonly string[], out: string[]): void {
  if (!existsSync(root)) return;
  const st = statSync(root);
  if (st.isFile()) {
    if (root.toLowerCase().endsWith('.md') && !isExcludedPath(root, excludeDirs)) out.push(root);
    return;
  }
  if (!st.isDirectory()) return;
  if (isExcludedPath(root, excludeDirs)) return;
  for (const entry of readdirSync(root)) {
    const full = resolve(root, entry);
    const entrySt = (() => { try { return statSync(full); } catch { return null; } })();
    if (!entrySt) continue;
    if (entrySt.isDirectory()) {
      if (DEFAULT_EXCLUDE_SEGMENTS.has(entry) || isExcludedPath(full, excludeDirs)) continue;
      walkMarkdownFiles(full, excludeDirs, out);
    } else if (entrySt.isFile() && entry.toLowerCase().endsWith('.md')) {
      if (!isExcludedPath(full, excludeDirs)) out.push(full);
    }
  }
}

function resolvedSourcesOrEmpty(projectRoot: string, config: { sources?: TrackerSourceConfig[] }): ResolvedSource[] {
  try { return resolveSources(projectRoot, config); } catch { return []; }
}

/** Directories of every configured `issue-per-file` source — one of the default excludes (Design
 *  point 0): importing a directory that's already a one-issue-per-file store makes no sense (those
 *  files are individually canonical already, not a freeform backlog). */
export function issuePerFileSourceDirs(projectRoot: string, config: { sources?: TrackerSourceConfig[] }): string[] {
  return resolvedSourcesOrEmpty(projectRoot, config).filter((s) => s.format === 'issue-per-file').map((s) => s.dir);
}

/** Expand `patterns` (files, directories, or quoted globs) into a sorted, de-duplicated list of
 *  absolute `.md` file paths, applying the default excludes. Throws if a literal (non-glob) path
 *  doesn't exist. */
export function expandInputs(patterns: readonly string[], cwd: string, excludeDirs: readonly string[]): string[] {
  const out = new Set<string>();
  for (const pattern of patterns) {
    if (!isGlobPattern(pattern)) {
      const abs = isAbsolute(pattern) ? pattern : resolve(cwd, pattern);
      if (!existsSync(abs)) throw new Error(`ztrack import: no such file or directory: ${pattern}`);
      const collected: string[] = [];
      walkMarkdownFiles(abs, excludeDirs, collected);
      for (const f of collected) out.add(f);
      continue;
    }
    const abs = isAbsolute(pattern) ? pattern : resolve(cwd, pattern);
    const posix = abs.split(sep).join('/');
    const segments = posix.split('/');
    let rootSegs: string[] = [];
    for (const seg of segments) { if (GLOB_META.test(seg)) break; rootSegs.push(seg); }
    const root = rootSegs.join('/') || '/';
    const regex = globToRegExp(posix);
    const collected: string[] = [];
    walkMarkdownFiles(root, excludeDirs, collected);
    for (const f of collected) if (regex.test(f.split(sep).join('/'))) out.add(f);
  }
  return [...out].sort();
}

// ── batch-wide id allocation seed (collision-safe across every already-configured source) ─────

function mdIds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
}

/** Every issue id already present anywhere in the configured tracker (both `issue-per-file` and
 *  `document` sources) — used to seed the batch's `IdAllocator` so a freshly minted id can never
 *  collide with one that already exists ANYWHERE, not just within the files being imported. */
export function collectConfiguredIds(projectRoot: string, config: { sources?: TrackerSourceConfig[] }): string[] {
  const ids: string[] = [];
  for (const source of resolvedSourcesOrEmpty(projectRoot, config)) {
    if (source.format === 'issue-per-file') { ids.push(...mdIds(source.dir)); continue; }
    if (!existsSync(source.dir)) continue;
    try {
      const text = readFileSync(source.dir, 'utf8');
      for (const issue of parseMarkdownDocumentSource(text, source.dir)) ids.push(issue.id);
    } catch { /* unreadable/unparseable configured source — not this command's problem to fix */ }
  }
  return ids;
}

// ── prefix inference (Design point 2) ───────────────────────────────────────────────────────────

const HEADING_ID_RE = /^#{1,6}\s+([A-Za-z][A-Za-z0-9-]*)-[A-Za-z0-9]+\b/m;

/** `--prefix` else inferred from an id already present in the file's HEADINGS (headings ONLY —
 *  a prose line is not an id: an any-line fallback matched ordinary hyphenated words, so a
 *  preamble like "Follow-up items are tracked below." inferred the bogus prefix "Follow" and
 *  shadowed the configured teamKey) else the tracker config's `local.teamKey` else `null`
 *  (caller must report a clear error asking for --prefix). */
export function resolveIssuePrefix(text: string, explicit: string | undefined, teamKey: string | undefined): string | null {
  if (explicit) return explicit;
  const fromHeading = HEADING_ID_RE.exec(text);
  if (fromHeading) return fromHeading[1]!;
  if (teamKey) return teamKey;
  return null;
}

// ── batch run ────────────────────────────────────────────────────────────────────────────────────

export type FileOutcome =
  | { kind: 'materialized'; path: string; plan: ImportPlan; before: string; after: string }
  | { kind: 'noop'; path: string; plan: ImportPlan }
  | { kind: 'skipped'; path: string; reason: string };

export interface BatchOptions {
  prefix?: string;
  teamKey?: string;
  allocator: IdAllocator;
  /** false (--dry-run): plan only, never touch disk. */
  write: boolean;
}

/** Run the import over an already-expanded, deterministically ORDERED file list — single pass,
 *  one shared allocator (so numbering is collision-safe across the whole batch), one outcome per
 *  file. Files are processed in the given order; callers wanting reproducible numbering should
 *  pass a stable (e.g. sorted) order — `expandInputs` already sorts. */
export function runImportBatch(files: readonly string[], opts: BatchOptions): FileOutcome[] {
  const outcomes: FileOutcome[] = [];
  const texts = new Map<string, string>();
  const unreadable = new Map<string, string>();
  for (const path of files) {
    try { texts.set(path, readFileSync(path, 'utf8')); }
    catch (e) { unreadable.set(path, e instanceof Error ? e.message : String(e)); }
  }
  // Mandatory PRE-PASS (see existingIdsInFile's doc comment): note every id already present in
  // EVERY file of the batch before any file's minting runs, so single-pass allocation is
  // collision-safe regardless of processing order.
  for (const text of texts.values()) for (const id of existingIdsInFile(text)) opts.allocator.note(id);

  for (const path of files) {
    const text = texts.get(path);
    if (text === undefined) {
      outcomes.push({ kind: 'skipped', path, reason: `cannot read file (${unreadable.get(path)})` });
      continue;
    }
    const prefix = resolveIssuePrefix(text, opts.prefix, opts.teamKey);
    if (!prefix) {
      outcomes.push({ kind: 'skipped', path, reason: 'cannot infer an id prefix (no existing id in the file, no --prefix, no configured teamKey) — pass --prefix <ID-PREFIX>' });
      continue;
    }
    let plan: ImportPlan;
    let materialized: string;
    try {
      ({ plan, materialized } = planAndMaterialize(text, path, { prefix, allocator: opts.allocator }));
    } catch (e) {
      outcomes.push({ kind: 'skipped', path, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (plan.issues.length === 0) {
      outcomes.push({ kind: 'skipped', path, reason: 'nothing importable — no heading, checkbox, or TODO: item found' });
      continue;
    }
    if (plan.isNoop) {
      outcomes.push({ kind: 'noop', path, plan });
      continue;
    }
    if (opts.write) writeFileSync(path, materialized);
    outcomes.push({ kind: 'materialized', path, plan, before: text, after: materialized });
  }
  return outcomes;
}

// ── --register: append exactly the printed `sources` entries, never duplicating ────────────────

export interface RegisterPlan {
  configPath: string;
  /** Entries that would be appended — empty if every file is already a declared source. */
  toAdd: TrackerSourceConfig[];
}

/** Compute (never write) which `sources` entries `--register` would append for the given
 *  materialized/no-op file paths: one `{path, format:"document"}` per file NOT already present in
 *  `config.sources` (by resolved absolute path, so a differently-spelled but equivalent path is
 *  still recognized as a duplicate).
 *
 *  PINNED SAFETY DECISION: declaring ANY explicit `sources` entry turns OFF the implicit
 *  "no `sources:` key means one default issue-per-file store" fallback (src/sources.ts —
 *  pre-existing behavior, not introduced here). If `config.sources` is absent/empty, registering
 *  a document source alone would therefore silently stop the tracker from reading its pre-existing
 *  default store. So when there's nothing declared yet, the default store's own entry is added
 *  FIRST — still additive (nothing removed), and still fully visible: it's part of the SAME
 *  printed/appended list `--register` (or the without-`--register` hint) shows, never a hidden
 *  mutation. */
export function planRegister(projectRoot: string, config: { sources?: TrackerSourceConfig[] }, filePaths: readonly string[]): TrackerSourceConfig[] {
  return planEntries(projectRoot, config, filePaths, (relPath) => ({ path: relPath, format: 'document' }));
}

/** Plan `--register --dialect <name>` (docs/DIALECTS.md): one `{dialect, path}` entry per file —
 *  a read-only LENS declaration, config-only by definition (the file itself is never rewritten
 *  on this path; `resolveSources` forces the lens readonly). Same default-store preservation and
 *  duplicate-path de-dupe as `planRegister` above. */
export function planDialectRegister(projectRoot: string, config: { sources?: TrackerSourceConfig[] }, filePaths: readonly string[], dialectName: string): TrackerSourceConfig[] {
  return planEntries(projectRoot, config, filePaths, (relPath) => ({ dialect: dialectName, path: relPath }));
}

/** The declared-lens subset of `filePaths` (docs/DIALECTS.md WP6): absolute file path -> the
 *  ResolvedSource whose `dialect` reads it. These files take the MATERIALIZE-upgrade path in
 *  `ztrack import` (dialect parse -> native grammar + config-entry upgrade), never the freeform
 *  heuristics — the registered dialect already says exactly what the file means. */
export function registeredLensSources(projectRoot: string, config: { sources?: TrackerSourceConfig[] }, filePaths: readonly string[]): Map<string, ResolvedSource> {
  const byDir = new Map(resolvedSourcesOrEmpty(projectRoot, config).filter((s) => s.dialect).map((s) => [s.dir, s]));
  const out = new Map<string, ResolvedSource>();
  for (const path of filePaths) {
    const source = byDir.get(path);
    if (source) out.set(path, source);
  }
  return out;
}

/** Upgrade one source's config entry after its file was materialized (docs/DIALECTS.md WP6):
 *  `dialect` and `readonly` drop (the file now speaks the native grammar and is writable within
 *  the document source's own rules), `path`/`format`/`name` survive, and the id renames the
 *  materialization performed are recorded as `aliases` (old -> new) so references keep
 *  resolving. Same fail-loudly validation discipline as `applyRegister` below. */
export function applyMaterializeUpgrade(configPath: string, projectRoot: string, absPath: string, aliases: Record<string, string>): void {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`materialize: config at ${configPath} is not valid JSON: ${(error as Error).message}`);
  }
  let raw: ReturnType<typeof parseTrackerConfig>;
  try {
    raw = parseTrackerConfig(parsedJson);
  } catch (error) {
    throw new Error(`materialize: config at ${configPath} is invalid, refusing to rewrite it:\n  - ${(error as Error).message}`);
  }
  const sources = (raw.sources ?? []).map((entry) => {
    if (entry.dialect === undefined || resolve(projectRoot, entry.path) !== absPath) return entry;
    return {
      ...(Object.keys(aliases).length ? { aliases: { ...(entry.aliases ?? {}), ...aliases } } : (entry.aliases ? { aliases: entry.aliases } : {})),
      ...(entry.format ? { format: entry.format } : {}),
      ...(entry.name ? { name: entry.name } : {}),
      path: entry.path,
    };
  });
  writeFileSync(configPath, `${JSON.stringify({ ...raw, sources }, null, 2)}\n`);
}

function planEntries(projectRoot: string, config: { sources?: TrackerSourceConfig[] }, filePaths: readonly string[], entryFor: (relPath: string) => TrackerSourceConfig): TrackerSourceConfig[] {
  const existingResolved = new Set((config.sources ?? []).map((s) => resolve(projectRoot, s.path)));
  const toAdd: TrackerSourceConfig[] = [];
  if (!config.sources || config.sources.length === 0) {
    const defaultDir = markdownStoreDir(projectRoot);
    toAdd.push({ path: relative(projectRoot, defaultDir).split(sep).join('/') });
    existingResolved.add(defaultDir);
  }
  for (const path of filePaths) {
    if (existingResolved.has(path)) continue;
    existingResolved.add(path); // de-dupe within this same batch too
    toAdd.push(entryFor(relative(projectRoot, path).split(sep).join('/')));
  }
  return toAdd;
}

/** Apply `--register`: append `toAdd` to `config.sources` in the on-disk config file and rewrite
 *  it. The ONLY config mutation this whole feature ever performs, and only additive.
 *
 *  ZTB-26 dev/03: this used to blindly `JSON.parse(...) as TrackerConfig` the file and rewrite it —
 *  an unvalidated cast that would silently rewrite ON TOP OF a malformed config. It now validates
 *  through the same schema `loadTrackerConfig` does before mutating: a malformed config fails
 *  loudly here instead of being blindly preserved-and-rewritten. In the normal CLI flow this file
 *  was already validated moments earlier by the caller's own `loadTrackerConfig` (cliImport.ts) —
 *  this is defense in depth against calling `applyRegister` directly with a stale/hand-edited path. */
export function applyRegister(configPath: string, toAdd: readonly TrackerSourceConfig[]): void {
  if (toAdd.length === 0) return;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`--register: config at ${configPath} is not valid JSON: ${(error as Error).message}`);
  }
  let raw: ReturnType<typeof parseTrackerConfig>;
  try {
    raw = parseTrackerConfig(parsedJson);
  } catch (error) {
    throw new Error(`--register: config at ${configPath} is invalid, refusing to rewrite it:\n  - ${(error as Error).message}`);
  }
  const updated = { ...raw, sources: [...(raw.sources ?? []), ...toAdd] };
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`);
}
