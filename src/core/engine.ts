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

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RuleCategory, RuleDepth } from '../checkRules.ts';
import { blockCycles, blockerRefProblems, completionViolations, nodeIndex } from './blocking.ts';
import { formatRef } from './ref.ts';
import { splitIssueBundle } from './bundle.ts';

// ── optional task-management primitives ─────────────────────────────────────
// Standard shapes every task system has. They are NOT required: a preset opts
// into the ones its SDLC uses and declares so (see `Preset.primitives`); the
// rest are simply "not implemented". The core defines the SHAPE so the CLI and
// visualizer hook into them uniformly across presets.
export interface Relation { type: 'blocks' | 'blocked-by' | 'relates'; issueId: string }
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

export const PRIMITIVES = ['labels', 'relations', 'children', 'sources', 'category', 'proof', 'blocking', 'audit'] as const;
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
  children?: string[];          // primitive
  sources?: Source[];           // primitive
  // (waivers are NOT a primitive on the issue — they live in context.waivers; see WaiverDirective)
}
export interface CoreRoot { issues: CoreIssue[] }

// Where a record's content lives on disk: the file (and, for a `document`-sourced issue — ZTB-4 —
// the line span of its section within that file) the record was read from. Populated at
// construction, never authored by a rule. Named `origin`, NOT `Source` — `Source` (above) is the
// unrelated domain type for
// evidence sources on issues.
export interface Origin { path: string; lineStart?: number; lineEnd?: number }

// The backend's STRUCTURED view of one issue: the metadata it keeps in columns (id, title,
// status, assignee, labels, children) plus the content `body` markdown. The preset's `parse`
// reads metadata from these fields and content from `body` (mdast) — core NEVER synthesizes
// metadata-as-markdown for the parser to read back (that round-trip caused the body↔column
// split-brain). `IssueColumns` is the inverse: the metadata `serialize` writes to the columns.
export interface IssueRecord {
  id: string;
  title: string;
  status: string;        // the tracker state name = the issue's lifecycle status
  assignee?: string;
  labels?: string[];
  children?: string[];
  body: string;          // content markdown only (no synthesized `# id: title`/Status/… header)
  origin?: Origin;        // where this record's content lives on disk (issue-per-file: no line span)
}
export interface IssueColumns {
  title?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  children?: string[];
}

// A WAIVER is an eslint-`disable`-style directive: a LOCATED, finding-specific acknowledgment
// that one particular check finding on an issue (optionally a specific AC) is knowingly
// accepted — NOT a blanket "this whole issue is fine." It is parsed by the CORE (universal,
// never per-preset) from each issue's `## Waivers` section into `context.waivers`, then
// applied as a post-filter: it downgrades the matching `error` finding to `acknowledged`, and
// a waiver that matches NOTHING is itself reported (`waiver_unused`) — the self-cleaning
// staleness signal (eslint's `--report-unused-disable-directives`), so it can't silently rot.
// `reason` and `by` (the git-identity sign-off) are required. Structural invariants
// (`waivable === false`) can never be waived no matter who signs off.
//
// `ref` is the `// eslint-disable-next-line` upgrade: pin the waiver to ONE finding occurrence
// by its `subject` (or `evidenceId`). A ref-pinned waiver can suppress only that occurrence and
// self-expires when the subject changes. An UNPINNED waiver that matches a subject-bearing
// finding still downgrades it (back-compat) but is flagged `waiver_overbroad` (warning) — the
// coarse `/* eslint-disable rule */` form, made visible so it can be tightened with `ref:`.
export interface WaiverDirective {
  issueId: string;       // the issue the finding is on
  code: string;          // the finding code it accepts (e.g. 'evidence_commit_not_found')
  reason: string;        // why the failing state is acceptable (required; empty → error)
  approvedBy: string;    // the authority who signed off — the git identity (required; empty → error)
  acId?: string;         // optional: scope to one AC's finding; absent = any AC / issue-level
  ref?: string;          // optional: pin to ONE occurrence by its Finding.subject (or evidenceId)
}

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
// 'acknowledged' is a downgraded 'error' — a real finding an authority's fresh waiver
// has accepted. It is reported (so the acceptance is visible) but does NOT gate, exactly
// like a warning. Only 'error' gates `ok`.
export type Severity = 'error' | 'warning' | 'acknowledged';
export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  issueId?: string;
  acId?: string;
  evidenceId?: string;
  // The specific offending token distinguishing THIS occurrence of `code` from another at the
  // same location — e.g. the missing commit sha for `evidence_commit_not_found`. A `ref:` waiver
  // pins to it, so the waiver suppresses ONLY this occurrence and self-expires the instant the
  // token changes (re-cite to a good sha ⇒ finding gone ⇒ waiver_unused; a DIFFERENT bad sha ⇒
  // new subject ⇒ still fires). Absent ⇒ no finer discriminator than acId. Rule-authored (opt-in).
  subject?: string;
  // false ⇒ a waiver may NOT downgrade this finding. Structural-integrity violations (a
  // block cycle, a duplicate id, a checkbox/status contradiction) can never be coherent no
  // matter who signs off, so they stay errors even on a waived issue. Default (absent) =
  // waivable (readiness/acceptance findings the authority can accept).
  waivable?: boolean;
  // A one-line REMEDIATION hint — the exact action that resolves this finding (e.g. the
  // `ztrack ac patch …` to run). Preset-owned (via Preset.fixHint), shown under the finding
  // and returned over MCP so an agent can act directly instead of inferring the fix.
  fix?: string;
  // Where this finding's issue record lives on disk — copied 1:1 from the record's `origin`
  // (never authored by a rule), so a finding cites a real location. `line` (singular, not a
  // span) is the record origin's `lineStart`, when known.
  origin?: FindingOrigin;
}
export interface FindingOrigin { path: string; line?: number }

// ── parse-time diagnostics side-channel ──────────────────────────────────────
// A preset's `parse()` MAY attach a `diagnostics` array to the object it returns (e.g.
// `{ issues, diagnostics }`) for content that parsed but not as the author intended — a
// second AC section that would otherwise silently replace the first, a checkbox outside any
// recognized section, a malformed id. `check()` lifts these into findings (default severity
// 'warning') and strips the key before schema validation, mirroring the existing precedent of
// engine-emitted findings that belong to no rule (`parse_failed`, `wellformed_shape`,
// `waiver_*`). A preset that returns no `diagnostics` key behaves exactly as today.
export interface ParseDiagnostic {
  code: string;
  severity?: 'error' | 'warning';
  message: string;
  issueId?: string;
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
    // does a cited evidence file exist at its commit? keyed by `${commit}:${path}` → exists.
    // a preset that anchors image/artifact evidence to a real committed file resolves these so a
    // rule can reject a cited screenshot that isn't actually in the tree at that commit.
    evidenceBlobs?: Record<string, boolean>;
    // files a cited commit changed, keyed by commit sha. A preset can require a cited commit to
    // TOUCH the paths an AC declares — a deterministic partial close of the relevance gap.
    commitFiles?: Record<string, string[]>;
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
  // relevance-anchor policy: 'required' makes a preset enforce that a passed AC declares its
  // optional relevance anchor (the default preset's `paths`) so EVERY passed AC's commit is
  // relevance-checked, not just opted-in ones. Absent/'optional' = anchors stay opt-in. The
  // anchor itself (and the unrelated-commit check) is preset-specific; this is just the dial.
  relevance?: 'optional' | 'required';
  // waivers parsed by the CORE from each issue's `## Waivers` section (see WaiverDirective) —
  // a post-filter applied to findings; preset-agnostic, never on the issue itself.
  waivers?: WaiverDirective[];
}

// The Context schema — the contract requires context to be typed AND validated as
// part of the single ValidationInput. Strict: a fact a rule reads must be declared
// here (a preset adds its own observed facts by passing an extended contextSchema).
const GitContextSchema = z.object({
  currentSha: z.string().optional(),
  existingCommits: z.array(z.string()).optional(),
  prs: z.record(z.string(), z.object({ headSha: z.string().optional(), merged: z.boolean().optional() }).strict()).optional(),
  branches: z.record(z.string(), z.string()).optional(),
  evidenceBlobs: z.record(z.string(), z.boolean()).optional(),
  commitFiles: z.record(z.string(), z.array(z.string())).optional(),
}).strict();
const WorldEventSchema = z.object({
  id: z.string(), service: z.string(), type: z.string().optional(), text: z.string().optional(), annotationRequired: z.boolean().optional(),
}).strict();
const WorldAnnotationSchema = z.object({
  id: z.string(), service: z.string().optional(), eventId: z.string(),
  classification: z.enum(['source', 'noise', 'duplicate']), quote: z.string().optional(),
}).strict();
// Waivers are core-parsed from each issue's `## Waivers` section into the context (universal,
// preset-agnostic) and applied as a post-filter — see WaiverDirective.
const WaiverDirectiveSchema = z.object({
  issueId: z.string(), code: z.string(), reason: z.string(), approvedBy: z.string(), acId: z.string().optional(), ref: z.string().optional(),
}).strict();
export const CoreContextSchema = z.object({
  now: z.string().optional(),
  phase: z.enum(['all', 'gate']).optional(),
  git: GitContextSchema.optional(),
  world: z.object({ events: z.array(WorldEventSchema).optional(), annotations: z.array(WorldAnnotationSchema).optional() }).strict().optional(),
  categories: z.record(z.string(), z.number()).optional(),
  relevance: z.enum(['optional', 'required']).optional(),
  waivers: z.array(WaiverDirectiveSchema).optional(),
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
  // The issue lifecycle state(s) this rule gates, matched (case-insensitive) against the
  // owning issue's `status`. Absent = an always-on invariant that runs in EVERY state —
  // the "well-formed" rules. A state-tagged rule runs ONLY against items whose issue is
  // currently in one of these states. The gating mechanism is universal (here); the rule
  // content and which state it gates are the preset's. Moving an issue between states
  // stays MANUAL — a preset may layer a real state machine (auto-promotion, legal-
  // transition enforcement) on top, but core never moves an issue on its own.
  state?: string | string[];
  category?: RuleCategory;
  depth?: RuleDepth;
  waivable?: boolean;  // false ⇒ a waiver can't downgrade this finding (structural invariants)
  select: (m: DerivedModel<R>) => Item[];
  when?: (item: Item, m: DerivedModel<R>) => boolean;
  message: (item: Item, m: DerivedModel<R>) => string;
  // Optional: the specific offending token for THIS occurrence (e.g. the missing sha), copied
  // onto Finding.subject so a `ref:` waiver can pin to exactly this occurrence (see Finding.subject).
  subject?: (item: Item, m: DerivedModel<R>) => string;
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

// VIZ-1: the dashboard's vocabulary, as DATA. `visualizer/client/presets/default.tsx:5-40` (the
// richest shipped view extension) is entirely field references and literal labels — statusOrder,
// an AC-unit label, an optional status→css-class map, and which issue/AC fields hold the
// assignee, the PR link, the AC's own id/text/version, its proof, and its evidence entries. This
// block is that vocabulary expressed as plain, JSON-serializable data so it can live in the
// user's own `preset.mts` (mechanically checkable against the schema's status enum, VIZ-7)
// instead of a second, drift-prone code file. HARD BOUNDARY: every leaf below is a string, a
// string array, or a flat record of strings — there is no `z.function()`/`z.any()` anywhere in
// `VisualizerSpecSchema`, so a function- or markup-valued member fails validation structurally,
// not by convention. Irreducible RENDER logic (e.g. speckit's issue panels) is layer 2's job —
// the `VisualizerExtension` code seam (VIZ-13/VIZ-14) — which this contract deliberately cannot
// express (no statusOrder/acUnitLabel/field-mapping members there, by construction).
const VisualizerAcTextSchema = z.object({
  id: z.string(),      // AC field holding its id, e.g. "id"
  text: z.string(),    // AC field holding its prose text, e.g. "text"
  version: z.string(), // AC field holding its version number, e.g. "version"
}).strict();

const VisualizerPrSchema = z.object({
  field: z.string(),    // issue field holding the PR object, e.g. "pr"
  urlField: z.string(), // field on THAT object holding the URL, e.g. "url" -> issue.pr.url
}).strict();

const VisualizerAcProofSchema = z.object({
  field: z.string(),       // AC field holding the proof object, e.g. "proof"
  explanation: z.string(), // field on the proof object holding the explanation string
  evidenceRefs: z.string(), // field on the proof object holding the string[] of evidence refs
}).strict();

const VisualizerAcEvidenceSchema = z.object({
  field: z.string(),     // AC field holding the evidence array, e.g. "evidence"
  image: z.string(),     // field on each evidence entry holding the image path
  commit: z.string(),    // field on each evidence entry holding the commit sha
  acVersion: z.string(), // field on each evidence entry holding the AC version it backs
}).strict();

/** The zod validator for `Preset.visualizer` — see the block comment above for the design intent
 *  and the hard boundary it enforces. Re-exported from `ztrack/preset-kit` (presetKit.ts) so an
 *  installed `preset.mts` imports only the kit, never this module directly. */
export const VisualizerSpecSchema = z.object({
  statusOrder: z.array(z.string()),           // column / group / view order (VIZ-7: must equal the issue-status enum)
  acUnitLabel: z.string(),                    // what an AC is called, e.g. "Dev ACs", "User Stories"
  statusClass: z.record(z.string(), z.string()).optional(), // status -> css class; omitted = identity
  assignee: z.string().optional(),            // issue field holding the assignee string, e.g. "assignee"
  pr: VisualizerPrSchema.optional(),          // issue field(s) holding the PR link
  acText: VisualizerAcTextSchema,             // AC fields for the label (id + text + version)
  acProof: VisualizerAcProofSchema.optional(),       // AC's proof sub-object field names
  acEvidence: VisualizerAcEvidenceSchema.optional(), // AC's evidence-array field names
}).strict();

/** Inferred from `VisualizerSpecSchema` — the ONE authored copy of the shape (no hand-written
 *  interface to drift from the schema, matching this repo's schema-is-the-type convention,
 *  configSchema.ts). Re-exported from `ztrack/preset-kit`. */
export type VisualizerSpec = z.infer<typeof VisualizerSpecSchema>;

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
  // Parse the structured issue records into the candidate root: read each issue's metadata
  // (id/title/status/assignee/labels/children) straight from its record fields, and content
  // (summary, ACs, evidence, proof, …) from `record.body` via mdast. Takes ALL records so a
  // preset can do cross-issue work (e.g. classify bare blocking refs once the whole tracker is
  // known). Core supplies the metadata structured — the parser never re-derives it from
  // synthesized markdown.
  parse: (records: IssueRecord[]) => unknown; // -> the root candidate (validated by `schema`)
  // The declared INVERSE of `parse`: render ONE validated issue back to its STORED form — the
  // content `body` markdown plus the metadata `columns` to persist. The grammar is one
  // definition running both directions (`fmt` = serialize∘parse; a mutation = serialize∘edit∘
  // parse) with no second write-grammar, and metadata round-trips through the columns, never
  // the body. Present iff the preset OWNS its issues (read-WRITE); a preset that merely ADAPTS
  // an external source-of-truth (e.g. speckit over Spec-Kit's own files) is read-ONLY and
  // omits it, so `fmt` and the structured-mutation tools are unavailable for it by design.
  serialize?: (issue: R['issues'][number]) => { body: string; columns: IssueColumns };
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
  // optional REMEDIATION hint per finding: given a finding this preset's rules produced
  // (code + located issueId/acId), return the one-line action that resolves it (the exact
  // `ztrack ac patch …` to run). The engine attaches it as `finding.fix`. Preset-owned
  // because the fix is the preset's own mutation grammar.
  fixHint?: (finding: Finding) => string | undefined;
  // The dashboard's vocabulary, as pure data (VIZ-1): status order, AC unit label, and field
  // mappings the visualizer client renders from — see `VisualizerSpecSchema` above. Optional:
  // an absent block means the dashboard falls back to an observed status grouping (VIZ-4).
  // Validated separately (not by this interface) at board-build time, VIZ-3 — a malformed block
  // must not reach the renderer unchecked.
  visualizer?: VisualizerSpec;
}

export interface CheckResult<R extends CoreRoot> {
  ok: boolean;
  findings: Finding[];
  export?: R; // the parsed Root — what every other surface reads
  // How many issue records were actually examined, set ONLY when validation failed before
  // `export` could be populated (a shape-invalid root, or a whole-input parse failure) — so a
  // summary line can report an honest count instead of falling back to 0 while findings cite
  // `root.issues.<n>` for an issue the count implies never existed (ZL-E9c). Success paths leave
  // this undefined; readers should prefer `export.issues.length` and fall back to this.
  examinedIssues?: number;
}

// Best-effort count of a pre-validation candidate root's issues, for `examinedIssues` on a
// shape-failure CheckResult — the root failed strict validation, but "how many issues did we
// even attempt" is still knowable from its raw (untyped) shape.
function countCandidateIssues(root: unknown): number | undefined {
  const arr = root && typeof root === 'object' ? (root as { issues?: unknown }).issues : undefined;
  return Array.isArray(arr) ? arr.length : undefined;
}

// Copy a record's `Origin` (path + optional line span) onto a `Finding`'s narrower
// `{ path, line? }` — the finding cites a start line, not a span.
function toFindingOrigin(origin: Origin): FindingOrigin {
  return { path: origin.path, ...(origin.lineStart !== undefined ? { line: origin.lineStart } : {}) };
}

// `root` is the raw (pre-validation) candidate `{ issues: [...] }` — used only to recover which
// issue a shape error's zod path (`root.issues.<n>.…`) belongs to, so the finding can carry that
// issue's origin even though the input failed strict validation.
function shapeFindings(error: z.ZodError, root: unknown, originById: Map<string, Origin>): Finding[] {
  const issuesArr = root && typeof root === 'object' ? (root as { issues?: unknown }).issues : undefined;
  return error.issues.map((issue) => {
    const idx = issue.path[0] === 'root' && issue.path[1] === 'issues' && typeof issue.path[2] === 'number' ? issue.path[2] : undefined;
    const issueId = idx !== undefined && Array.isArray(issuesArr) ? (issuesArr[idx] as { id?: unknown } | undefined)?.id : undefined;
    const origin = typeof issueId === 'string' ? originById.get(issueId) : undefined;
    return {
      code: 'wellformed_shape',
      severity: 'error' as const,
      message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ...(origin ? { origin: toFindingOrigin(origin) } : {}),
    };
  });
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
// `originById` (record id -> Origin) copies the record's on-disk location onto every finding
// for that issue — the engine attaches it, no rule authors it.
function evalRecord<R extends CoreRoot>(r: RuleRecord<R, Located>, model: DerivedModel<R>, statusById: Map<string, string>, originById: Map<string, Origin>): Finding[] {
  // A state-tagged rule applies only to items whose owning issue is currently in one of
  // those states (looked up by issueId — every model fact carries one). Absent tag =
  // always-on invariant: no filter. Universal gating; the state vocabulary is the preset's.
  const gateStates = r.state === undefined ? null
    : (Array.isArray(r.state) ? r.state : [r.state]).map((s) => s.toLowerCase());
  return r.select(model)
    .filter((item) => gateStates === null
      || (item.issueId !== undefined && gateStates.includes((statusById.get(item.issueId) ?? '').toLowerCase())))
    .filter((item) => (r.when ? r.when(item, model) : true))
    .map((item): Finding => {
      const origin = item.issueId ? originById.get(item.issueId) : undefined;
      return {
        code: r.code,
        severity: r.severity ?? 'error',
        message: r.message(item, model),
        ...(item.issueId ? { issueId: item.issueId } : {}),
        ...(item.acId ? { acId: item.acId } : {}),
        ...(item.evidenceId ? { evidenceId: item.evidenceId } : {}),
        ...(r.subject ? { subject: r.subject(item, model) } : {}),
        ...(r.waivable === false ? { waivable: false } : {}),
        ...(origin ? { origin: toFindingOrigin(origin) } : {}),
      };
    });
}

// Order-independent structural fingerprint, so a waiver's anchor is stable across
// re-parses but changes the instant any AC field (text, status, checkbox, blockers,
// evidence) changes — the "AC-version" half of a waiver's freshness.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// Parse ONE `## Waivers` row into its fields, or null if the line carries no `code:`. Grammar:
// `- code: <finding-code> [ac: <acId>] [ref: <subject>] reason: <text> by: <signer>`. The SINGLE
// source of truth for waiver-row syntax — engine `parseWaivers` and the `waiver` CLI both call it,
// so `status`/`migrate` split reason/signer identically to `check` (no first-`by:` truncation).
export function parseWaiverLine(line: string): { code: string; acId?: string; ref?: string; reason: string; approvedBy: string } | null {
  const code = /\bcode:\s*([A-Za-z0-9_]+)/i.exec(line)?.[1];
  if (!code) return null;
  // `by:` is the trailing field; split on its LAST occurrence so a reason that itself
  // contains "by:" is not truncated (and the signer is not mis-attributed).
  const rm = /\breason:\s*/i.exec(line);
  const reasonStart = rm ? rm.index + rm[0].length : -1;
  // `ac:`/`ref:` are the leading pins — parse them only from the head BEFORE `reason:`, so a
  // reason mentioning "ref:"/"ac:" in prose can't be misread as a pin.
  const head = rm ? line.slice(0, rm.index) : line;
  const acId = /\bac:\s*(\S+)/i.exec(head)?.[1];
  const ref = /\bref:\s*(\S+)/i.exec(head)?.[1];
  const byIdx = line.toLowerCase().lastIndexOf(' by:');
  const reasonEnd = byIdx > reasonStart ? byIdx : line.length;
  const reason = reasonStart >= 0 ? line.slice(reasonStart, reasonEnd).trim() : '';
  const approvedBy = byIdx > reasonStart ? line.slice(byIdx + ' by:'.length).trim() : '';
  return { code, reason, approvedBy, ...(acId ? { acId } : {}), ...(ref ? { ref } : {}) };
}

// Parse waivers UNIVERSALLY (core, never per-preset) from each issue's `## Waivers` section.
// The issue id comes from the body's `# <id>: <title>` head (robust for single-issue and bundle).
export function parseWaivers(records: IssueRecord[]): WaiverDirective[] {
  const out: WaiverDirective[] = [];
  for (const { id: issueId, body } of records) {
    const section = /(?:^|\n)##\s+waivers\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(body);
    if (!section) continue;
    for (const line of section[1]!.split('\n')) {
      const parsed = parseWaiverLine(line);
      if (parsed) out.push({ issueId, ...parsed });
    }
  }
  return out;
}

// Post-process (eslint `disable`-style): each waiver downgrades the matching `error`
// finding(s) to `acknowledged`. A waiver missing a reason or sign-off is itself an error and
// downgrades nothing; a waiver that matches NO finding is reported `waiver_unused` (warning)
// — the self-cleaning staleness signal. A ref-pinned waiver (`ref:`) matches ONLY the finding
// whose `subject`/`evidenceId` equals it — the `// eslint-disable-next-line` form. `waiver_overbroad`
// (warning) fires when a single directive silences MORE than the one occurrence it should: either an
// UNPINNED waiver hit a subject-bearing finding (the coarse block form — nudged toward a `ref:` pin,
// and it would also mask FUTURE occurrences), OR a `ref:` value matched >1 finding because the same
// subject recurs across ACs (nudged toward `ac:` scoping). The downgrade still happens (back-compat);
// only the warning distinguishes them. Structural invariants (waivable === false) never downgrade.
// Universal core machinery.
function applyWaivers(findings: Finding[], waivers: WaiverDirective[]): Finding[] {
  if (!waivers.length) return findings;
  const extra: Finding[] = [];
  const loc = (w: WaiverDirective) => `${w.issueId}${w.acId ? ` (${w.acId})` : ''}${w.ref ? ` [ref ${w.ref}]` : ''} for '${w.code}'`;
  const valid = waivers.filter((w) => {
    const ok = !!w.reason?.trim() && !!w.approvedBy?.trim();
    if (!w.reason?.trim()) extra.push({ code: 'waiver_missing_reason', severity: 'error', issueId: w.issueId, ...(w.acId ? { acId: w.acId } : {}), message: `Waiver on ${loc(w)} has no reason. A waiver must state why the failing state is acceptable.` });
    if (!w.approvedBy?.trim()) extra.push({ code: 'waiver_missing_signoff', severity: 'error', issueId: w.issueId, ...(w.acId ? { acId: w.acId } : {}), message: `Waiver on ${loc(w)} has no sign-off (\`by:\`). A waiver must name the authority who accepted it.` });
    return ok;
  });
  // Prefer the most specific waiver for a finding: a ref-pinned waiver wins over a broad one,
  // so the broad one shows as unused/overbroad (nudging its removal) rather than absorbing the hit.
  const ordered = [...valid].sort((a, b) => (a.ref ? 0 : 1) - (b.ref ? 0 : 1));
  const matches = (v: WaiverDirective, f: Finding): boolean =>
    v.issueId === f.issueId && v.code === f.code
    && (v.acId === undefined || v.acId === f.acId)
    && (v.ref === undefined || v.ref === f.subject || v.ref === f.evidenceId);
  // Downgrade each error finding a valid, non-structural waiver matches; track which fired, and —
  // for every fired waiver — the distinct subject-bearing occurrences it silenced (as `subject (ac)`
  // display strings, deduped by the Set). This drives overbroad detection for BOTH the unpinned and
  // the ref-matched-many cases; a subjectless finding contributes nothing (never overbroad).
  const fired = new Set<WaiverDirective>();
  const silenced = new Map<WaiverDirective, Set<string>>();
  const adjusted = findings.map((f): Finding => {
    if (f.severity !== 'error' || f.waivable === false || !f.issueId) return f;
    const w = ordered.find((v) => matches(v, f));
    if (!w) return f;
    fired.add(w);
    // A `ref:` pins by subject OR evidenceId (see `matches`), so EITHER identifies a silenceable
    // occurrence — track whichever this finding carries (subject preferred). Keying on subject alone
    // would leave the same masking hole open for a subjectless rule that selects evidence (e.g.
    // evidence_file_not_found), whose findings are ref-pinnable by evidenceId but would go uncounted.
    const occ = f.subject ?? f.evidenceId;
    if (occ !== undefined) {
      const s = silenced.get(w) ?? new Set<string>();
      s.add(`${occ}${f.acId ? ` (${f.acId})` : ''}`); silenced.set(w, s);
    }
    return { ...f, severity: 'acknowledged', message: `${f.message} (acknowledged by ${w.approvedBy.trim()})` };
  });
  // A valid waiver that suppressed nothing is stale — surface it (eslint's unused-directive).
  // Overbroad = one directive silenced more than the single occurrence it should: an UNPINNED
  // waiver that hit a subject-bearing finding (→ pin with `ref:`; it would also mask future ones),
  // or a `ref:` that matched >1 occurrence because the subject recurs across ACs (→ scope with `ac:`).
  for (const w of valid) {
    if (!fired.has(w)) { extra.push({ code: 'waiver_unused', severity: 'warning', issueId: w.issueId, ...(w.acId ? { acId: w.acId } : {}), message: `Waiver on ${loc(w)} matched no finding — remove it (or fix the code/ac). A waiver that suppresses nothing is stale.` }); continue; }
    const subs = silenced.get(w);
    if (!subs || !subs.size) continue;                                  // fired only on subjectless findings — fine
    const list = [...subs].sort();
    const unpinnedHit = w.ref === undefined;                            // coarse block form — pin it
    const refMatchedMany = w.ref !== undefined && list.length > 1;      // ref not specific to one occurrence — scope it
    if (!unpinnedHit && !refMatchedMany) continue;                      // ref-pinned to exactly one occurrence — the good case
    const many = list.length > 1;
    const nudge = unpinnedHit
      ? `Pin it with \`ref: <one of the above>\` (one waiver per occurrence) so it can only ever suppress that one finding — an unpinned waiver also masks future/other '${w.code}' findings here.`
      : `The \`ref: ${w.ref}\` matches ${list.length} findings on different ACs — add \`ac: <acId>\` so it pins only one, or split it into one waiver per AC.`;
    extra.push({ code: 'waiver_overbroad', severity: 'warning', issueId: w.issueId, ...(w.acId ? { acId: w.acId } : {}), message: `Waiver on ${loc(w)} silenced ${many ? `${list.length} findings` : 'a finding'} (${list.join(', ')}). ${nudge}` });
  }
  return [...adjusted, ...extra];
}

// Universal remediation FLOOR — when the preset gives no specific hint for a finding (an
// uncovered code, or a preset with no `fixHint` at all), still tell the agent the next step:
// inspect the issue and fix the flagged content, or (when waivable) accept it with a waiver.
// Located, and valid for ANY preset since `issue view` + waivers are core.
function genericFixHint(f: Finding): string {
  if (!f.issueId) return 'Fix: review the check output and resolve the flagged content in the tracker.';
  const target = f.acId ? `AC ${f.acId}` : 'the flagged content';
  const inspect = `\`ztrack issue view ${f.issueId}\`, then fix ${target}`;
  if (f.waivable === false) return `Fix ${f.issueId}: ${inspect} — structural; it cannot be waived.`;
  return `Fix ${f.issueId}: ${inspect} — or, if you knowingly accept it: \`ztrack waiver sign ${f.issueId} --code ${f.code}${f.acId ? ` --ac ${f.acId}` : ''} --reason "…"\`.`;
}

function runRules<R extends CoreRoot>(preset: Preset<R>, input: ValidationInput<R>, originById: Map<string, Origin>): CheckResult<R> {
  const ctx = input.context;
  const model = deriveCoreModel(input.root, ctx, preset.isIssueDone);
  if (preset.derive) {
    try { Object.assign(model.derived, preset.derive(model)); }
    catch (error) { return { ok: false, findings: [{ code: 'derive_threw', severity: 'error', message: `Preset derive threw: ${String((error as Error)?.message ?? error)}` }], export: input.root }; }
  }
  const active = preset.rules
    .filter((r) => (ctx.phase === 'gate' ? r.phase !== 'transition' : true))
    .filter((r) => ruleEnabled(r, ctx.categories));
  // The owning issue's current lifecycle state, by id — what per-state rule gating reads.
  const statusById = new Map<string, string>(input.root.issues.map((i) => [i.id, String(i.status ?? '')]));
  // A rule is contracted pure, but Rule is a public extension point: a buggy rule's
  // select/when/message must surface as a finding, not crash the whole check.
  const findings = active.flatMap((r) => {
    try {
      return evalRecord(r, model, statusById, originById);
    } catch (error) {
      return [{ code: 'rule_threw', severity: 'error', waivable: false, message: `Rule '${r.code}' threw: ${String((error as Error)?.message ?? error)}` } as Finding];
    }
  });
  const waived = applyWaivers(findings, ctx.waivers ?? []);
  // Attach the preset's remediation hint so every finding is self-documenting (the agent is told
  // the exact fix). Errored/acknowledged alike — a fix helps either way.
  // Preset-specific hint wins; the universal floor fills any gap, so EVERY finding is self-documenting.
  const withFix = waived.map((f) => (f.fix ? f : { ...f, fix: preset.fixHint?.(f) ?? genericFixHint(f) }));
  return { ok: !withFix.some((f) => f.severity === 'error'), findings: withFix, export: input.root };
}

// Split a parse candidate's optional `diagnostics` key off into findings, and strip the key
// so ValidationInputSchema never sees it. Absent/non-array `diagnostics` -> no findings, root
// unchanged (a preset that never opts in is untouched). Exported for the other consumer of a
// raw parse candidate (modelEdit's parseOneIssue): the strict preset schemas reject unknown
// keys, so anything that schema-validates `preset.parse(...)` output must strip this key first.
export function liftDiagnostics(candidate: unknown, originById?: Map<string, Origin>): { root: unknown; findings: Finding[] } {
  if (!candidate || typeof candidate !== 'object' || !('diagnostics' in candidate)) return { root: candidate, findings: [] };
  const { diagnostics, ...rest } = candidate as { diagnostics?: unknown } & Record<string, unknown>;
  if (!Array.isArray(diagnostics)) return { root: rest, findings: [] };
  const findings: Finding[] = (diagnostics as ParseDiagnostic[]).map((d) => {
    const origin = d.issueId ? originById?.get(d.issueId) : undefined;
    return {
      code: d.code, severity: d.severity ?? 'warning', message: d.message,
      ...(d.issueId ? { issueId: d.issueId } : {}),
      ...(origin ? { origin: toFindingOrigin(origin) } : {}),
    };
  });
  return { root: rest, findings };
}

// ZTB-3: two records sharing an id but backed by DIFFERENT files — a declared `sources` union
// surfaces every source's rows undeduped (see MarkdownBackend.loadAll) — is a data-integrity
// error the engine reports directly, not silent precedence (precedence stays reserved for the
// worktree board index *inside* one source; see MarkdownBackend.resolveBody). Structural
// intra-source duplication (no origin at all, or the same origin twice) is untouched by this: it
// still flows through to `preset.parse` and the preset's own `duplicate_issue_id` rule via
// `root.issues`, exactly as before — this only fires when the origins genuinely differ.
function crossSourceConflicts(records: IssueRecord[]): Finding[] {
  const originsById = new Map<string, Origin[]>();
  for (const r of records) {
    if (!r.origin) continue;
    const list = originsById.get(r.id);
    if (list) list.push(r.origin); else originsById.set(r.id, [r.origin]);
  }
  const findings: Finding[] = [];
  for (const [issueId, origins] of originsById) {
    const paths = [...new Set(origins.map((o) => o.path))];
    if (paths.length < 2) continue;
    findings.push({
      code: 'issue_id_conflict', severity: 'error', waivable: false, issueId,
      message: `Issue id '${issueId}' is defined in more than one configured source: ${paths.join(', ')}. `
        + 'ztrack does not silently pick a winner across sources — rename one of them or remove the duplicate.',
      origin: toFindingOrigin(origins[0]!),
    });
  }
  return findings;
}

/** The one entry point: parse -> ValidationInputSchema.parse({context, root}) ->
 *  pure rules. The validated Root is the export; nothing downstream re-parses or
 *  re-derives. */
export function check<R extends CoreRoot>(preset: Preset<R>, records: IssueRecord[], ctx: Context = {}): CheckResult<R> {
  // Record id -> Origin, so downstream findings can cite where their issue's content lives.
  const originById = new Map<string, Origin>();
  for (const r of records) if (r.origin) originById.set(r.id, r.origin);
  const conflicts = crossSourceConflicts(records);
  let candidate: unknown;
  try {
    candidate = preset.parse(records);
  } catch (error) {
    // A whole-input parse failure has no per-issue location yet; a single-record check (the
    // loose-file `ztrack check ./FILE.md` path) has exactly one candidate, so cite it.
    const origin = records.length === 1 ? records[0]!.origin : undefined;
    const findings: Finding[] = [...conflicts, { code: 'parse_failed', severity: 'error', message: String((error as Error)?.message ?? error), ...(origin ? { origin: toFindingOrigin(origin) } : {}) }];
    return { ok: false, findings, examinedIssues: records.length };
  }
  const { root, findings: diagnosticFindings } = liftDiagnostics(candidate, originById);
  // Waivers are core-parsed from each record's `## Waivers` body section (universal,
  // preset-agnostic) and merged into the context — `applyWaivers` then downgrades the
  // findings they name. The issue id comes from the record, not a synthesized heading.
  const parsed = parseWaivers(records);
  const merged: Context = parsed.length ? { ...ctx, waivers: [...(ctx.waivers ?? []), ...parsed] } : ctx;
  const result = validateAndRun(preset, merged, root, false, originById);
  const extra = [...conflicts, ...diagnosticFindings];
  if (!extra.length) return result;
  return { ...result, ok: result.ok && !extra.some((f) => f.severity === 'error'), findings: [...extra, ...result.findings] };
}

/** Validate an already-parsed Root (the exported, validated model) against the same
 *  schema + rules — the entry point for `check --input <root.json>` and CI. */
export function checkRoot<R extends CoreRoot>(preset: Preset<R>, root: unknown, ctx: Context = {}): CheckResult<R> {
  // Tolerate the exported `{ issues, waivers }` shape (see exportTrackerRoot): lift the
  // waivers into the context — where applyWaivers honors them — and validate only `issues`
  // against the strict per-preset root schema.
  if (root && typeof root === 'object' && Array.isArray((root as { waivers?: unknown }).waivers)) {
    const { waivers, ...rest } = root as { waivers: WaiverDirective[] } & Record<string, unknown>;
    const merged: Context = { ...ctx, waivers: [...(ctx.waivers ?? []), ...waivers] };
    return validateAndRun(preset, merged, rest, true);
  }
  return validateAndRun(preset, ctx, root, true);
}

// Compose the strict ValidationInputSchema, validate {context, root}, run rules.
// safeParse is wrapped: composing/validating across a mismatched zod instance (a
// repo-local preset built against a different zod major) must surface as a finding,
// not a raw crash of `ztrack check`.
function validateAndRun<R extends CoreRoot>(preset: Preset<R>, ctx: Context, root: unknown, isExportedRoot: boolean, originById: Map<string, Origin> = new Map()): CheckResult<R> {
  let result: ReturnType<z.ZodType<ValidationInput<R>>['safeParse']>;
  try {
    const inputSchema = makeValidationInputSchema(preset.schema, preset.contextSchema);
    result = inputSchema.safeParse({ context: ctx, root });
  } catch (error) {
    return { ok: false, findings: [{ code: 'schema_error', severity: 'error', message: `Could not validate against the preset schema (a preset/zod version mismatch?): ${String((error as Error)?.message ?? error)}` }], examinedIssues: countCandidateIssues(root) };
  }
  if (!result.success) {
    const examinedIssues = countCandidateIssues(root);
    return isExportedRoot
      ? { ok: false, findings: [{ code: 'root_shape_invalid', severity: 'error', message: 'Input does not match the preset root schema. If this is an old exported snapshot, re-run `ztrack export`.' }, ...shapeFindings(result.error, root, originById)], examinedIssues }
      : { ok: false, findings: shapeFindings(result.error, root, originById), examinedIssues };
  }
  return runRules(preset, result.data, originById);
}
