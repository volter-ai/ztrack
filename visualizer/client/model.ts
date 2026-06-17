// The client-side view of the CORE export. Core fields are known; preset-
// specific fields ride along as extra keys and are rendered by the extension.

export interface CoreEvidence { id: string; [k: string]: unknown }
export interface CoreAC { id: string; status: string; evidence: CoreEvidence[]; [k: string]: unknown }
export interface CoreIssue {
  id: string; title: string; summary: string; status: string;
  acceptanceCriteria: CoreAC[]; [k: string]: unknown;
}
export interface Finding {
  code: string; severity: 'error' | 'warning'; message: string;
  issueId?: string; acId?: string; evidenceId?: string;
}
export type PrimitiveName = 'labels' | 'relations' | 'linkedIssues' | 'children' | 'sources' | 'category' | 'proof' | 'audit';
export interface AuditEntry { ts: string; issueId: string; op: string; field?: string; from?: string; to?: string; actor?: string }
export interface Timestamps { created?: string; updated?: string; stateSince?: string }
export interface Payload {
  title: string; preset: string; projectDir: string; fetchedAt: string;
  trackerChangedAt: string | null; ok: boolean;
  primitives: Partial<Record<PrimitiveName, boolean>>;
  issues: CoreIssue[]; findings: Finding[];
  audit: Record<string, AuditEntry[]>;
  timestamps: Record<string, Timestamps>;
  error?: string;
}
