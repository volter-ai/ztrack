// ZTB-3: runtime shape validation for tracker-config.json. Before this, `loadTrackerConfig`
// JSON-parsed and spread the raw object untyped — a typo'd key (`source:` for `sources:`, or any
// nested misspelling) was silently preserved and ignored, never read by anything. This schema
// makes that fail closed: EVERY key at EVERY level (top-level and nested) is checked against the
// full `TrackerConfig` inventory (types.ts), and an unrecognized key names itself plus its
// nearest valid sibling so the fix is obvious, not a guessing game.
import { z } from 'zod';

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
  policy: z.enum(['hub-wins', 'twin-wins', 'merge']).optional(),
}).strict();

const EvidenceSchema = z.object({
  store: z.enum(['auto', 'commit', 'attach', 'external']).optional(),
  dir: z.string().optional(),
}).strict();

const ValidationSchema = z.object({
  entrypoint: z.string().optional(),
  installedFrom: z.string().optional(),
}).strict();

// `Partial<Record<'sourced'|'code'|'visual'|'behavioral'|'wellformed', number>>` — a plain
// string-keyed record (not an enum-keyed one): zod's enum-keyed `z.record` requires every enum
// member present, which would reject the (intentionally partial) shape every real config uses.
// Matches the identical choice already made for this same shape in core/engine.ts's Context schema.
const CategoriesSchema = z.record(z.string(), z.number());

const CheckVerifyRuleSchema = z.object({
  matchTypes: z.array(z.string()).optional(),
  matchLabels: z.array(z.string()).optional(),
  inspect: z.boolean().optional(),
  categories: CategoriesSchema.optional(),
}).strict();

const CheckSchema = z.object({
  categories: CategoriesSchema.optional(),
  profiles: z.array(z.string()).optional(),
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
  validationPreset: z.string().optional(),
  externalBrowseUrls: z.record(z.string(), z.string()).optional(),
  caseTypeLabels: z.array(z.string()).optional(),
  grammar: GrammarSchema.optional(),
  check: CheckSchema.optional(),
  lint: LintSchema.optional(),
}).strict();

// `backend` is intentionally loose (any string, not the `TrackerBackendName` enum): loadTrackerConfig
// coerces it (`=== 'local' ? 'local' : 'markdown'`) BEFORE this schema ever sees a config missing it
// or naming some other legacy value — that coercion is the existing, deliberately-permissive
// compatibility path (see config.ts), not something this schema should re-litigate.
export const TrackerConfigSchema = z.object({
  backend: z.string().optional(),
  local: LocalSchema.optional(),
  sources: z.array(TrackerSourceConfigSchema).optional(),
  board: z.enum(['branch', 'shared']).optional(),
  sync: SyncSchema.optional(),
  evidence: EvidenceSchema.optional(),
  relevance: z.enum(['optional', 'required']).optional(),
  validation: ValidationSchema.optional(),
  organization: OrganizationSchema.optional(),
}).strict();

// The known keys at each object path, keyed by a template where array indices are collapsed to
// `[]` (e.g. `organization.check.verify.0` -> `organization.check.verify[]`). Used only to offer
// a "did you mean" suggestion for an unrecognized key — not itself a source of truth (the zod
// schema above is); kept in the same file so the two can't drift silently.
const KNOWN_KEYS: Record<string, string[]> = {
  '': ['backend', 'local', 'sources', 'board', 'sync', 'evidence', 'relevance', 'validation', 'organization'],
  local: ['teamKey', 'database', 'store'],
  'sources[]': ['path', 'format', 'readonly'],
  sync: ['provider', 'repo', 'policy'],
  evidence: ['store', 'dir'],
  validation: ['entrypoint', 'installedFrom'],
  organization: ['validationPreset', 'externalBrowseUrls', 'caseTypeLabels', 'grammar', 'check', 'lint'],
  'organization.grammar': ['extends', 'slotAliases'],
  'organization.check': ['categories', 'profiles', 'verify'],
  'organization.check.verify[]': ['matchTypes', 'matchLabels', 'inspect', 'categories'],
  // `rules`' own keys are arbitrary rule names, not an enumerable set — no "did you mean"
  // suggestion is offered for a typo'd rule name, only for a typo'd key of `lint` itself.
  'organization.lint': ['rules'],
};

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

function nearestKey(key: string, candidates: string[]): string | undefined {
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
  const at = issue.path.length ? `"${pathTemplate(issue.path)}": ` : '';
  return `${at}${issue.message}`;
}

/** Validate the parsed JSON against the full `TrackerConfig` shape. Throws a single Error naming
 *  every offending key (unrecognized or otherwise) — the caller (config.ts `loadTrackerConfig`)
 *  prefixes it with the config path; the top-level catch (cli.ts) reports it and exits nonzero. */
export function assertValidTrackerConfigShape(raw: unknown): void {
  const result = TrackerConfigSchema.safeParse(raw);
  if (result.success) return;
  const messages = result.error.issues.map(describeIssue);
  throw new Error(messages.join('\n  - '));
}
