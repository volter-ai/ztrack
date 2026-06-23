// `ztrack check` over the single pipeline: loader (backend + git world) -> the
// active preset's mdast parse -> strict ValidationInputSchema -> pure rules. The
// validated root IS the export; there is no separate snapshot model.
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { buildContext, loadValidationInput } from './core/loader.ts';
import { check, checkRoot, type CheckResult, type Context, type CoreRoot, type IssueRecord } from './core/engine.ts';
import { conflictFindings } from './sync/conflicts.ts';
import type { RuleCategory } from './checkRules.ts';

export type TrackerCheckOptions = {
  projectRoot?: string;
  config?: ReturnType<typeof loadTrackerConfig>;
  issues?: string[];
  failOnWarning?: boolean;
  categories?: Partial<Record<RuleCategory, number>>;
  verifyCommits?: boolean;
  now?: string;
  phase?: 'all' | 'gate';
};

export type TrackerCheckResult = CheckResult<CoreRoot>;

function loadOpts(projectRoot: string, options: TrackerCheckOptions) {
  return {
    projectRoot,
    ...(options.issues ? { issues: options.issues } : {}),
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
  const preset = await resolveTrackerValidation(config, projectRoot);
  const { records, context } = await loadValidationInput(preset, loadOpts(projectRoot, options));
  const result = check(preset, records, context);
  // Cross-cutting sync conflicts gate the check (until resolved), scoped to the checked issues.
  const conflicts = conflictFindings(projectRoot, new Set((result.export?.issues ?? []).map((i) => i.id)));
  if (!conflicts.length) return result;
  const findings = [...result.findings, ...conflicts];
  return { ...result, ok: !findings.some((f) => f.severity === 'error'), findings };
}

// Treat a standalone markdown file as ONE issue's body. A loose file has no backend columns,
// so its metadata comes from optional leading `Title:`/`Status:`/`Assignee:` lines (the
// convention the README body.md uses); the id falls back to the filename and the title to the
// first `# heading`. Everything after the metadata block is the content body the preset parses.
export function fileToRecord(absPath: string, content: string): IssueRecord {
  const lines = content.split('\n');
  const meta: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; break; }
    const m = /^(title|status|assignee):\s*(.+)$/i.exec(line.trim());
    if (!m) { i = 0; break; }      // not a metadata block — the whole file is the body
    meta[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  const body = i > 0 ? lines.slice(i).join('\n').replace(/^\n+/, '') : content;
  const id = basename(absPath).replace(/\.[^.]+$/, '');
  const titleFromHeading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return {
    id,
    title: meta.title || titleFromHeading || id,
    status: meta.status || 'draft',
    ...(meta.assignee ? { assignee: meta.assignee } : {}),
    body,
  };
}

/** Validate a single markdown file as if it were one tracker issue, against the installed
 *  preset. The file need not be in the tracker — `ztrack check ./some-issue.md`. */
export async function checkFile(filePath: string, options: TrackerCheckOptions = {}): Promise<TrackerCheckResult> {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = options.config ?? loadTrackerConfig(projectRoot);
  const preset = await resolveTrackerValidation(config, projectRoot);
  const abs = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  if (!existsSync(abs)) throw new Error(`ztrack check: file not found: ${filePath}`);
  const record = fileToRecord(abs, readFileSync(abs, 'utf8'));
  const context = await buildContext(preset, [record], loadOpts(projectRoot, options));
  return check(preset, [record], context);
}

/** Validate an already-exported, validated root (committed CI artifact / `--input`).
 *  The root is the export shape `{ issues: [...] }` — never a legacy snapshot. */
export async function checkTrackerRoot(root: unknown, options: TrackerCheckOptions = {}): Promise<TrackerCheckResult> {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = options.config ?? loadTrackerConfig(projectRoot);
  const preset = await resolveTrackerValidation(config, projectRoot);
  // Observed facts are preset-owned (gathered via loadContext); no backend read is
  // needed for an already-exported root. A preset with no loadContext needs none.
  const observed = preset.loadContext
    ? await preset.loadContext({ projectRoot, verifyCommits: options.verifyCommits, root: root as CoreRoot })
    : {};
  const context: Context = {
    ...observed,
    ...(options.categories ? { categories: options.categories } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.phase ? { phase: options.phase } : {}),
  };
  // A committed root may carry the `## Waivers` directives alongside `issues` (see
  // exportTrackerRoot); checkRoot lifts them into the context and validates only `issues`.
  return checkRoot(preset, root, context);
}
