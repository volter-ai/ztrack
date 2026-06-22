// The core contract: parse → strict Zod schema (SHAPE) → derive an analyzed model →
// declarative rule records (MEANING) → { findings, export }. A preset plugs an SDLC's
// schema + rules into this engine; the engine knows nothing about any specific SDLC.
//
//   1. ONE hard schema validates the SHAPE: issues > acceptanceCriteria > evidence (strict Zod).
//   2. mdast parses markdown straight into that schema.
//   3. The engine DERIVES an analyzed model (per-item scopes, id aggregates, the unified
//      block graph); rules are records that select facts off it and describe violations.
//      Preset-specific analysis goes in Preset.derive. No rule walks the tree or runs an
//      algorithm — the schema carries shape, the rules carry meaning.
//   4. Everything else reads the export (the parsed Root) or a few affordances.
//
// The system requires only the CORE fields below (what the CLI hooks into). A
// preset adds MORE strict fields by extending these — still hard Zod, just
// preset-specific rather than system-required. There is no `.passthrough()`, no
// `unknown`, no preset-private "native", no `toIssues` projection: the parse
// target IS the schema.

import { z } from 'zod';
import type { RuleCategory, RuleDepth } from '../checkRules.ts';
import { blockCycles, blockerRefProblems, completionViolations, nodeIndex } from './blocking.ts';
import { formatRef } from './ref.ts';

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
// A reference, from one node, to another node it blocks on. The target is either a
// whole issue (`ac` omitted) or a specific acceptance criterion (`ac` set). Authored
// relatively (a bare id means "an AC in this issue") but stored resolved, so the
// validated root only ever holds fully-qualified addresses. See core/ref.ts for the
// universal-id grammar (`<issue>` / `<issue>:<ac>`) and core/blocking.ts for the
// unified dependency graph these feed.
export interface BlockRef { issue: string; ac?: string }

export const PRIMITIVES = ['labels', 'relations', 'linkedIssues', 'children', 'sources', 'category', 'proof', 'blocking', 'audit'] as const;
export type PrimitiveName = (typeof PRIMITIVES)[number];

// ── system-required core (the CLI hooks into exactly these fields) ──────────
export interface CoreEvidence { id: string }
export interface CoreAC {
  id: string; status: string; evidence: CoreEvidence[];
  category?: string;        // primitive
  proof?: Proof;            // primitive
  blockedBy?: BlockRef[];   // primitive: nodes that must land before this one
  blocks?: BlockRef[];      // primitive: nodes this one must land before
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
  // requested rule categories → max depth. When set, only rules whose
  // category/depth fall within the request run (wellformed/invariant rules always
  // run). Absent = run every rule. This is the typed replacement for the old
  // `--categories` / organization.check.categories selector.
  categories?: Partial<Record<RuleCategory, number>>;
}

// The Context schema — the contract requires context to be typed AND validated as
// part of the single ValidationInput. Strict: a fact a rule reads must be declared
// here (a preset adds its own observed facts by passing an extended contextSchema).
const GitContextSchema = z.object({
  currentSha: z.string().optional(),
  existingCommits: z.array(z.string()).optional(),
  prs: z.record(z.string(), z.object({ headSha: z.string().optional(), merged: z.boolean().optional() }).strict()).optional(),
  branches: z.record(z.string(), z.string()).optional(),
}).strict();
const WorldEventSchema = z.object({
  id: z.string(), service: z.string(), type: z.string().optional(), text: z.string().optional(), annotationRequired: z.boolean().optional(),
}).strict();
const WorldAnnotationSchema = z.object({
  id: z.string(), service: z.string().optional(), eventId: z.string(),
  classification: z.enum(['source', 'noise', 'duplicate']), quote: z.string().optional(),
}).strict();
export const CoreContextSchema = z.object({
  now: z.string().optional(),
  phase: z.enum(['all', 'gate']).optional(),
  git: GitContextSchema.optional(),
  world: z.object({ events: z.array(WorldEventSchema).optional(), annotations: z.array(WorldAnnotationSchema).optional() }).strict().optional(),
  categories: z.record(z.string(), z.number()).optional(),
}).strict();

/** The ONE top-level schema: ValidationInput = { context, root }, both strict. A
 *  preset may pass an extended contextSchema for its own observed facts. */
export function makeValidationInputSchema<R extends CoreRoot>(
  rootSchema: z.ZodType<R>,
  contextSchema: z.ZodTypeAny = CoreContextSchema,
): z.ZodType<ValidationInput<R>> {
  return z.object({ context: contextSchema, root: rootSchema }).strict() as unknown as z.ZodType<ValidationInput<R>>;
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
// The whole typed thing being validated: observed facts (context) + the parsed
// tracker state (root). This is what `ValidationInputSchema.parse({context, root})`
// produces and what every rule receives.
export interface ValidationInput<R extends CoreRoot> {
  context: Context;
  root: R;
}

// ── the derived model: the analyzed projection a rule reads ──────────────────
// The engine derives this ONCE per check (CodeQL's "database" / ESLint's analyzed
// AST): the per-item scopes with their location baked in, the universal id
// aggregates, and the unified block graph (parameterized by the preset's terminal
// check). A preset adds its own analyzed facts under `derived` via Preset.derive.
// Rules never recompute any of this; they declare findings over it.
export interface Located { issueId?: string; acId?: string; evidenceId?: string }
export interface ModelIssue<R extends CoreRoot> { issueId: string; issue: R['issues'][number] }
export interface ModelAC<R extends CoreRoot> { issueId: string; acId: string; issue: R['issues'][number]; ac: R['issues'][number]['acceptanceCriteria'][number] }
export interface ModelEvidence<R extends CoreRoot> extends ModelAC<R> { evidenceId: string; ev: R['issues'][number]['acceptanceCriteria'][number]['evidence'][number] }
export interface CycleFact extends Located { issueId: string; cycle: string[] }
export interface BlockerFact extends Located { issueId: string; acId: string; kind: 'missing' | 'self'; refText: string }
export interface CompletionFact extends Located { issueId: string; nodeKey: string; depKey: string; depStatus: string }
export interface DerivedModel<R extends CoreRoot> {
  root: R;
  context: Context;
  issues: Array<ModelIssue<R>>;
  acs: Array<ModelAC<R>>;
  evidence: Array<ModelEvidence<R>>;
  duplicateIssueIds: Array<{ issueId: string }>;
  duplicateAcIds: Array<{ issueId: string; acId: string }>;
  graph: { cycles: CycleFact[]; blockerProblems: BlockerFact[]; completionViolations: CompletionFact[] };
  // preset-specific analyzed facts, keyed by name (filled by Preset.derive).
  derived: Record<string, Located[]>;
}

// A rule is a RECORD, not code: pick a list off the derived model (`select`), keep the
// matches (`when`), and describe each (`message`). The engine owns iteration and
// Finding construction — location (issueId/acId/evidenceId) is read off the selected
// item. No rule walks the tree, runs an algorithm, or imports an internal helper.
// `category`/`depth` classify the rule for the categories selector (Context.categories);
// `phase` mirrors gate vs transition enforcement (see ValidationInput docs above).
export interface RuleRecord<R extends CoreRoot, Item extends Located = Located> {
  code: string;
  severity?: Severity; // default 'error'
  phase?: 'gate' | 'transition';
  category?: RuleCategory;
  depth?: RuleDepth;
  select: (m: DerivedModel<R>) => Item[];
  when?: (item: Item, m: DerivedModel<R>) => boolean;
  message: (item: Item, m: DerivedModel<R>) => string;
}
export type Rule<R extends CoreRoot> = RuleRecord<R, Located>;

/** Authoring helper: infers the selected item type so `when`/`message` are typed,
 *  while storing as the existential `Rule<R>` a preset's `rules` array holds. */
export function rule<R extends CoreRoot, Item extends Located>(r: RuleRecord<R, Item>): Rule<R> {
  return r as unknown as Rule<R>;
}

/** The blessed preset constructor a repo-local preset calls — today an identity, but a
 *  stable seam so installed presets read `definePreset({...})` and we can add inference
 *  or validation later without breaking them. */
export function definePreset<R extends CoreRoot>(preset: Preset<R>): Preset<R> {
  return preset;
}

// The input to a preset's context provider. The loader supplies the project root
// and (depending on which surface called) the framed bundle or the already-parsed
// root, so a preset can derive facts like PR branches without the loader assuming
// anything about its shape.
export interface PresetContextInput {
  projectRoot: string;
  verifyCommits?: boolean;
  bundle?: string;   // present when validating the live tracker
  root?: CoreRoot;   // present when validating an already-exported root
}

// A preset: a hard schema (core + its own strict fields), an mdast parse that
// fills it, and rules over it. `R extends CoreRoot` is what guarantees the CLI's
// core affordances work against any preset.
export interface Preset<R extends CoreRoot> {
  name: string;
  schema: z.ZodType<R>;
  // optional strict schema for preset-specific observed context facts; defaults to
  // CoreContextSchema. Composed with `schema` into the one ValidationInputSchema.
  // A preset adding facts should extend CoreContextSchema so now/phase/categories
  // (the universal run selectors the loader overlays) stay valid.
  contextSchema?: z.ZodTypeAny;
  // The preset's HALF of the impure loader: gather exactly the observed Context
  // facts THIS preset's rules read (git, world, services). Like the schema, context
  // is preset-owned — the loader does not assume git/world for everyone. The loader
  // overlays the universal run selectors (now/phase/categories) over the result.
  // Omit when the preset's rules need no observed facts.
  loadContext?: (input: PresetContextInput) => Context | Promise<Context>;
  parse: (markdown: string) => unknown; // mdast -> candidate object (validated by `schema`)
  rules: Rule<R>[];
  // Preset-specific analyzed facts: given the engine's core DerivedModel, return extra
  // fact lists (keyed by name) for this preset's rules to `select` over. This is where
  // a preset's own imperative computation lives — rules stay pure declarations. Omit
  // when the core model's facts suffice.
  derive?: (model: DerivedModel<R>) => Record<string, Located[]>;
  // The preset's terminal-state check, parameterizing the universal block graph's
  // completion gate (an AC-less issue counts as "satisfied" only when this says so).
  isIssueDone?: (issue: R['issues'][number]) => boolean;
  // which standard primitives this SDLC implements; absent/false = "not
  // implemented" (tooling shows it as such rather than as empty).
  primitives?: Partial<Record<PrimitiveName, boolean>>;
  // optional authoring affordance (NOT validation): a starter issue body for
  // `ztrack issue scaffold`. Presets may omit it (tooling falls back to a generic body).
  scaffold?: (title: string) => string;
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

// A rule runs unless the request narrows it out: an absent/`wellformed` category is
// a true invariant and always runs; a categorized rule runs only when the request
// asks for that category at or beyond the rule's depth.
function ruleEnabled<R extends CoreRoot>(rule: Rule<R>, categories?: Partial<Record<RuleCategory, number>>): boolean {
  if (!categories) return true;
  if (!rule.category || rule.category === 'wellformed') return true;
  const max = categories[rule.category];
  return max !== undefined && (rule.depth ?? 1) <= max;
}

// Build the analyzed model from the validated root + context. The block-graph
// algorithms (cycle detection, blocker resolution, the completion gate) run here ONCE;
// rules read the results. `isIssueDone` parameterizes the completion gate for AC-less
// issues, whose terminal status differs per preset.
export function deriveCoreModel<R extends CoreRoot>(root: R, context: Context, isIssueDone?: (issue: R['issues'][number]) => boolean): DerivedModel<R> {
  const issues = root.issues.map((issue) => ({ issueId: issue.id, issue })) as Array<ModelIssue<R>>;
  const acs = root.issues.flatMap((issue) => issue.acceptanceCriteria.map((ac) => ({ issueId: issue.id, acId: ac.id, issue, ac }))) as Array<ModelAC<R>>;
  const evidence = acs.flatMap(({ issueId, acId, issue, ac }) => ac.evidence.map((ev) => ({ issueId, acId, evidenceId: ev.id, issue, ac, ev }))) as Array<ModelEvidence<R>>;

  const duplicateIssueIds: Array<{ issueId: string }> = [];
  const seenIssue = new Set<string>();
  for (const i of root.issues) { if (seenIssue.has(i.id)) duplicateIssueIds.push({ issueId: i.id }); seenIssue.add(i.id); }

  const duplicateAcIds: Array<{ issueId: string; acId: string }> = [];
  for (const issue of root.issues) {
    const seen = new Set<string>();
    for (const ac of issue.acceptanceCriteria) { if (seen.has(ac.id)) duplicateAcIds.push({ issueId: issue.id, acId: ac.id }); seen.add(ac.id); }
  }

  const idx = nodeIndex(root);
  const cycles: CycleFact[] = blockCycles(root).map((cycle) => {
    const head = idx.get(cycle[0]!)!;
    return { issueId: head.issue.id, ...(head.ac ? { acId: head.ac.id } : {}), cycle };
  });
  const blockerProblems: BlockerFact[] = blockerRefProblems(root).map((p) => ({ issueId: p.issueId, acId: p.acId, kind: p.kind, refText: formatRef(p.ref) }));
  const completionFacts: CompletionFact[] = completionViolations(root, isIssueDone ? { isIssueDone: isIssueDone as (i: CoreIssue) => boolean } : {}).map(({ node, dep }) => ({
    issueId: node.issue.id, ...(node.ac ? { acId: node.ac.id } : {}),
    nodeKey: node.key, depKey: dep.key, depStatus: dep.kind === 'ac' ? dep.ac!.status : 'incomplete',
  }));

  return { root, context, issues, acs, evidence, duplicateIssueIds, duplicateAcIds, graph: { cycles, blockerProblems, completionViolations: completionFacts }, derived: {} };
}

// Evaluate one record: select a list off the model, keep the matches, describe each.
// Location (issueId/acId/evidenceId) is read off the selected item, not authored.
function evalRecord<R extends CoreRoot>(r: RuleRecord<R, Located>, model: DerivedModel<R>): Finding[] {
  return r.select(model)
    .filter((item) => (r.when ? r.when(item, model) : true))
    .map((item): Finding => ({
      code: r.code,
      severity: r.severity ?? 'error',
      message: r.message(item, model),
      ...(item.issueId ? { issueId: item.issueId } : {}),
      ...(item.acId ? { acId: item.acId } : {}),
      ...(item.evidenceId ? { evidenceId: item.evidenceId } : {}),
    }));
}

function runRules<R extends CoreRoot>(preset: Preset<R>, input: ValidationInput<R>): CheckResult<R> {
  const ctx = input.context;
  const model = deriveCoreModel(input.root, ctx, preset.isIssueDone);
  if (preset.derive) {
    try { Object.assign(model.derived, preset.derive(model)); }
    catch (error) { return { ok: false, findings: [{ code: 'derive_threw', severity: 'error', message: `Preset derive threw: ${String((error as Error)?.message ?? error)}` }], export: input.root }; }
  }
  const active = preset.rules
    .filter((r) => (ctx.phase === 'gate' ? r.phase !== 'transition' : true))
    .filter((r) => ruleEnabled(r, ctx.categories));
  // A rule is contracted pure, but Rule is a public extension point: a buggy rule's
  // select/when/message must surface as a finding, not crash the whole check.
  const findings = active.flatMap((r) => {
    try {
      return evalRecord(r, model);
    } catch (error) {
      return [{ code: 'rule_threw', severity: 'error', message: `Rule '${r.code}' threw: ${String((error as Error)?.message ?? error)}` } as Finding];
    }
  });
  return { ok: !findings.some((f) => f.severity === 'error'), findings, export: input.root };
}

/** The one entry point: parse -> ValidationInputSchema.parse({context, root}) ->
 *  pure rules. The validated Root is the export; nothing downstream re-parses or
 *  re-derives. */
export function check<R extends CoreRoot>(preset: Preset<R>, markdown: string, ctx: Context = {}): CheckResult<R> {
  let candidate: unknown;
  try {
    candidate = preset.parse(markdown);
  } catch (error) {
    return { ok: false, findings: [{ code: 'parse_failed', severity: 'error', message: String((error as Error)?.message ?? error) }] };
  }
  return validateAndRun(preset, ctx, candidate, false);
}

/** Validate an already-parsed Root (the exported, validated model) against the same
 *  schema + rules — the entry point for `check --input <root.json>` and CI. */
export function checkRoot<R extends CoreRoot>(preset: Preset<R>, root: unknown, ctx: Context = {}): CheckResult<R> {
  return validateAndRun(preset, ctx, root, true);
}

// Compose the strict ValidationInputSchema, validate {context, root}, run rules.
// safeParse is wrapped: composing/validating across a mismatched zod instance (a
// repo-local preset built against a different zod major) must surface as a finding,
// not a raw crash of `ztrack check`.
function validateAndRun<R extends CoreRoot>(preset: Preset<R>, ctx: Context, root: unknown, isExportedRoot: boolean): CheckResult<R> {
  let result: ReturnType<z.ZodType<ValidationInput<R>>['safeParse']>;
  try {
    const inputSchema = makeValidationInputSchema(preset.schema, preset.contextSchema);
    result = inputSchema.safeParse({ context: ctx, root });
  } catch (error) {
    return { ok: false, findings: [{ code: 'schema_error', severity: 'error', message: `Could not validate against the preset schema (a preset/zod version mismatch?): ${String((error as Error)?.message ?? error)}` }] };
  }
  if (!result.success) {
    return isExportedRoot
      ? { ok: false, findings: [{ code: 'root_shape_invalid', severity: 'error', message: 'Input does not match the preset root schema. If this is an old exported snapshot, re-run `ztrack export`.' }, ...shapeFindings(result.error)] }
      : { ok: false, findings: shapeFindings(result.error) };
  }
  return runRules(preset, result.data);
}
