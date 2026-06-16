// The core contract: parse → strict Zod schema → pure rules → { findings, export }.
// A preset plugs an SDLC's schema + rules into this engine; the engine knows nothing
// about any specific SDLC.
//
//   1. ONE hard schema: issues > acceptanceCriteria > evidence (strict Zod).
//   2. mdast parses markdown straight into that schema.
//   3. Zod rules express every violation, reading injected local context.
//   4. Everything else reads the export (the parsed Root) or a few affordances.
//
// The system requires only the CORE fields below (what the CLI hooks into). A
// preset adds MORE strict fields by extending these — still hard Zod, just
// preset-specific rather than system-required. There is no `.passthrough()`, no
// `unknown`, no preset-private "native", no `toIssues` projection: the parse
// target IS the schema.

import { z } from 'zod';

// ── optional task-management primitives ─────────────────────────────────────
// Standard shapes every task system has. They are NOT required: a preset opts
// into the ones its SDLC uses and declares so (see `Preset.primitives`); the
// rest are simply "not implemented". The core defines the SHAPE so the CLI and
// visualizer hook into them uniformly across presets.
export interface Relation { type: 'blocks' | 'blocked-by' | 'relates'; issueId: string }
export interface LinkedIssue { system: string; key: string; url?: string }
export interface Source { id: string; kind: string; ref?: string; content?: string }
// Proof: evidence without an explanation of how it demonstrates the criterion is
// incomplete. A proof ties an AC's claim to the evidence that backs it.
export interface Proof { explanation: string; evidenceRefs: string[] }

export const PRIMITIVES = ['labels', 'relations', 'linkedIssues', 'children', 'sources', 'category', 'proof', 'audit'] as const;
export type PrimitiveName = (typeof PRIMITIVES)[number];

// ── system-required core (the CLI hooks into exactly these fields) ──────────
export interface CoreEvidence { id: string }
export interface CoreAC {
  id: string; status: string; evidence: CoreEvidence[];
  category?: string; // primitive
  proof?: Proof;     // primitive
}
export interface CoreIssue {
  id: string; title: string; summary: string; status: string; acceptanceCriteria: CoreAC[];
  labels?: string[];            // primitive
  relations?: Relation[];       // primitive
  linkedIssues?: LinkedIssue[]; // primitive
  children?: string[];          // primitive
  sources?: Source[];           // primitive
}
export interface CoreRoot { issues: CoreIssue[] }

// ── audit (a derived primitive): a separate append-only log, written on every
// edit by the mutation affordances — NOT git history, NOT the markdown body.
// Timestamps (created, state-since) are derived from it.
export interface AuditEntry {
  ts: string;        // ISO timestamp the edit happened
  issueId: string;
  op: string;        // e.g. "status", "ac.check", "evidence.add"
  field?: string;
  from?: string;
  to?: string;
  actor?: string;
}

// ── findings + injected local context ──────────────────────────────────────
export type Severity = 'error' | 'warning';
export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  issueId?: string;
  acId?: string;
  evidenceId?: string;
}
export interface Context {
  now?: string;
  // which rule phases to run. 'all' (default) runs every rule — the strict,
  // write/promote validation. 'gate' runs only phase!=='transition' rules — the
  // light ongoing check (matches a real tracker's continuous gate, which doesn't
  // re-enforce structure/readiness on already-landed issues).
  phase?: 'all' | 'gate';
  // the git world: commits that exist, and per-PR head sha + merged state
  // (keyed by PR url). A preset's freshness/merge rules read these.
  git?: {
    currentSha?: string;
    existingCommits?: string[];
    prs?: Record<string, { headSha?: string; merged?: boolean }>;
    // resolvable branch heads (branch name -> head sha). a preset can anchor evidence to a
    // tracker branch head; other presets simply leave this unset.
    branches?: Record<string, string>;
  };
  // the twin world as an evidence substrate (the sources feature). The loader
  // injects captured event envelopes (payload opaque; `text` is precomputed for
  // quote checks) and the tracker's annotations over them (the clean
  // source/noise/duplicate vocabulary). Rules read these to ground issue sources.
  world?: {
    // annotationRequired=false marks a mechanical sync record (egress, connector
    // delta) that need not be annotated — it still exists for eventId resolution.
    events?: readonly { id: string; service: string; type?: string; text?: string; annotationRequired?: boolean }[];
    annotations?: readonly {
      id: string; service?: string; eventId: string;
      classification: 'source' | 'noise' | 'duplicate'; quote?: string;
    }[];
  };
}

// A rule is pure: (the typed root + context) -> findings. No I/O, no globals.
//
// `phase` mirrors how a real SDLC enforces at two surfaces:
//   - 'gate'       — always-on invariants + the light ongoing check (data integrity,
//                    source linking, cross-issue reconciliation). Run on every check.
//   - 'transition' — heavy readiness/structure/promotion rules a real tracker enforces
//                    only when an issue is *written or promoted* (section template,
//                    evidence anchoring, state→AC gates). Skipped in 'gate' phase so an
//                    ongoing check doesn't re-litigate already-landed issues.
// Absent = 'gate' (an unmarked rule is a true invariant that should always hold).
export interface Rule<R extends CoreRoot> {
  name: string;
  phase?: 'gate' | 'transition';
  run: (root: R, ctx: Context) => Finding[];
}

// A preset: a hard schema (core + its own strict fields), an mdast parse that
// fills it, and rules over it. `R extends CoreRoot` is what guarantees the CLI's
// core affordances work against any preset.
export interface Preset<R extends CoreRoot> {
  name: string;
  schema: z.ZodType<R>;
  parse: (markdown: string) => unknown; // mdast -> candidate object (validated by `schema`)
  rules: Rule<R>[];
  // which standard primitives this SDLC implements; absent/false = "not
  // implemented" (tooling shows it as such rather than as empty).
  primitives?: Partial<Record<PrimitiveName, boolean>>;
}

export interface CheckResult<R extends CoreRoot> {
  ok: boolean;
  findings: Finding[];
  export?: R; // the parsed Root — what every other surface reads
}

function shapeFindings(error: z.ZodError): Finding[] {
  return error.issues.map((issue) => ({
    code: 'wellformed_shape',
    severity: 'error' as const,
    message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  }));
}

/** The one entry point: parse -> hard-validate -> rules. The validated Root is
 *  the export; nothing downstream re-parses or re-derives. */
export function check<R extends CoreRoot>(preset: Preset<R>, markdown: string, ctx: Context = {}): CheckResult<R> {
  let candidate: unknown;
  try {
    candidate = preset.parse(markdown);
  } catch (error) {
    return { ok: false, findings: [{ code: 'parse_failed', severity: 'error', message: String((error as Error)?.message ?? error) }] };
  }
  const result = preset.schema.safeParse(candidate);
  if (!result.success) return { ok: false, findings: shapeFindings(result.error) };
  const root = result.data;
  const active = ctx.phase === 'gate' ? preset.rules.filter((r) => r.phase !== 'transition') : preset.rules;
  // Rules are contracted to be pure and not throw, but Rule is a public extension point:
  // a buggy third-party rule must surface as a finding, not crash the whole check.
  const findings = active.flatMap((rule) => {
    try {
      return rule.run(root, ctx);
    } catch (error) {
      return [{ code: 'rule_threw', severity: 'error', message: `Rule '${rule.name}' threw: ${String((error as Error)?.message ?? error)}` } as Finding];
    }
  });
  return { ok: !findings.some((f) => f.severity === 'error'), findings, export: root };
}
