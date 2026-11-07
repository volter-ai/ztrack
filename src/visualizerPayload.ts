import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditPath, observeChanges, readAudit, timestampsFor } from './core/audit.ts';
import { check, type CoreIssue, type CoreRoot, type Preset } from './core/engine.ts';
import { loadValidationInput } from './core/loader.ts';
import {
  boardIndexDir,
  cacheRoot,
  loadTrackerConfig,
  mainWorktreeMarkdownDir,
  trackerConfigPath,
} from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { resolveSources } from './sources.ts';
import { visualizerOperationalBlocking } from './visualizerBlocking.ts';
import {
  VisualizerSpecSchema,
  type AuditEntry,
  type Payload,
  type PrimitiveName,
  type Timestamps,
  type VisualizerSpec,
} from './visualizerModel.ts';

export interface VisualizerPayloadResult {
  payload: Payload;
  watchPaths: string[];
}

function validatedVisualizer(preset: Preset<CoreRoot>): { visualizer: VisualizerSpec | null; visualizerError?: string } {
  const raw = preset.visualizer;
  if (raw === undefined) return { visualizer: null };
  const parsed = VisualizerSpecSchema.safeParse(raw);
  if (parsed.success) return { visualizer: parsed.data };
  const issue = parsed.error.issues[0];
  const path = issue && issue.path.length ? issue.path.join('.') : '(root)';
  return {
    visualizer: null,
    visualizerError: `visualizer.${path}: ${issue?.message ?? 'invalid visualizer block'}`,
  };
}

function latestMtime(paths: string[]): string | null {
  let latest = 0;
  for (const path of paths) {
    try { latest = Math.max(latest, statSync(path).mtimeMs); } catch { /* a watch path may not exist yet */ }
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => !!path).map((path) => resolve(path)))];
}

/** Build the validated configured-project payload used by both standalone and embedded views.
 * The standalone dev server may provide the preset it just cache-busted and resolved so a live
 * preset edit is consumed by that same request instead of performing a second dynamic import. */
export async function loadVisualizerPayload(input: {
  projectRoot: string;
  preset?: Preset<CoreRoot>;
}): Promise<VisualizerPayloadResult> {
  const projectRoot = resolve(input.projectRoot);
  const config = loadTrackerConfig(projectRoot);
  const validationPath = config.validation?.entrypoint
    ? resolve(projectRoot, config.validation.entrypoint)
    : null;
  const preset = input.preset ?? await resolveTrackerValidation(config, projectRoot);
  const loaded = await loadValidationInput(preset, { projectRoot });
  const result = check(preset, loaded.records, loaded.context);
  const issues = (result.export?.issues ?? []) as CoreIssue[];
  const findings = result.findings;

  const stateRoot = cacheRoot(projectRoot);
  observeChanges(stateRoot, issues);
  const allAudit = readAudit(stateRoot);
  const audit: Record<string, AuditEntry[]> = {};
  const timestamps: Record<string, Timestamps> = {};
  for (const issue of issues) {
    const entries = allAudit.filter((entry) => entry.issueId === issue.id);
    if (entries.length > 0) audit[issue.id] = entries;
    timestamps[issue.id] = timestampsFor(allAudit, issue.id);
  }

  const sources = resolveSources(projectRoot, config);
  const sourcePaths = sources.flatMap((source) => [
    source.dir,
    ...(source.isDefault ? [boardIndexDir(projectRoot), mainWorktreeMarkdownDir(projectRoot)] : []),
  ]);
  const recordPaths = loaded.records.map((record) => record.origin?.path);
  const watchPaths = uniquePaths([
    trackerConfigPath(projectRoot),
    validationPath,
    ...sourcePaths,
    ...recordPaths,
    auditPath(stateRoot),
  ]);
  const trackerChangedAt = latestMtime(uniquePaths([...sourcePaths, ...recordPaths]));
  const { visualizer, visualizerError } = validatedVisualizer(preset);

  return {
    payload: {
      title: 'tracker',
      preset: preset.name,
      primitives: (preset.primitives ?? {}) as Partial<Record<PrimitiveName, boolean>>,
      visualizer,
      ...(visualizerError ? { visualizerError } : {}),
      operationalBlocking: visualizerOperationalBlocking(
        { issues },
        preset.isIssueDone as ((issue: CoreIssue) => boolean) | undefined,
      ),
      projectDir: projectRoot,
      fetchedAt: new Date().toISOString(),
      trackerChangedAt,
      ok: !findings.some((finding) => finding.severity === 'error'),
      issues: issues as unknown as Payload['issues'],
      findings,
      audit,
      timestamps,
    },
    watchPaths,
  };
}
