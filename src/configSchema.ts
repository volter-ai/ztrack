// ZTB-3: runtime shape validation for tracker-config.json. Before this, `loadTrackerConfig`
// JSON-parsed and spread the raw object untyped — a typo'd key (`source:` for `sources:`, or any
// nested misspelling) was silently preserved and ignored, never read by anything. This schema
// makes that fail closed: EVERY key at EVERY level (top-level and nested) is checked against the
// full `TrackerConfig` inventory, and an unrecognized key names itself plus its nearest valid
// sibling so the fix is obvious, not a guessing game.
//
// ZTB-26: this schema is now the ONLY authored copy of the config shape. `RawTrackerConfig` and
// `TrackerConfig` (below) are derived FROM it via `z.infer` — types.ts used to hand-author a
// parallel `TrackerConfig` interface (and KNOWN_KEYS below used to be a hand-maintained mirror
// table), and the two silently drifted (ZTB-22: `organization.lint.rules` was documented and read
// by lint.ts but absent from this schema for a full release). Field-level documentation that used
// to live on the interface now lives here, next to the schema field it describes.
import { z } from 'zod';
import type { TrackerBackendName } from './types.ts';
import { RULE_CATEGORIES } from './checkRules.ts';

/** One declared markdown source (ZTB-3). `path` is project-root-relative: a DIRECTORY of
 *  one-issue-per-file markdown (`issue-per-file`), or a single markdown FILE decomposed into many
 *  issues by its id-bearing headings (`document` — ZTB-4; see src/documentParser.ts). `format`
 *  defaults from the shape of `path` when omitted: a `.md` file → `document`, anything else →
 *  `issue-per-file`. `readonly: true` marks a source ztrack may read but never write — writes
 *  routed at it (by the target record's `origin.path`) are rejected. A `document` source, even
 *  when not `readonly: true`, only ever accepts a narrow `body`/title splice into an issue's
 *  recorded span (ZTB-4 dev/09 — see backends/documentSource.ts); every wider write (status,
 *  assignee, labels, reparent, comment, delete, create) still fails closed, naming the file. */
const TrackerSourceConfigSchema = z.object({
  path: z.string(),
  format: z.enum(['issue-per-file', 'document']).optional(),
  readonly: z.boolean().optional(),
}).strict();

const LocalSchema = z.object({
  teamKey: z.string().optional(),
  database: z.string().optional(),
  store: z.string().optional(),
}).strict();

const SyncSchema = z.object({
  provider: z.literal('github'),
  repo: z.string(),
  /** Three-way reconcile policy for the bidirectional sync. Default `merge` (field-level:
   *  non-overlapping concurrent edits merge, a same-field collision is surfaced). `hub-wins`
   *  = GitHub authoritative on collision; `twin-wins` = the local tracker authoritative. */
  policy: z.enum(['hub-wins', 'twin-wins', 'merge']).optional(),
}).strict();

const EvidenceSchema = z.object({
  /**
   * Where evidence files (screenshots/artifacts) are stored. Verification is always
   * commit/locator-anchored regardless.
   *  - `commit` (default): the file is committed in `dir` and verified to exist at the cited
   *    commit (`git cat-file -e <sha>:<path>`). Works in both local and linked trackers.
   *  - `attach`: the file is uploaded to the linked provider (a release asset) and verified by its locator URL + digest (`evidence verify`).
   *  - `external`: an object store you configure.
   *  - `auto` (default): resolves to `commit` (the offline, commit-verified, code-adjacent model).
   *    `attach` is opt-in here or per-call via `evidence add --attach`.
   */
  store: z.enum(['auto', 'commit', 'attach', 'external']).optional(),
  /** Directory for evidence files, relative to project root. Default `.volter/evidence`. */
  dir: z.string().optional(),
}).strict();

const ValidationSchema = z.object({
  /** Path relative to project root, for example ".volter/tracker/validation/preset.mts". */
  entrypoint: z.string().optional(),
  /** Starter/template used to install the entrypoint, e.g. "basic" or "speckit". */
  installedFrom: z.string().optional(),
}).strict();

// `Partial<Record<'sourced'|'code'|'visual'|'behavioral'|'wellformed', number>>` — reuses
// checkRules.ts's `RULE_CATEGORIES` (the single authored list of category names; see the
// "type is derived FROM this array" comment there) rather than re-typing the five names a third
// time. ZTB-26: this used to be a plain `z.record(z.string(), z.number())` with a comment
// claiming zod's enum-keyed record "requires every enum member present" — true for the zod v3
// `z.record(enum, value)` shape, but the installed zod v4.4.2 ships `z.partialRecord`, which keeps
// the enum-narrowed key type WITHOUT requiring every member. This is a deliberate behavior
// change: an unknown category name (e.g. a typo) now fails config validation instead of being
// silently accepted and never read — see configSchema.test.ts for both directions pinned.
// core/engine.ts's `CoreContextSchema.categories` makes the SAME loose choice this comment used
// to justify by pointing at; that schema is out of scope for ZTB-26 and is left untouched — its
// looseness is now merely no-longer-justified-by-this-comment, not fixed.
const CategoriesSchema = z.partialRecord(z.enum(RULE_CATEGORIES), z.number());

const CheckVerifyRuleSchema = z.object({
  matchTypes: z.array(z.string()).optional(),
  matchLabels: z.array(z.string()).optional(),
  inspect: z.boolean().optional(),
  categories: CategoriesSchema.optional(),
}).strict();

const CheckSchema = z.object({
  /** Per-category depth: { sourced, code, visual, behavioral } 0-3 (0 = off). */
  categories: CategoriesSchema.optional(),
  /** Process profiles a preset's rulebook can gate on (open set; preset-defined). */
  profiles: z.array(z.string()).optional(),
  /**
   * Per-type verification policy, evaluated in order, last match wins
   * (Renovate packageRules / ESLint overrides shape). Each rule selects
   * issues by `matchTypes` (type:* label suffixes, e.g. "bug") and/or
   * `matchLabels` (verbatim labels), AND-ed within a rule. A matched rule
   * may set `inspect: false` to silence the "checked dev work is not being
   * verified" warning for those issues, and/or `level` to override the
   * strictness applied to them. Issues with checked dev ACs that are not
   * inspected as cases and are not silenced raise dev_work_not_verified.
   */
  verify: z.array(CheckVerifyRuleSchema).optional(),
}).strict();

const GrammarSchema = z.object({
  extends: z.string().optional(),
  slotAliases: z.record(z.string(), z.array(z.string())).optional(),
}).strict();

// Per-rule severity override for `ztrack check`'s findings (lint.ts:5-6 documents this knob,
// lint.ts:92 reads it). `rules` keys are arbitrary rule names/codes — not enumerable here, so
// KNOWN_KEYS below deliberately does not list them (see the 'organization.lint' entry).
const LintSchema = z.object({
  rules: z.record(z.string(), z.enum(['warn', 'error', 'off'])).optional(),
}).strict();

const OrganizationSchema = z.object({
  /**
   * @deprecated Legacy named selector. New repos must use validation.entrypoint
   * installed by `ztrack init --preset <starter>`, which resolves to a core
   * preset (a standalone `Preset`). Configs with only this field are rejected.
   */
  validationPreset: z.string().optional(),
  /** Per-system browse URL templates with an {id} placeholder, e.g. jira: "https://example.atlassian.net/browse/{id}". */
  externalBrowseUrls: z.record(z.string(), z.string()).optional(),
  /**
   * Which top-level issue types are inspected as cases. Absent = the built-in
   * default set (type:case/bug/feature/... plus source:* labels). A label here is
   * matched against issue labels
   * verbatim; this is how a project teaches the tracker its own type vocabulary.
   */
  caseTypeLabels: z.array(z.string()).optional(),
  /**
   * Compatibility pluggable grammar: map the
   * tracker's normalized slots to a team's own heading vocabulary. Each slot's
   * accepted titles default to its canonical title; aliases here are added.
   * e.g. { slotAliases: { acceptanceCriteria: ["Done When"] } } lets a
   * team write "## Done When" and have its ACs picked up.
   *
   * For deeper project-specific semantics, prefer a repo-local preset-owned
   * parser + Zod schema instead of growing this DSL.
   */
  grammar: GrammarSchema.optional(),
  /**
   * Rule-category selector for `ztrack check` (maps to Context.categories).
   * Absent = run every rule. New validation semantics belong in preset Zod
   * schemas + rules, not here.
   */
  check: CheckSchema.optional(),
  /** Per-rule severity override for `ztrack check` findings (lint.ts). Keys are rule codes. */
  lint: LintSchema.optional(),
}).strict();

// `backend` is intentionally loose (any string, not the `TrackerBackendName` enum): loadTrackerConfig
// coerces it (`=== 'local' ? 'local' : 'markdown'`) BEFORE this schema ever sees a config missing it
// or naming some other legacy value — that coercion is the existing, deliberately-permissive
// compatibility path (see config.ts), not something this schema should re-litigate.
export const TrackerConfigSchema = z.object({
  backend: z.string().optional(),
  local: LocalSchema.optional(),
  /**
   * Declared markdown sources the tracker unions by issue id. Absent (the common case) is
   * EXACTLY today's single implicit store: one issue-per-file source at `markdownStoreDir()`
   * (which itself honors `local.teamKey` for id minting and `VOLTER_STATE_DIR` for relocation —
   * those stay properties of that implicit default entry, not a parallel mechanism). The same id
   * appearing in two DIFFERENT declared sources is a config-data error (`issue_id_conflict`
   * finding on `ztrack check`), never silent precedence — precedence is reserved for the
   * worktree board index *within* one source (see `board`).
   */
  sources: z.array(TrackerSourceConfigSchema).optional(),
  /**
   * Board scope for a LOCAL (unlinked) tracker. `branch` (default): the committed per-worktree
   * `.volter` store IS the board — branch-scoped, issues merge with the code, but a coordinator
   * can't see other branches' state. `shared`: the committed store stays per-worktree (board still
   * in git), AND a central symlink index in `<git-common-dir>/ztrack/board` aggregates every
   * worktree's live issues, so a coordinator — and global id allocation — sees ONE board across all
   * worktrees without an external tracker. Ignored when `sync` is set (linked already has one store).
   */
  board: z.enum(['branch', 'shared']).optional(),
  /**
   * A permanently-linked external task tracker. Set by `ztrack init --sync github --repo o/n`.
   * When present, `ztrack sync` needs no `--repo`, and user-facing `check`/`loop start`
   * best-effort sync the tracker with it (the Stop-hook gate never does — it must not hammer
   * the API mid-loop). Only `github` today; the provider lives at `src/sync/<provider>/`.
   */
  sync: SyncSchema.optional(),
  evidence: EvidenceSchema.optional(),
  /**
   * Relevance-anchor enforcement. The default preset lets a passed AC declare an optional
   * `paths:` glob; when set, its cited commit must TOUCH one of those paths (else
   * `evidence_commit_unrelated`). This dial controls whether the anchor is mandatory:
   *  - `optional` (default): a passed AC may omit `paths`; relevance is checked only when declared.
   *  - `required`: a passed AC MUST declare `paths` (else `passed_ac_missing_paths`), so EVERY
   *    passed AC's commit is relevance-checked. Non-breaking: existing repos default to `optional`.
   */
  relevance: z.enum(['optional', 'required']).optional(),
  /**
   * Preferred validation architecture: ztrack loads one repo-local validation
   * entrypoint after init. The entrypoint owns parser/schema/render semantics.
   * Legacy configs that only set `organization.validationPreset` must be
   * migrated with `ztrack init --preset <starter>`.
   */
  validation: ValidationSchema.optional(),
  /** Project conventions consumed by installed validation and compatibility paths. */
  organization: OrganizationSchema.optional(),
}).strict();

/** The validated on-disk shape, exactly as `TrackerConfigSchema` accepts it — including the loose
 *  `backend?: string`. This is `TrackerConfigSchema.parse()`'s return type: the RAW, pre-coercion
 *  shape. `loadTrackerConfig` (config.ts) is the only place that turns this into the loaded
 *  `TrackerConfig` below by coercing `backend`. */
export type RawTrackerConfig = z.infer<typeof TrackerConfigSchema>;

/** One declared markdown source, derived from the same schema `sources[]` validates against. */
export type TrackerSourceConfig = z.infer<typeof TrackerSourceConfigSchema>;

/**
 * The LOADED config shape returned by `loadTrackerConfig` (config.ts) and consumed by every
 * feature reader. Identical to `RawTrackerConfig` in every field except `backend`: raw `backend`
 * is an optional loose string (see the comment above `TrackerConfigSchema`); `loadTrackerConfig`
 * coerces it to the closed `TrackerBackendName` union (`raw.backend === 'local' ? 'local' :
 * 'markdown'`) before returning, so every consumer past that point can rely on a required,
 * closed-enum `backend`. This is the ONE authored delta on top of the schema-derived shape —
 * everything else flows straight from `TrackerConfigSchema` with no second copy.
 */
export type TrackerConfig = Omit<RawTrackerConfig, 'backend'> & { backend: TrackerBackendName };

// The known keys at each object path, keyed by a template where array indices are collapsed to
// `[]` (e.g. `organization.check.verify.0` -> `organization.check.verify[]`). Used only to offer
// a "did you mean" suggestion for an unrecognized key — not itself a source of truth (the zod
// schema above is).
//
// ZTB-26 dev/02: this used to be a hand-maintained literal table — its own comment admitted it
// was "kept in the same file so the two can't drift silently", which is precisely the disease:
// nothing enforced that. It's now generated by walking TrackerConfigSchema at module load: unwrap
// `.optional()`, recurse into `ZodObject` via `.shape`, follow `ZodArray` into its `.element` under
// a `[]` path segment (matching `pathTemplate()` below), and STOP at `ZodRecord` (its keys are
// data, not a schema vocabulary — e.g. `organization.lint.rules`' keys are arbitrary rule names, so
// no entry is generated for that path) and at enums/primitives (nothing further to enumerate
// beneath them). The exact 11-entry result is pinned against a literal in configSchema.test.ts.
function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  return schema instanceof z.ZodOptional ? unwrapOptional(schema.unwrap() as z.ZodTypeAny) : schema;
}

function collectKnownKeys(schema: z.ZodTypeAny, path: string, out: Record<string, string[]>): void {
  const unwrapped = unwrapOptional(schema);
  if (unwrapped instanceof z.ZodObject) {
    const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
    out[path] = Object.keys(shape);
    for (const [key, field] of Object.entries(shape)) collectKnownKeys(field, path ? `${path}.${key}` : key, out);
    return;
  }
  if (unwrapped instanceof z.ZodArray) {
    collectKnownKeys(unwrapped.element as z.ZodTypeAny, `${path}[]`, out);
  }
  // ZodRecord, ZodEnum, ZodString, ZodNumber, ZodBoolean, ZodLiteral, … : nothing enumerable
  // beneath them — stop.
}

// Exported only for configSchema.test.ts to pin the exact generated shape against a literal —
// describeIssue() below is the only real consumer.
export const KNOWN_KEYS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  collectKnownKeys(TrackerConfigSchema, '', out);
  return out;
})();

function pathTemplate(path: ReadonlyArray<PropertyKey>): string {
  return path.map((seg) => (typeof seg === 'string' ? seg : '[]')).join('.').replace(/\.\[\]/g, '[]');
}

// Plain Levenshtein edit distance — small closed alphabet of config keys, so no need for
// anything fancier than the textbook DP table.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

// Exported: ZTB-23 reuses this generic "did you mean" mechanism for write-time `--state`
// validation against a preset's status enum (src/presetRegistry.ts) — same shape of problem (a
// typo'd token against a small known set), no reason to re-derive the edit-distance logic twice.
export function nearestKey(key: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = levenshtein(key.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }
  // A suggestion only when it's plausibly a typo, not a wholly different word.
  return best !== undefined && bestDist <= Math.max(3, Math.ceil(key.length / 2)) ? best : undefined;
}

function describeIssue(issue: z.ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    const parent = pathTemplate(issue.path);
    const candidates = KNOWN_KEYS[parent] ?? [];
    return issue.keys.map((key) => {
      const suggestion = nearestKey(key, candidates);
      const at = parent ? `"${parent}"` : 'the top level';
      return `unknown key "${key}" at ${at}${suggestion ? ` — did you mean "${suggestion}"?` : ''}`;
    }).join('; ');
  }
  // A bad key in an enum-keyed record (e.g. a typo'd category name under
  // `organization.check.categories` — enforceable since the z.partialRecord switch above): zod
  // reports `invalid_key` with the offending key as the path tail and the valid vocabulary inside
  // the nested key-schema issue's `values`. That's everything needed to phrase it exactly like the
  // unrecognized_keys case — did-you-mean included — without any parallel table of record
  // vocabularies (which would be a new hand-synced mirror, the disease this file just cured).
  if (issue.code === 'invalid_key') {
    const key = String(issue.path[issue.path.length - 1]);
    const parent = pathTemplate(issue.path.slice(0, -1));
    const candidates = issue.issues.flatMap((nested) =>
      nested.code === 'invalid_value' ? nested.values.map(String) : []);
    const suggestion = nearestKey(key, candidates);
    const at = parent ? `"${parent}"` : 'the top level';
    return `unknown key "${key}" at ${at}${suggestion ? ` — did you mean "${suggestion}"?` : ''}`;
  }
  const at = issue.path.length ? `"${pathTemplate(issue.path)}": ` : '';
  return `${at}${issue.message}`;
}

/** Validate the parsed JSON against the full `TrackerConfig` shape and return the typed, validated
 *  result. Throws a single Error naming every offending key (unrecognized or otherwise) — each
 *  caller (config.ts `loadTrackerConfig`, importDriver.ts `applyRegister`) prefixes it with the
 *  config path; the top-level catch (cli.ts) reports it and exits nonzero.
 *
 *  ZTB-26 dev/03: this used to be `assertValidTrackerConfigShape(raw): void`, which discarded
 *  `result.data` on success — forcing every caller back to its OWN unvalidated
 *  `JSON.parse(...) as TrackerConfig` cast just to get a typed value. That cast was the untyped
 *  config-read hatch this AC closes (importDriver.ts `applyRegister` blindly rewrote a config file
 *  it never actually validated). Returning the parsed, typed data removes the need for the cast
 *  entirely. */
export function parseTrackerConfig(raw: unknown): RawTrackerConfig {
  const result = TrackerConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  const messages = result.error.issues.map(describeIssue);
  throw new Error(messages.join('\n  - '));
}
