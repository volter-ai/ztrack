// One browser-safe model for the standalone and embedded visualizer. This leaf has no Node or
// tracker-runtime imports, so React clients can consume it directly without maintaining a mirror.
import type { ReactNode } from 'react';
import { z } from 'zod';

const VisualizerAcTextSchema = z.object({
  id: z.string(),
  text: z.string(),
  version: z.string().optional(),
}).strict();

const VisualizerPrSchema = z.object({
  field: z.string(),
  urlField: z.string(),
}).strict();

const VisualizerAcProofSchema = z.object({
  field: z.string(),
  explanation: z.string(),
  evidenceRefs: z.string(),
}).strict();

const VisualizerAcEvidenceSchema = z.object({
  field: z.string(),
  image: z.string(),
  commit: z.string(),
  acVersion: z.string(),
}).strict();

/** Strict data-only vocabulary a preset supplies to the visualizer. */
export const VisualizerSpecSchema = z.object({
  statusOrder: z.array(z.string()),
  acUnitLabel: z.string(),
  statusClass: z.record(z.string(), z.string()).optional(),
  assignee: z.string().optional(),
  pr: VisualizerPrSchema.optional(),
  acText: VisualizerAcTextSchema.optional(),
  acProof: VisualizerAcProofSchema.optional(),
  acEvidence: VisualizerAcEvidenceSchema.optional(),
}).strict();

export type VisualizerSpec = z.infer<typeof VisualizerSpecSchema>;
export type VisualizerAcText = NonNullable<VisualizerSpec['acText']>;
export type VisualizerPr = NonNullable<VisualizerSpec['pr']>;
export type VisualizerAcProof = NonNullable<VisualizerSpec['acProof']>;
export type VisualizerAcEvidence = NonNullable<VisualizerSpec['acEvidence']>;

export interface CoreEvidence { id: string; [key: string]: unknown }
export interface CoreAC { id: string; status: string; evidence: CoreEvidence[]; [key: string]: unknown }
export interface CoreIssue {
  id: string;
  title: string;
  summary: string;
  status: string;
  acceptanceCriteria: CoreAC[];
  [key: string]: unknown;
}

export interface Finding {
  code: string;
  severity: 'error' | 'warning' | 'acknowledged';
  message: string;
  issueId?: string;
  acId?: string;
  evidenceId?: string;
  subject?: string;
  waivable?: boolean;
  fix?: string;
  origin?: { path: string; line?: number };
}

export type PrimitiveName = 'labels' | 'relations' | 'children' | 'sources' | 'category' | 'proof' | 'blocking' | 'audit';
export interface AuditEntry { ts: string; issueId: string; op: string; field?: string; from?: string; to?: string; actor?: string }
export interface Timestamps { created?: string; updated?: string; stateSince?: string }
export interface OperationalBlockStatus { blocked: boolean; blockers: Array<{ issue: string; ac?: string }> }

export interface Payload {
  title: string;
  preset: string;
  projectDir: string;
  fetchedAt: string;
  trackerChangedAt: string | null;
  ok: boolean;
  primitives: Partial<Record<PrimitiveName, boolean>>;
  visualizer: VisualizerSpec | null;
  visualizerError?: string;
  /** Transitional standalone notice; the payload builder itself never compiles an extension. */
  extensionError?: string;
  themeError?: string;
  operationalBlocking: Record<string, OperationalBlockStatus>;
  issues: CoreIssue[];
  findings: Finding[];
  audit: Record<string, AuditEntry[]>;
  timestamps: Record<string, Timestamps>;
  error?: string;
}

export interface VisualizerExtension {
  isOperationallyBlocked?(issue: CoreIssue): boolean;
  operationalBlockLabel?(issue: CoreIssue): string | undefined;
  blockedViewLabel?: string;
  statusClass?(status: string): string;
  acText?(ac: CoreAC): ReactNode;
  acEvidence?(ac: CoreAC, projectUrl: (path: string) => string): ReactNode;
  acProof?(ac: CoreAC): ReactNode;
  issuePanels?(issue: CoreIssue, projectUrl: (path: string) => string): ReactNode;
}
