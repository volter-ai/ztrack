// `ztrack check` over the single pipeline: loader (backend + git world) -> the
// active preset's mdast parse -> strict ValidationInputSchema -> pure rules. The
// validated root IS the export; there is no separate snapshot model.
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { loadValidationInput } from './core/loader.ts';
import { check, checkRoot, type CheckResult, type Context, type CoreRoot } from './core/engine.ts';
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
  return check(preset, records, context);
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
