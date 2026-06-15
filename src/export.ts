import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import type { TrackerSnapshot } from './snapshotContract.ts';

export type TrackerExportOptions = {
  projectRoot?: string;
  limit?: number;
  issues?: string[];
};

export type ExportedTrackerSnapshot = TrackerSnapshot;

function activePreset(options: TrackerExportOptions) {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = loadTrackerConfig(projectRoot);
  return resolveTrackerValidation(config, projectRoot);
}

export function exportTrackerSnapshot(
  options: TrackerExportOptions = {},
): ExportedTrackerSnapshot {
  const exportSnapshot = activePreset(options).snapshot?.exportSnapshot;
  if (!exportSnapshot) throw new Error('Active tracker preset does not implement snapshot.exportSnapshot');
  return exportSnapshot(options) as ExportedTrackerSnapshot;
}

export { acVersionForItemBody } from './acVersion.ts';
