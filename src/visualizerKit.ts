// visualizer-kit: the STABLE subpath a repo-owned dashboard `extension.tsx` imports
// (VIZ-13/VIZ-14) — the layer-2 code seam's analog of `ztrack/preset-kit`.
//
// BUILD PREREQUISITE (why this file lives here, not under `visualizer/client/`): the
// visualizer client tree is `@ts-nocheck` on its Bun-only entry points and the tsc build
// (`tsconfig.build.json`) includes `src/**` only (`visualizer/server.ts:1`) — so a kit that
// must ship real `.d.ts` types from `npm run build` cannot be authored under
// `visualizer/client/`. This file is the ONE authored, AUTHORITATIVE source of `Payload` and
// `VisualizerExtension`; `visualizer/client/model.ts` keeps its own hand-mirrored `Payload`
// (a type-only import from here does not typecheck under `visualizer/tsconfig.json` — see the
// "the wire payload" comment below for why) with an executable mutual-assignability guard
// (`src/visualizerKit.test.ts`) keeping the two copies from silently diverging.
//
// SLOT BOUND, stated honestly: `VisualizerExtension`'s members reach specific,
// preset-specific render slots and nothing else —
//   - `issuePanels`               → inside the issue detail drawer (`visualizer/client/main.tsx:342`)
//   - `acText` / `acProof` / `acEvidence` → the detail AC list (`visualizer/client/main.tsx:333-336`)
//   - `statusClass`               → the state-pill css class
// The preset-agnostic SKELETON — columns, list rows, card faces, sidebar, topbar — stays
// core-owned, exactly as `src/core/engine.ts` is the core-owned bound for presets. Whole-board
// replacement is a different, wider seam (docs/VISUALIZER.md depth (iv) — the raw `/api/board`
// `Payload` + GraphQL contract), not this one.
//
// DATA REACH, stated: extensions see the issue/AC objects INCLUDING preset ride-along fields
// (arbitrary extra keys a preset's own schema adds — `model.ts:1-9`'s `[k: string]: unknown`).
// Findings, audit entries, and timestamps stay core-rendered; extensions never see them.
//
// DRIFT GUARD BY CONSTRUCTION: this interface deliberately has NO `statusOrder`, no
// `acUnitLabel`, and no field-mapping members (`assignee`, `pr`, or the field names inside
// `acText`/`acProof`/`acEvidence`). That vocabulary is layer-1 DATA, authored once in the
// user's own `preset.mts` and validated against `VisualizerSpecSchema` (`src/core/engine.ts`,
// re-exported from `ztrack/preset-kit`) — never duplicated here. Reintroducing any of those
// members would recreate the exact two-file vocabulary drift that rotted the old hardcoded
// `EXTENSIONS` map's `default` key (§2 evidence #4 of the dashboard moddability spec). A pinning
// test (`src/visualizerKit.test.ts`, VIZ-14 dev/03) fails the build if this ever regresses.

import type { ReactNode } from 'react';

// Re-exported so `extension.tsx` (and anything typing against the wire payload) imports ONLY
// `ztrack/visualizer-kit` — never `ztrack/preset-kit` or `src/core/engine.ts` directly. This is
// the SAME type VIZ-1 defined and `ztrack/preset-kit` already re-exports; visualizer-kit
// re-exports it again under this subpath purely for import ergonomics (one import for
// dashboard-extension authors), not a second definition.
export type { VisualizerSpec } from './core/engine.ts';
import type { VisualizerSpec } from './core/engine.ts';

// ── the wire payload ─────────────────────────────────────────────────────────────────────────
// Mirrors `visualizer/client/model.ts`'s CORE model types (`CoreEvidence`/`CoreAC`/`CoreIssue`/
// `Finding`/`PrimitiveName`/`AuditEntry`/`Timestamps`/`VisualizerSpec`/`Payload`). This file is
// the AUTHORITATIVE copy for `ztrack/visualizer-kit` consumers (`extension.tsx` authors); a
// `import type` re-export from `model.ts` was tried (one authored copy) but does NOT typecheck
// under `visualizer/tsconfig.json` — this module transitively re-exports `VisualizerSpec` from
// `src/core/engine.ts`, which imports `node:crypto`, and the visualizer's tsconfig has no
// `"node"` ambient types (by design: it is a DOM/react client program). So `model.ts` keeps its
// OWN hand-mirror (unchanged by this task, same convention as its `CoreIssue`/`Finding` mirrors)
// and `src/visualizerKit.test.ts` carries an executable mutual-assignability guard so the two
// copies cannot silently diverge — `npm run typecheck` / `bun test` fail if they do.

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

/** The `/api/board` response shape (VIZ-3). Core keys are semver-covered; preset ride-along
 *  fields on `issues`/`acceptanceCriteria` are preset-owned and NOT part of this stability
 *  promise (see docs/VISUALIZER.md depth (iv)). */
export interface Payload {
  title: string; preset: string; projectDir: string; fetchedAt: string;
  trackerChangedAt: string | null; ok: boolean;
  primitives: Partial<Record<PrimitiveName, boolean>>;
  // The preset's `visualizer` block (VIZ-1), validated server-side at board time (VIZ-3) —
  // `null` when the preset declares none, or when a declared block fails validation (in which
  // case `visualizerError` names the offending zod issue path; the raw invalid data never
  // ships).
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

// ── the render-only extension contract ──────────────────────────────────────────────────────

/** The render-only surface of today's `PresetExtension` (`visualizer/client/extensions.ts:11-21`)
 *  — deliberately excludes `statusOrder`/`acUnitLabel`/field-mapping members; see the DRIFT
 *  GUARD note above the file header. `issuePanels` receives `(issue, projectUrl)` — the SAME
 *  `/project/` URL mapper `acEvidence` already gets (`visualizer/client/main.tsx:336`) — so a
 *  panel can link evidence files under the project root. */
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

/** Identity helper — the blessed constructor for a `VisualizerExtension`, mirroring
 *  `definePreset` (`src/core/engine.ts`). Exists so an `extension.tsx` reads as a declaration
 *  (`export default defineVisualizerExtension({ ... })`) and so a future version can validate
 *  or wrap the object without every call site changing. */
export function defineVisualizerExtension(ext: VisualizerExtension): VisualizerExtension {
  return ext;
}
