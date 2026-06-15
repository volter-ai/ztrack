import type { z } from 'zod';
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import type { RuleCategory, RuleClassification, RuleProfile } from './checkRules.ts';
import type { TrackerValidationReportSchema } from './snapshotContract.ts';

export type TrackerCheckOptions = {
  projectRoot?: string;
  config?: ReturnType<typeof loadTrackerConfig>;
  issues?: string[];
  failOnWarning?: boolean;
  categories?: Partial<Record<RuleCategory, number>>;
  profiles?: RuleProfile[];
  verifyCommits?: boolean;
};

export type TrackerCheckReport = z.infer<typeof TrackerValidationReportSchema>;

function activePreset(options: TrackerCheckOptions) {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = options.config ?? loadTrackerConfig(projectRoot);
  return resolveTrackerValidation(config, projectRoot);
}

export function classifyRuleCode(code: string): RuleClassification & { explicit: boolean } {
  const preset = activePreset({});
  return preset.snapshot?.classifyRuleCode?.(code) ?? { category: 'wellformed', depth: 1, explicit: false };
}

export function checkTrackerSnapshot(
  rawSnapshot: unknown,
  options: TrackerCheckOptions = {},
): TrackerCheckReport {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = options.config ?? loadTrackerConfig(projectRoot);
  const preset = resolveTrackerValidation(config, projectRoot);

  // Legacy peakSnapshotCheck is the authoritative gate. (The transitional `spine`
  // engine — a faithful re-expression of this same rulebook — has been retired; its
  // lessons are captured in SPINE-HARVEST.md. The next gate is peakCore, wired
  // separately when the flip lands.)
  const checkSnapshot = preset.snapshot?.checkSnapshot;
  if (!checkSnapshot) throw new Error('Active tracker preset does not implement snapshot.checkSnapshot');
  return checkSnapshot(rawSnapshot, options) as TrackerCheckReport;
}
