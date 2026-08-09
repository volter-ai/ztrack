// Stable authoring surface for repo-owned visualizer extensions. The model lives in the
// browser-safe visualizerModel leaf so the standalone client and embeds share one authored copy.
export type {
  AuditEntry,
  CoreAC,
  CoreEvidence,
  CoreIssue,
  Finding,
  OperationalBlockStatus,
  Payload,
  PrimitiveName,
  Timestamps,
  VisualizerExtension,
  VisualizerSpec,
} from './visualizerModel.ts';

import type { VisualizerExtension } from './visualizerModel.ts';

/** Blessed identity helper for an extension declaration. */
export function defineVisualizerExtension(extension: VisualizerExtension): VisualizerExtension {
  return extension;
}
