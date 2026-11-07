import { issueFrontier } from './core/blocking.ts';
import type { BlockRef, CoreIssue, CoreRoot } from './core/engine.ts';

export interface VisualizerOperationalBlockStatus {
  blocked: boolean;
  blockers: BlockRef[];
}

/** Serialize the canonical whole-graph dispatch frontier for the visualizer payload. */
export function visualizerOperationalBlocking(
  root: CoreRoot,
  isIssueDone?: (issue: CoreIssue) => boolean,
): Record<string, VisualizerOperationalBlockStatus> {
  return Object.fromEntries(issueFrontier(root, isIssueDone ? { isIssueDone } : {}).entries());
}
