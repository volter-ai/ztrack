// `ztrack check` over the single pipeline: loader (backend + git world) -> the
// active preset's mdast parse -> strict ValidationInputSchema -> pure rules. The
// validated root IS the export; there is no separate snapshot model.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { buildContext, loadValidationInput } from './core/loader.ts';
import { check, checkRoot, type CheckResult, type Context, type CoreRoot, type Finding, type IssueRecord } from './core/engine.ts';
import { conflictFindings } from './sync/conflicts.ts';
import { documentHeaderFindings, documentSourceHeaderFindings } from './documentDiagnostics.ts';
import { DocumentSource } from './backends/documentSource.ts';
import { parseMarkdownDocumentSource } from './documentParser.ts';
import { resolveSources } from './sources.ts';
import type { RuleCategory } from './checkRules.ts';

export type TrackerCheckOptions = {
  projectRoot?: string;
  config?: ReturnType<typeof loadTrackerConfig>;
  issues?: string[];
  /** ZTB-33: `ztrack check --source <sel>` — scope validation to the named declared source(s).
   *  Absent = the whole union. Threaded to the loader/backend; when scoped to one source,
   *  `crossSourceConflicts` cannot fire (there is nothing else to conflict with). */
  sources?: string[];
  failOnWarning?: boolean;
  categories?: Partial<Record<RuleCategory, number>>;
  verifyCommits?: boolean;
  now?: string;
  phase?: 'all' | 'gate';
  /** `ztrack check --preset <path>`: an operator-supplied validation preset module, loaded in
   *  place of the repo's configured `validation.entrypoint` — unconfined to the project (see
   *  presetRegistry.ts's `loadOperatorPreset`). `check` only; threaded through to the single
   *  resolution point (`resolveTrackerValidation`) shared by all three functions below. */
  presetPath?: string;
};

// ZTB-35 dev/67: `loadedIssueIds` — the ids the LOADER actually found and handed to validation,
// set regardless of whether validation then passed. A shape-invalid issue (e.g. an AC status
// outside the preset enum) IS loaded — `check()` emits its `wellformed_shape` finding — but
// leaves `result.export` unset (the root never parsed), so a caller that derives "did this id
// exist" from `export.issues` alone sees an empty set and wrongly reports it as missing. This
// field lets callers distinguish "not in the backend at all" from "loaded but dropped by
// validation" without guessing from `export`.
export type TrackerCheckResult = CheckResult<CoreRoot> & {
  loadedIssueIds?: string[];
  /** Set only by `checkFile` when the target file parsed as DOCUMENT grammar (many issues, one
   *  file — the same grammar a registered `format: "document"` source uses) and was validated as
   *  such, instead of as one loose issue. `registeredName` is the declared source's `--source`
   *  selector when the file IS one of the tracker's registered sources, else null — the CLI uses
   *  null to OFFER `ztrack import <file> --register` (never to run it: mutating
   *  tracker-config.json is the user's call). */
  documentFile?: { path: string; issueIds: string[]; registeredName: string | null };
};

function loadOpts(projectRoot: string, options: TrackerCheckOptions) {
  return {
    projectRoot,
    ...(options.issues ? { issues: options.issues } : {}),
    ...(options.sources && options.sources.length ? { sources: options.sources } : {}),
    ...(options.categories ? { categories: options.categories } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.phase ? { phase: options.phase } : {}),
    ...(options.verifyCommits !== undefined ? { verifyCommits: options.verifyCommits } : {}),
  };
}

/** Validate the live tracker store. */
export async function checkTracker(options: TrackerCheckOptions = {}): Promise<TrackerCheckResult> {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = options.config ?? loadTrackerConfig(projectRoot);
  const preset = await resolveTrackerValidation(config, projectRoot, options.presetPath);
  const { records, context } = await loadValidationInput(preset, loadOpts(projectRoot, options));
  const result = check(preset, records, context);
  const loadedIssueIds = records.map((r) => r.id);
  // Cross-cutting sync conflicts gate the check (until resolved), scoped to the checked issues.
  const conflicts = conflictFindings(projectRoot, new Set((result.export?.issues ?? []).map((i) => i.id)));
  // Cross-cutting document-source header diagnostics (ZTB-23 dev/04): warnings, never gate —
  // same "read directly off disk, merged in" shape as conflicts above.
  const headerFindings = documentHeaderFindings(projectRoot, config);
  const extra = [...conflicts, ...headerFindings];
  if (!extra.length) return { ...result, loadedIssueIds };
  const findings = [...result.findings, ...extra];
  return { ...result, ok: !findings.some((f) => f.severity === 'error'), findings, loadedIssueIds };
}

const HEADER_LINE = /^(title|status|assignee):\s*(.+)$/i;

// Treat a standalone markdown file as ONE issue's body. A loose file has no backend columns,
// so its metadata comes from optional leading `Title:`/`Status:`/`Assignee:` lines (the
// convention the README body.md uses); the id falls back to the filename and the title to the
// first `# heading`. Everything after the metadata block is the content body the preset parses.
// `diagnostics`, when passed, collects `loose_header_ignored` findings for two silent-failure
// shapes: (a) a header block that was IN PROGRESS (at least one Title/Status/Assignee line
// already matched) got aborted by a non-matching line, discarding the whole block into body;
// (b) a Title:/Status:/Assignee:-shaped line surviving in the body after the scan stopped —
// it silently reads as plain text instead of the metadata it looks like.
export function fileToRecord(absPath: string, content: string, diagnostics?: Finding[]): IssueRecord {
  const id = basename(absPath).replace(/\.[^.]+$/, '');
  const lines = content.split('\n');
  const meta: Record<string, string> = {};
  let i = 0;
  // Atomic like decomposeSection (documentWriteBack.ts): an abort discards EVERY line matched so
  // far, not just the ones after it — `aborted` gates meta use below so the diagnostic's own claim
  // ("discarding any Title:/Status:/Assignee: lines already read") is actually true.
  let aborted = false;
  // true only when the scan aborted on the VERY FIRST line (no header block was ever in
  // progress) — distinguished from an abort mid-block, which case (a) below already warns on.
  let neverStarted = false;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; break; }
    const m = HEADER_LINE.exec(line.trim());
    if (!m) {
      // Only loud here when a header block was already under way (i > 0) — case (c) below
      // covers the i === 0 case (the scan never started) separately.
      if (i > 0) {
        diagnostics?.push({
          code: 'loose_header_ignored', severity: 'warning', issueId: id,
          message: `${absPath}: the header block was aborted by a non-header-shaped line and fell back to plain body (discarding any Title:/Status:/Assignee: lines already read): "${line}"`,
        });
      } else {
        neverStarted = true;
      }
      aborted = true;
      i = 0; break;      // not a metadata block — the whole file is the body
    }
    meta[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  const body = i > 0 ? lines.slice(i).join('\n').replace(/^\n+/, '') : content;
  // (b): header-shaped lines surviving in the body — only meaningful once a real header block
  // was consumed (i > 0); otherwise `body` is the whole file and this would just re-report (a).
  if (i > 0) {
    for (const line of body.split('\n')) {
      if (HEADER_LINE.test(line.trim())) {
        diagnostics?.push({
          code: 'loose_header_ignored', severity: 'warning', issueId: id,
          message: `${absPath}: a Title:/Status:/Assignee:-shaped line appears in the body (after the header scan stopped) and was read as plain text, not metadata: "${line.trim()}"`,
        });
      }
    }
  } else if (neverStarted) {
    // (c, ZL-E5 residual): the scan never started because the FIRST line wasn't header-shaped
    // (e.g. `Summary: x` before `Assignee: me`) — the original repro's exact shape. Without this,
    // a header-shaped line anywhere later in the same first paragraph vanished into the body with
    // NO diagnostic at all (unlike (a)/(b), which at least warn once a block was in progress).
    // Bounded to the first paragraph, the same span the header scan itself would have covered.
    for (const line of lines.slice(1)) {
      if (line.trim() === '') break; // end of the first paragraph
      if (HEADER_LINE.test(line.trim())) {
        diagnostics?.push({
          code: 'loose_header_ignored', severity: 'warning', issueId: id,
          message: `${absPath}: the header scan never started (the first line is not header-shaped) but a later line in the same paragraph looks like a Title:/Status:/Assignee: header and was read as plain text: "${line.trim()}"`,
        });
      }
    }
  }
  const titleFromHeading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return {
    id,
    title: (!aborted && meta.title) || titleFromHeading || id,
    status: (!aborted && meta.status) || 'draft',
    ...(!aborted && meta.assignee ? { assignee: meta.assignee } : {}),
    body,
    origin: { path: absPath }, // the whole file is the issue — no line span
  };
}

// A `<file.md>` check target is DOCUMENT grammar (one file holding many issues — exactly what a
// registered `format: "document"` source parses, src/documentParser.ts) when at least one section
// heading bears an id token. For MODE DETECTION ONLY the token must contain a digit ("TF-1001",
// "ZL-A5"): ID_HEADING_RE alone also matches ordinary hyphenated words ("## Follow-up items"),
// and flipping a genuinely loose file into multi-issue mode over one such heading would be a
// worse surprise than requiring the digit real-world ids virtually always carry. Once the mode IS
// detected, validation uses the full grammar unmodified — identical to what registering the file
// would produce. Before this, a document-grammar file was silently lumped into ONE loose issue
// keyed by its filename — the check answered the wrong question in both directions (nonsense
// findings on the lump, and no hint that the file's real issues weren't being validated).
function isDocumentGrammarFile(content: string, absPath: string): boolean {
  return parseMarkdownDocumentSource(content, absPath).some((p) => p.lineStart !== undefined && /\d/.test(p.id));
}

function safeRealpath(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

/** Validate a document-grammar file: every issue the document parse yields, presented exactly as
 *  a registered document source would present them (DocumentSource's decompose/heading-shift),
 *  checked in one batch so intra-file relations resolve. */
async function checkDocumentFile(abs: string, config: ReturnType<typeof loadTrackerConfig>, projectRoot: string, options: TrackerCheckOptions): Promise<TrackerCheckResult> {
  const preset = await resolveTrackerValidation(config, projectRoot, options.presetPath);
  const source = new DocumentSource({ dir: abs, format: 'document', readonly: true, isDefault: false, name: basename(abs) });
  const records: IssueRecord[] = source.ids().map((id) => {
    const issue = source.load(id)!;
    return {
      id, title: issue.title, status: issue.state,
      ...(issue.assignees[0] ? { assignee: issue.assignees[0] } : {}),
      ...(issue.labels.length ? { labels: issue.labels } : {}),
      ...(issue.children.length ? { children: issue.children } : {}),
      body: issue.body,
      origin: source.origin(id),
    };
  });
  const context = await buildContext(preset, records, loadOpts(projectRoot, options));
  const result = check(preset, records, context);
  // Registered = the file is one of the tracker's declared document sources (realpath-tolerant:
  // the target path arrives via cwd, the declared path via projectRoot — symlinked tmp dirs etc.
  // must not make a registered file look unregistered).
  const realAbs = safeRealpath(abs);
  const registered = resolveSources(projectRoot, config).find((s) => s.format === 'document' && (s.dir === abs || safeRealpath(s.dir) === realAbs));
  const headerFindings = documentSourceHeaderFindings(source, abs);
  const findings = [...headerFindings, ...result.findings];
  return {
    ...result,
    ok: !findings.some((f) => f.severity === 'error'),
    findings,
    loadedIssueIds: records.map((r) => r.id),
    documentFile: { path: abs, issueIds: records.map((r) => r.id), registeredName: registered?.name ?? null },
  };
}

/** Validate a single markdown file against the installed preset. A file in DOCUMENT grammar
 *  (id-bearing section headings) is checked as the multi-issue document it is — see
 *  `checkDocumentFile` above; anything else is treated as ONE loose issue. The file need not be
 *  in the tracker — `ztrack check ./some-issue.md`. */
export async function checkFile(filePath: string, options: TrackerCheckOptions = {}): Promise<TrackerCheckResult> {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = options.config ?? loadTrackerConfig(projectRoot);
  const abs = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  if (!existsSync(abs)) throw new Error(`ztrack check: file not found: ${filePath}`);
  const content = readFileSync(abs, 'utf8');
  if (isDocumentGrammarFile(content, abs)) return checkDocumentFile(abs, config, projectRoot, options);
  const preset = await resolveTrackerValidation(config, projectRoot, options.presetPath);
  const diagnostics: Finding[] = [];
  const record = fileToRecord(abs, content, diagnostics);
  const context = await buildContext(preset, [record], loadOpts(projectRoot, options));
  const result = check(preset, [record], context);
  if (!diagnostics.length) return result;
  const findings = [...diagnostics, ...result.findings];
  return { ...result, ok: !findings.some((f) => f.severity === 'error'), findings };
}

// ZTB-36: pull the root's issue ids up front, tolerantly — the `--input` analog of what the
// live loader hands back as `loadedIssueIds` (ZTB-35 dev/67 comment above `TrackerCheckResult`),
// except read straight off the root instead of a backend scan. Undefined whenever the root is
// too shape-broken to have a usable `issues` array — callers must treat that as "couldn't tell",
// not "found nothing", so a shape error can win over any not-found report (see checkTrackerRoot).
function extractRootIssueIds(root: unknown): string[] | undefined {
  if (!root || typeof root !== 'object') return undefined;
  const issues = (root as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return undefined;
  return issues
    .filter((entry): entry is { id: string } =>
      !!entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' && (entry as { id: string }).id.length > 0)
    .map((entry) => String(entry.id));
}

/** Validate an already-exported, validated root (committed CI artifact / `--input`).
 *  The root is the export shape `{ issues: [...] }` — never a legacy snapshot. */
export async function checkTrackerRoot(root: unknown, options: TrackerCheckOptions = {}): Promise<TrackerCheckResult> {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = options.config ?? loadTrackerConfig(projectRoot);
  const preset = await resolveTrackerValidation(config, projectRoot, options.presetPath);
  // ZTB-36: pull the ids up front, tolerantly — reused below both to gate `loadContext` (right
  // here) and to scope `--issues` (further down). Call it once; undefined means the root is too
  // shape-broken to have a usable `issues` array at all.
  const presentIds = extractRootIssueIds(root);
  // Observed facts are preset-owned (gathered via loadContext); no backend read is needed for an
  // already-exported root. A preset with no loadContext needs none — and neither does a
  // top-level-broken root (ZTB-38): `checkRoot`'s schema validation is guaranteed to fail on
  // shape alone, so no observed facts could matter, and skipping the call keeps even a STALE
  // installed preset copy (one that hasn't run `preset upgrade` past ZTB-38's hardening) safe
  // from a blind `input.root` dereference before validation ever runs.
  const observed = preset.loadContext && presentIds !== undefined
    ? await preset.loadContext({ projectRoot, verifyCommits: options.verifyCommits, root: root as CoreRoot })
    : {};
  const context: Context = {
    ...observed,
    ...(options.categories ? { categories: options.categories } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.phase ? { phase: options.phase } : {}),
  };
  // ZTB-36: `--issues` with `--input` now scopes validation to those ids WITHIN the
  // root, mirroring the live path's loader-side filtering (src/core/loader.ts's `wanted` set in
  // `loadValidationInput`) — unlike `--source`, issue ids ARE present in an exported root, so
  // scoping is meaningful (see cliCheck.ts's --source-refusal comment for the contrast). A
  // shallow copy of `root` with only `issues` replaced preserves every other field untouched —
  // notably the `## Waivers` directives `exportTrackerRoot` writes alongside `issues`, which
  // `checkRoot` below lifts into the context regardless of which issues survive the filter — and
  // the caller's root object is never mutated. When the root is too broken to extract ids
  // (`presentIds` undefined), skip filtering entirely so `checkRoot`'s own shape findings fire
  // instead of a spurious not-found report — a shape error must win, and nothing may crash.
  const wanted = options.issues ? new Set(options.issues.map(String)) : null;
  const scopedRoot = wanted && presentIds
    ? { ...(root as Record<string, unknown>), issues: (root as { issues: unknown[] }).issues.filter((entry) => wanted.has(String((entry as { id?: unknown } | null)?.id))) }
    : root;
  // A committed root may carry the `## Waivers` directives alongside `issues` (see
  // exportTrackerRoot); checkRoot lifts them into the context and validates only `issues`.
  const result = checkRoot(preset, scopedRoot, context);
  // `loadedIssueIds` is set whenever ids were extractable, REGARDLESS of whether validation then
  // passed — same contract as `checkTracker`'s field of the same name (ZTB-35 dev/67) — so
  // `cliCheck.ts` can tell "not in the root at all" from "shape too broken to tell".
  return presentIds ? { ...result, loadedIssueIds: presentIds } : result;
}
