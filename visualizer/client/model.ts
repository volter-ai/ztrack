// The client-side view of the CORE export. Core fields are known; preset-
// specific fields ride along as extra keys and are rendered by the extension.

export interface CoreEvidence { id: string; [k: string]: unknown }
export interface CoreAC { id: string; status: string; evidence: CoreEvidence[]; [k: string]: unknown }
export interface CoreIssue {
  id: string; title: string; summary: string; status: string;
  acceptanceCriteria: CoreAC[]; [k: string]: unknown;
}
// 'acknowledged' is a downgraded error a fresh waiver has accepted — reported but non-gating.
export interface Finding {
  code: string; severity: 'error' | 'warning' | 'acknowledged'; message: string;
  issueId?: string; acId?: string; evidenceId?: string;
}
export type PrimitiveName = 'labels' | 'relations' | 'children' | 'sources' | 'category' | 'proof' | 'audit';
export interface AuditEntry { ts: string; issueId: string; op: string; field?: string; from?: string; to?: string; actor?: string }
export interface Timestamps { created?: string; updated?: string; stateSince?: string }

// VIZ-1's dashboard vocabulary, as the client sees it over the wire (mirrors
// `VisualizerSpec`/`VisualizerSpecSchema`, src/core/engine.ts — a hand-mirrored client-side view,
// same convention as CoreIssue/Finding above, since the client tree is excluded from the tsc
// build and does not import src/ types directly). Field references + literal labels only — no
// functions, no markup (the server validates this shape at board time, VIZ-3; a malformed block
// never reaches here — it ships as `visualizer: null` + `visualizerError` instead).
export interface VisualizerAcText { id: string; text: string; version?: string }
export interface VisualizerPr { field: string; urlField: string }
export interface VisualizerAcProof { field: string; explanation: string; evidenceRefs: string }
export interface VisualizerAcEvidence { field: string; image: string; commit: string; acVersion: string }
export interface VisualizerSpec {
  statusOrder: string[];
  acUnitLabel: string;
  statusClass?: Record<string, string>;
  assignee?: string;
  pr?: VisualizerPr;
  acText?: VisualizerAcText;
  acProof?: VisualizerAcProof;
  acEvidence?: VisualizerAcEvidence;
}

export interface Payload {
  title: string; preset: string; projectDir: string; fetchedAt: string;
  trackerChangedAt: string | null; ok: boolean;
  primitives: Partial<Record<PrimitiveName, boolean>>;
  // VIZ-3: the preset's `visualizer` block (VIZ-1), validated server-side at board time —
  // `null` when the preset declares none, or when a declared block fails validation (in which
  // case `visualizerError` names the offending zod issue path; the raw invalid data never ships).
  visualizer: VisualizerSpec | null;
  visualizerError?: string;
  issues: CoreIssue[]; findings: Finding[];
  audit: Record<string, AuditEntry[]>;
  timestamps: Record<string, Timestamps>;
  error?: string;
}
