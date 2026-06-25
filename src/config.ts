import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TrackerConfig } from './types.ts';

/**
 * Name of the per-project state directory holding tracker config and data
 * (`<root>/<stateDir>/tracker-config.json`, database, …). Defaults to
 * `.volter`; hosts that need a different directory set VOLTER_STATE_DIR.
 * Every path in this package must go through these helpers, never the
 * literal.
 */
export function stateDirName(): string {
  return process.env.VOLTER_STATE_DIR || '.volter';
}

export function trackerConfigPath(projectRoot: string): string {
  return join(projectRoot, stateDirName(), 'tracker-config.json');
}

/** Absolute path to the shared `.git` dir — identical for every worktree of a clone — or null
 *  when `projectRoot` isn't in a git repo. Linked-mode machine-local cache lives under it so it's
 *  shared across worktrees and (being inside `.git`) is never committed or pushed. */
export function gitCommonDir(projectRoot: string): string | null {
  const r = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const out = (r.stdout ?? '').trim();
  return out || null;
}

/** Is this tracker linked to an external provider? Linked issue data is the provider's truth;
 *  locally it's a per-clone cache, not committed (vs. a local tracker, whose store is committed). */
export function isLinkedTracker(projectRoot: string): boolean {
  try { return !!loadTrackerConfig(projectRoot).sync; } catch { return false; }
}

/** Root for machine-local cache (linked issue store, sync state, blobs, evidence staging).
 *  - Linked: `<git-common-dir>/ztrack` — ONE cache shared by every worktree of the clone, never
 *    pushed (it's inside `.git`). A fresh worktree sees the same issues with no per-worktree sync.
 *  - Local (or no git available): the per-worktree `<stateDir>` — the issue store there is
 *    committed and branch-scoped on purpose (work + proof + issue-state merge with the code). */
export function cacheRoot(projectRoot: string): string {
  if (isLinkedTracker(projectRoot)) {
    const common = gitCommonDir(projectRoot);
    if (common) return join(common, 'ztrack');
  }
  return join(projectRoot, stateDirName());
}

/** The markdown issue store — committed `<stateDir>/tracker/markdown` when local, the shared
 *  per-clone `<git-common-dir>/ztrack/tracker/markdown` when linked. Every reader/writer of the
 *  issue store MUST go through this, never the literal path. */
export function markdownStoreDir(projectRoot: string): string { return join(cacheRoot(projectRoot), 'tracker', 'markdown'); }
/** Sync bookkeeping (reconcile base, conflicts, identity bindings) — under the linked cache root. */
export function syncStateDir(projectRoot: string): string { return join(cacheRoot(projectRoot), 'sync'); }
/** Provider connector cache (poll cursors, twin event log) — under the linked cache root. */
export function providerCacheDir(projectRoot: string): string { return join(cacheRoot(projectRoot), 'github'); }

/** The effective evidence store mode (resolves `auto`). `commit` for a local tracker, `attach`
 *  for a linked one — overridable via `config.evidence.store`. */
export function evidenceStore(projectRoot: string): 'commit' | 'attach' | 'external' {
  let cfgStore: string | undefined;
  try { cfgStore = loadTrackerConfig(projectRoot).evidence?.store; } catch { /* no config */ }
  if (cfgStore === 'commit' || cfgStore === 'attach' || cfgStore === 'external') return cfgStore;
  // auto → `commit`: the default everywhere. Committed evidence is offline-verifiable at the cited
  // commit and travels with the code — the strongest model. `attach` (upload to the linked GitHub
  // release host, cite a URL pinned by digest) is opt-in via `evidence.store` or `evidence add --attach`.
  return 'commit';
}

/** Relevance-anchor enforcement (`config.relevance`). Default `optional` (anchors opt-in, the
 *  non-breaking default everywhere). `required` makes a preset enforce that every passed AC
 *  declares its `paths` anchor — read by the default preset's loadContext and surfaced on the
 *  validation context so its rules can mandate the anchor without re-reading disk. */
export function relevanceMode(projectRoot: string): 'optional' | 'required' {
  try { return loadTrackerConfig(projectRoot).relevance === 'required' ? 'required' : 'optional'; }
  catch { return 'optional'; }
}

/** Directory for evidence files (relative paths cited as `image=`). Default `.volter/evidence`;
 *  committed (not gitignored) when the store mode is `commit`, so it travels and verifies at the
 *  cited commit. */
export function evidenceDir(projectRoot: string): string {
  let dir: string | undefined;
  try { dir = loadTrackerConfig(projectRoot).evidence?.dir; } catch { /* no config */ }
  return join(projectRoot, dir || join(stateDirName(), 'evidence'));
}

// The real boilerplate files shipped at boilerplates/presets/<name>.ts.
export type CanonicalTrackerPreset = 'simple-sdlc' | 'simple-gh-sdlc' | 'spec' | 'speckit';
// Accepted `--preset` input. `default` is an ALIAS for the recommended baseline (simple-sdlc) — there
// is no `default.ts`; it resolves to simple-sdlc so `ztrack init` (no flag) installs the lean preset.
export type InitTrackerPreset = CanonicalTrackerPreset | 'default';

const INIT_TRACKER_PRESETS = ['simple-sdlc', 'simple-gh-sdlc', 'spec', 'speckit', 'default'] as const;

export function initTrackerPresets(): readonly InitTrackerPreset[] {
  return INIT_TRACKER_PRESETS;
}

// Resolve an accepted preset name (incl. the `default` alias) to its boilerplate file name.
function resolvePresetName(preset: InitTrackerPreset): CanonicalTrackerPreset {
  return preset === 'default' ? 'simple-sdlc' : preset;
}

export type InitTrackerProjectOptions = {
  preset?: InitTrackerPreset;
  /** Permanently link an external tracker (e.g. { provider: 'github', repo: 'o/n' }). */
  sync?: { provider: 'github'; repo: string; policy?: 'hub-wins' | 'twin-wins' | 'merge' };
};

// The standalone preset's editable source, shipped at `boilerplates/presets/<preset>.ts`.
// `ztrack init` copies it verbatim — it is REAL code (its OWN schema/parser/rules),
// importing only `ztrack/preset-kit`. No template substitution, no flags.
function presetTemplate(preset: InitTrackerPreset): string {
  return readFileSync(fileURLToPath(new URL(`../boilerplates/presets/${resolvePresetName(preset)}.ts`, import.meta.url)), 'utf8');
}

export function trackerValidationEntrypointPath(projectRoot: string): string {
  // `.mts` (not `.ts`): unambiguously ESM, so Node type-strips + loads it as a module even
  // when the consuming project's package.json has no `"type": "module"`.
  return join(projectRoot, stateDirName(), 'tracker', 'validation', 'preset.mts');
}

// The pristine copy of the installed preset, recorded at init so `ztrack preset upgrade`
// can 3-way merge new upstream rules into an edited preset without clobbering edits.
// Committed (not gitignored) so the merge base is reproducible.
export function trackerValidationBasePath(projectRoot: string): string {
  return join(projectRoot, stateDirName(), 'tracker', 'validation', '.preset.base.mts');
}

function installPreset(projectRoot: string, preset: InitTrackerPreset): string {
  const entrypoint = trackerValidationEntrypointPath(projectRoot);
  mkdirSync(dirname(entrypoint), { recursive: true });
  const source = presetTemplate(preset);
  if (!existsSync(entrypoint)) writeFileSync(entrypoint, source);
  // record the pristine base for `ztrack preset upgrade`'s 3-way merge.
  const basePath = trackerValidationBasePath(projectRoot);
  if (!existsSync(basePath)) writeFileSync(basePath, source);
  return entrypoint;
}

export interface UpgradePresetResult {
  status: 'updated' | 'up-to-date' | 'conflicts' | 'no-base';
  entrypoint: string;
  installedFrom: InitTrackerPreset;
  conflicts: number;
}

// 3-way merge: apply the diff `base` -> `theirs` (new upstream) onto `ours` (the edited
// file), via `git merge-file`. Returns the merged text and conflict count (0 = clean).
function threeWayMerge(ours: string, base: string, theirs: string): { text: string; conflicts: number } {
  const dir = mkdtempSync(join(tmpdir(), 'ztrack-preset-merge-'));
  try {
    const o = join(dir, 'ours'); const b = join(dir, 'base'); const t = join(dir, 'theirs');
    writeFileSync(o, ours); writeFileSync(b, base); writeFileSync(t, theirs);
    const r = spawnSync('git', ['merge-file', '-p', '-L', 'your edits', '-L', 'installed base', '-L', 'new upstream', o, b, t], { encoding: 'utf8' });
    if (r.error) throw new Error(`git merge-file unavailable: ${r.error.message}`);
    const status = r.status ?? 0;
    if (status < 0) throw new Error(`git merge-file failed: ${r.stderr || 'unknown error'}`);
    return { text: r.stdout, conflicts: status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Upgrade the repo-local preset: 3-way merge the current bundled template (for the
 * variant this repo installed) into the edited preset.ts, preserving local edits.
 * Conflicts are written as `<<<<<<<` markers for a human/agent to resolve. The pristine
 * base advances to the new upstream on a clean OR conflicted merge.
 */
export function upgradeTrackerPreset(projectRoot: string): UpgradePresetResult {
  const config = loadTrackerConfig(projectRoot);
  const installedFrom = config.validation?.installedFrom;
  const entrypoint = trackerValidationEntrypointPath(projectRoot);
  if (!installedFrom || !(INIT_TRACKER_PRESETS as readonly string[]).includes(installedFrom) || !existsSync(entrypoint)) {
    throw new Error("No bundled preset to upgrade from. `ztrack preset upgrade` only applies to a repo init'd with `ztrack init --preset <name>`.");
  }
  // Legacy compat: a repo recorded as `default` predates the alias and meant the old PR-based preset,
  // which is now simple-gh-sdlc — upgrade it against that, not the new lean simple-sdlc baseline.
  const variant: InitTrackerPreset = installedFrom === 'default' ? 'simple-gh-sdlc' : (installedFrom as InitTrackerPreset);
  const basePath = trackerValidationBasePath(projectRoot);
  if (!existsSync(basePath)) return { status: 'no-base', entrypoint, installedFrom: variant, conflicts: 0 };
  const base = readFileSync(basePath, 'utf8');
  const upstream = presetTemplate(variant);
  if (base === upstream) return { status: 'up-to-date', entrypoint, installedFrom: variant, conflicts: 0 };
  const ours = readFileSync(entrypoint, 'utf8');
  const merged = threeWayMerge(ours, base, upstream);
  writeFileSync(entrypoint, merged.text);
  writeFileSync(basePath, upstream);
  return { status: merged.conflicts > 0 ? 'conflicts' : 'updated', entrypoint, installedFrom: variant, conflicts: merged.conflicts };
}

/**
 * Initialize a tracker project: write the local backend config, install a
 * repo-local validation preset, and add a managed .gitignore block. Idempotent and
 * shared by `ztrack init` and the tracker_init MCP tool so an MCP-only agent
 * can bootstrap a fresh repo without the CLI.
 */
export function initTrackerProject(
  root: string,
  teamKey = 'LOCAL',
  options: InitTrackerProjectOptions = {},
): { configPath: string; alreadyInitialized: boolean; teamKey: string; preset: InitTrackerPreset; validationEntrypoint?: string } {
  const configPath = trackerConfigPath(root);
  // Resolve the `default` alias up front so the canonical name is what we install + record.
  const preset = resolvePresetName(options.preset ?? 'default');
  if (existsSync(configPath)) return { configPath, alreadyInitialized: true, teamKey, preset };
  const key = teamKey.toUpperCase();
  mkdirSync(dirname(configPath), { recursive: true });
  const validationEntrypoint = installPreset(root, preset);
  const config: TrackerConfig = {
    backend: 'markdown',
    local: { teamKey: key },
    validation: {
      entrypoint: `${stateDirName()}/tracker/validation/preset.mts`,
      installedFrom: preset,
    },
    organization: { check: { categories: { sourced: 1, code: 2 } } },
    ...(options.sync ? { sync: options.sync } : {}),
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  ensureTrackerGitignore(root);
  return { configPath, alreadyInitialized: false, teamKey: key, preset, ...(validationEntrypoint ? { validationEntrypoint } : {}) };
}

/** Idempotently ensure ztrack's managed `.gitignore` patterns are present. On a fresh repo
 *  it writes the whole block; on a repo whose block predates a new pattern (e.g. the loop
 *  runtime files added later) it appends only the missing lines — so the loop's session
 *  state never leaks into a commit on a repo that was `init`'d before the loop existed.
 *  Called by `init` and by `ztrack loop start` (the point where loop-state files appear). */
export function ensureTrackerGitignore(root: string): void {
  const gitignorePath = resolve(root, '.gitignore');
  const ignoreMarker = '# ztrack (added by ztrack init)';
  const stateDir = stateDirName();
  // The issue store is COMMITTED for a local-only tracker (so clones, CI, and git worktrees see
  // the issues — `ztrack check` in CI must not silently pass an empty tracker, and a per-worktree
  // gate needs the issues present), but IGNORED for a tracker LINKED to GitHub (there the provider
  // is the source of truth and `ztrack sync` repopulates the local cache). The twin/sync runtime
  // (event log, poll cursors, bindings/base/conflicts) is always machine-local cache.
  const linked = (() => { try { return !!loadTrackerConfig(root).sync; } catch { return false; } })();
  const managed = [
    ignoreMarker,
    `${stateDir}/tracker/tracker.sqlite`,
    `${stateDir}/tracker/tracker.sqlite-*`,
    `${stateDir}/tracker/tracker.sqlite.lock`,
    `${stateDir}/tracker/local-store.json`,
    ...(linked ? [`${stateDir}/tracker/markdown/`] : []),
    `${stateDir}/agent-dispatch/`,
    `${stateDir}/github/`,
    `${stateDir}/sync/`,
    `${stateDir}/.ztrack-loop.json`,
    `${stateDir}/.ztrack-loop-iter-*`,
    `${stateDir}/.ztrack-loop-exempt-*`,
    `${stateDir}/.ztrack-loop-capped.json`,
  ];
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (!existing.includes(ignoreMarker)) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(gitignorePath, `${existing}${prefix}${existing ? '\n' : ''}${managed.join('\n')}\n`);
    return;
  }
  const present = new Set(existing.split('\n').map((s) => s.trim()));
  const missing = managed.filter((line) => line !== ignoreMarker && !present.has(line));
  if (missing.length) {
    const prefix = existing.endsWith('\n') ? '' : '\n';
    writeFileSync(gitignorePath, `${existing}${prefix}${missing.join('\n')}\n`);
  }
}

export function projectRootFrom(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(trackerConfigPath(current))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export function loadTrackerConfig(projectRoot = projectRootFrom()): TrackerConfig {
  const configPath = trackerConfigPath(projectRoot);
  if (!existsSync(configPath)) {
    throw new Error(`No tracker config found at ${configPath}. Run 'ztrack init' to create one.`);
  }
  let raw: Partial<TrackerConfig>;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<TrackerConfig>;
  } catch (error) {
    throw new Error(`Tracker config at ${configPath} is not valid JSON: ${(error as Error).message}`);
  }
  // markdown is the default and only live backend; a config still naming the removed
  // Python `local` backend is preserved verbatim so the client can point the user at
  // `ztrack migrate-local` instead of silently reading an empty store.
  return { ...raw, backend: raw.backend === 'local' ? 'local' : 'markdown' };
}

/**
 * Canonical resolution of the local tracker SQLite path. Every reader
 * (tracker loader/exporter, sync relay, drift audit) must use this — copies
 * with diverging defaults read an empty store and silently stall instead of
 * failing.
 */
export function trackerDatabasePath(projectRoot = projectRootFrom()): string {
  const config = loadTrackerConfig(projectRoot);
  const database = config.local?.database || join(stateDirName(), 'tracker', 'tracker.sqlite');
  return database.startsWith('/') ? database : resolve(projectRoot, database);
}

export function loadEnvFiles(projectRoot: string): void {
  for (const envPath of [join(projectRoot, '.env'), join(projectRoot, stateDirName(), 'secrets.env')]) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      process.env[key.trim()] ??= rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  }
}
