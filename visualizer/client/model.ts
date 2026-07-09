// The client-side view of the CORE export. Core fields are known; preset-
// specific fields ride along as extra keys and are rendered by the extension.

import type { ReactNode } from 'react';

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
//
// VIZ-14 tried making this a `import type { Payload } from '../../src/visualizerKit.ts'`
// re-export instead (one authored copy). It does NOT work under this file's real typecheck (CI
// runs `bunx tsc --noEmit -p visualizer/tsconfig.json` — this tree is real-checked, only
// `server.ts`/`serverCore.ts` are `@ts-nocheck`): `visualizerKit.ts` re-exports `VisualizerSpec`
// from `src/core/engine.ts`, which imports `node:crypto`; `visualizer/tsconfig.json` has no
// `"node"` in its `types` array (by design — it's a DOM/react client program, not a Node one),
// so the transitive type-check fails with "Cannot find module 'node:crypto'" even though the
// import is type-only and erases at runtime. Widening `visualizer/tsconfig.json`'s ambient
// types is out of scope here (VIZ-14's touch list is `src/visualizerKit.ts`, `package.json`,
// `docs/API.md`, and this file ONLY if the type-only import works). So the mirror stays, and
// `src/visualizerKit.test.ts`'s "Payload mutual-assignability" guard (VIZ-14 dev/03-adjacent)
// keeps it honest: it fails `bun test`/`npm run typecheck` if this copy and the kit's
// authoritative `Payload` ever diverge.
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

// VIZ-4: hand-mirrored render-only extension contract (mirrors `VisualizerExtension`,
// src/visualizerKit.ts — the kit's authoritative, published copy). A type-only import from the
// kit does not typecheck here for the exact reason documented on `VisualizerSpec` above
// (visualizerKit.ts transitively re-exports from src/core/engine.ts, which imports
// `node:crypto`; this tsconfig has no "node" ambient types by design). Same convention as every
// other mirror in this file, and — like `Payload` — kept honest by an EXECUTABLE guard:
// `src/visualizerKit.test.ts` carries an `Equals<KitVisualizerExtension, ClientVisualizerExtension>`
// mutual-assignability assertion beside its Payload guard, so `npm run typecheck`/`bun test`
// fail the moment this copy and the kit's diverge (the guard cannot live in the client test
// files — they are excluded from every tsconfig and would be inert).
export interface VisualizerExtension {
  /** -> css `state-<x>` for the status pill. */
  statusClass?(status: string): string;
  /** The AC label, rendered in the detail AC list. */
  acText?(ac: CoreAC): ReactNode;
  /** AC evidence thumbnails/links, rendered in the detail AC list. */
  acEvidence?(ac: CoreAC, projectUrl: (path: string) => string): ReactNode;
  /** AC proof (explanation + refs), rendered in the detail AC list. */
  acProof?(ac: CoreAC): ReactNode;
  /** Preset-specific issue-level panels, rendered inside the issue detail drawer. */
  issuePanels?(issue: CoreIssue, projectUrl: (path: string) => string): ReactNode;
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
  // VIZ-13: set when the repo-owned `extension.tsx` failed to compile (a syntax error, or an
  // unresolvable 'ztrack/visualizer-kit' import) — the server rebuilds the served bundle WITHOUT
  // the repo extension (failure isolation: the board keeps working) and ships this field so the
  // client can render a notice with the compile-error text instead of failing silently.
  extensionError?: string;
  issues: CoreIssue[]; findings: Finding[];
  audit: Record<string, AuditEntry[]>;
  timestamps: Record<string, Timestamps>;
  error?: string;
}
