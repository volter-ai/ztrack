# Preset Reference

A ztrack preset is the repo-local rulebook for what "done" means. `ztrack init`
always installs one editable, **standalone** preset at:

```text
.volter/tracker/validation/preset.mts
```

After installation, that file belongs to the target repository. It is real,
editable code — its OWN strict schema, its OWN markdown parser, its OWN
`serialize`, and its OWN rules, importing only the mechanism from
`ztrack/preset-kit`. There is no shared/generic model: the three presets share
nothing with each other except the engine. Teams edit the installed preset as
their workflow becomes more specific.

## Install Presets

| Preset | Use When | What It Enforces |
|---|---|---|
| `simple-sdlc` | a dev lifecycle (draft→ready→in-progress→in-review→done), **local or no remote** | every issue assigned; passed ACs carry commit+proof evidence (image optional, verified if cited); evidence fresh against the AC version; lifecycle gates (ready needs a dev AC, in-review needs all ACs passed); opt-in blocking graph is acyclic. **PR-free** — done = all ACs passed-with-evidence (the review's verdict), so it runs with no remote |
| `simple-gh-sdlc` | a GitHub PR-based dev lifecycle (review happens on a PR) | everything `simple-sdlc` enforces, **plus** a PR at in-review and a merged PR for done. *(Stage 2 will also require world annotations + sources.)* |
| `spec` | issue bodies are lightweight specs | passed ACs cite commit-backed evidence; cited commits exist; ids unique |
| `speckit` | repos following GitHub Spec Kit conventions | a multi-file feature bundle with required User Scenarios/Stories, Functional Requirements, and Tasks; task commits exist; foundational tasks gate story completion; Constitution Check gate passes (read-only) |

Install one with:

```bash
npx ztrack init --team APP --preset simple-sdlc      # the lean, PR-free baseline
npx ztrack init --team APP --preset simple-gh-sdlc   # PR-based GitHub flow
npx ztrack init --team APP --preset spec
npx ztrack init --team APP --preset speckit
```

Omitting `--preset` installs `simple-sdlc` (and `--preset default` is an alias for it).
Node 22.18+ is required (native .mts type stripping).

## Which Preset To Start With

Use `simple-sdlc` when you are adopting ztrack into an existing repo — it's the
baseline (and the `default` alias) and proves the core value: a passed acceptance
criterion must cite a real commit and a proof explaining how that commit
demonstrates the AC (an image is optional but verified when cited), and the
issue's lifecycle gates must hold. It needs no remote/PR, so it runs on a private
repo. Choose `simple-gh-sdlc` when your process reviews on GitHub pull requests.

Use `spec` for the lighter spec style: issue bodies whose acceptance criteria are
GFM task-list items, each carrying a commit-backed evidence sub-line. It is the
minimal worked example of a standalone preset.

Use `speckit` if the project already uses, or is adopting, GitHub Spec Kit style
feature records. It is **read-only** (it defines no `serialize`, so it cannot be
`fmt`'d or patched) and adapts a multi-file feature bundle
(`specs/<slug>/spec.md` + `tasks.md` + `plan.md` + …).

## Installed Contract

The installed file is an editable ES module (`.mts`) so a fresh repo can edit it
without a build step, and so it loads in CommonJS consumer repos under Node
type-stripping. It is REAL editable code: it imports the engine, the mdast
mechanism, and the root schema constructor from `ztrack/preset-kit`, and declares
its rules as records over the derived model.

A preset is a self-contained `Preset { name, schema, parse, serialize?, rules,
loadContext?, derive?, primitives?, scaffold? }`. Here is the minimal real shape
(`spec`), trimmed — its own strict schema, its own `parse`, its own `serialize`
(the declared inverse of `parse`), and its own rules:

```ts
// A STANDALONE preset: imports ONLY the public mechanism from `ztrack/preset-kit`.
import {
  z, toMdast, nodeText, type MdNode,
  rule, gitWorld,
  type Context, type Preset, type IssueRecord, type IssueColumns,
} from 'ztrack/preset-kit';

// ── this preset's OWN strict schema (core fields + preset-specific, all .strict()) ──
const SpecEvidenceSchema = z.object({
  id: z.string().min(1),                          // core
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),   // preset: evidence is commit-backed
}).strict();
const SpecAcSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'passed', 'failed']),
  evidence: z.array(SpecEvidenceSchema),
  text: z.string().min(1),
}).strict();
const SpecIssueSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), summary: z.string(),
  status: z.enum(['draft', 'in-review', 'done']),
  acceptanceCriteria: z.array(SpecAcSchema),
}).strict();
const SpecRootSchema = z.object({ issues: z.array(SpecIssueSchema) }).strict();
type SpecRoot = z.infer<typeof SpecRootSchema>;

// ── this preset's OWN parser: each backend RECORD → the schema shape. Metadata (id/title/status)
//    arrives structured in the record's columns; only the body content is mined from its mdast. ──
function parseSpecIssue(record: IssueRecord): unknown {
  const tree = toMdast(record.body);                 // walk tree for summary + acceptanceCriteria
  return { id: record.id, title: record.title, status: record.status || 'draft', summary: '', acceptanceCriteria: [] };
}
function parseSpec(records: IssueRecord[]): unknown {
  return { issues: records.map(parseSpecIssue) };
}

// ── this preset's OWN serialize → ONE issue's stored form: content `body` + metadata `columns`
//    (the declared inverse of parse; the backend persists body and columns separately). ──
function serializeSpecIssue(issue: SpecRoot['issues'][number]): { body: string; columns: IssueColumns } {
  const out = ['## Acceptance Criteria', ''];
  for (const ac of issue.acceptanceCriteria) out.push(`- [${ac.status === 'passed' ? 'x' : ' '}] ${ac.id} ${ac.text}`);
  return { body: out.join('\n'), columns: { title: issue.title, status: issue.status } };
}

// ── this preset's OWN rules: declarative records over the engine's derived model ──
type SpecAC = SpecRoot['issues'][number]['acceptanceCriteria'][number];
const SPEC_RULES = [
  rule<SpecRoot, { acId: string; ac: SpecAC }>({
    code: 'passed_ac_missing_evidence', select: (m) => m.acs,
    when: ({ ac }) => ac.status === 'passed' && ac.evidence.length === 0,
    message: ({ ac }) => `AC ${ac.id} is passed but cites no commit-backed evidence.`,
  }),
  // ...evidence_commit_not_found, duplicate_ac_id, duplicate_issue_id
];

const SpecPreset: Preset<SpecRoot> = {
  name: 'spec', schema: SpecRootSchema,
  loadContext: (input) => gitWorld(input.projectRoot, [], { verifyCommits: input.verifyCommits }),
  parse: parseSpec,
  serialize: serializeSpecIssue,   // the inverse of parse (one grammar, both directions)
  rules: SPEC_RULES,
  scaffold: (title) => `# ${title}\n\nSummary: …\n\n## Acceptance Criteria\n\n- [ ] AC-1 …\n`,
};
export default SpecPreset;
```

Each `--preset` installs that preset's whole source — schema, parser, serialize,
and rules. Most teams edit the records and schema in that file directly instead
of creating a new package. The reference standalone presets (the bar to copy)
live in the repository at `boilerplates/presets/{simple-sdlc,simple-gh-sdlc,spec,speckit}.ts` (see
https://github.com/volter-ai/ztrack).

A preset defines validation as ONE typed pipeline: the loader (the only impure
boundary) reads the backend and calls the preset's own `loadContext` to gather
its observed facts → the preset's mdast `parse` produces a candidate `root` →
`ValidationInputSchema.parse({ context, root })` validates it (one top-level
strict schema, every nested object `.strict()`) → pure rules run over the
validated input → the validated `root` IS the export. The engine
(`src/core/engine.ts`) exposes `check(preset, markdown, ctx)` and
`checkRoot(preset, root, ctx)`, both returning `{ ok, findings, export: root }`.

The validated thing is `ValidationInput { context: Context, root: Root }`, where
`Root { issues: Issue[] }` is always multi-issue (the core shape is
`root.issues[].acceptanceCriteria[].evidence[]`) and `Context` is the typed,
validated pool of observed facts (`now`, `phase`, `git`, `world`, `categories`).
Rules are pure `(input) => Finding[]`: they read only `input.root` /
`input.context` — no file/git/network/time access, no mutation, no throw.

## The Bidirectional Grammar — Parse, Serialize, Patch

Every owning preset (`simple-sdlc`, `spec`) defines `parse` AND `serialize` on the
`Preset` contract: `serialize` is the declared inverse of `parse`, so the grammar
is bidirectional. There is **no structured-mutation DSL**. To change an issue you
PATCH the typed model and the preset re-serializes:

```bash
# the JSON fields are the preset's SCHEMA shape — run `ztrack issue view` to see it
ztrack ac patch <issue> <acId> --json '{"status":"passed"}'
ztrack issue patch <issue> --json '{"status":"in-review"}'
ztrack fmt --issue <issue>                  # canonicalize that issue through the preset's serialize
```

Mutation is `parse → edit the typed object → serialize`, so the file always
conforms to the template the parser reads. MCP exposes a single `tracker_patch`
tool for the same edit. `ztrack export` writes the validated root (`{ issues,
waivers? }`); `ztrack check --input root.json` re-checks that committed root.

The `speckit` preset is **read-only** — it defines no `serialize`, so it cannot
be `fmt`'d or patched. Its features come from Spec Kit tooling and are edited as
the Spec Kit files.

## The `simple-sdlc` / `simple-gh-sdlc` Grammar

Both dev presets share one grammar (`simple-gh-sdlc` is `simple-sdlc` plus the PR
gate). One issue per markdown file. The heading carries the id and title;
designated metadata lines follow; then `## Acceptance Criteria` with one list
item per AC and nested sub-lines for status, evidence, proof, and blocking. The
`PR:` line is only meaningful under `simple-gh-sdlc` (`simple-sdlc` ignores it):

```markdown
# APP-1: Add the /health endpoint

Assignee: alice
Summary: One or two sentences describing the work.
Status: in-review
PR: https://github.com/org/app/pull/42   # simple-gh-sdlc only — the PR URL (the merged-PR gate keys on it)
Labels: backend, api
Blocked by: APP-2

## Acceptance Criteria

- [x] dev/01 v1 GET /health returns 200
  - status: passed
  - evidence ev1: commit=abc1234 acv=1
  - proof: "screenshot shows a 200 response" -> ev1
  - blocked-by: dev/00
  - blocks: dev/02
```

- Issue `Status:` is `draft | ready | in-progress | in-review | done`.
- An AC line is `- [x] <id> v<version> <text>`, followed by nested
  `- status: passed|pending|failed`, `- evidence <id>: commit=<sha> acv=<n>`, `- proof: "<why>" -> ev1`, and optional `- blocked-by:
  <refs>` / `- blocks: <refs>`.
- Issue-level relations are `Blocks:` / `Blocked by:` / `Relates:`; `Children:`
  lists sub-issues.

Rule codes (`simple-sdlc`): `issue_missing_assignee`,
`ac_checkbox_status_mismatch`, `passed_ac_missing_evidence`,
`passed_ac_missing_proof`, `evidence_commit_not_found`,
`evidence_ac_version_stale`, `ready_requires_dev_ac`,
`review_requires_all_acs_passed`, `ac_self_block`,
`ac_blocker_missing`, `ac_block_cycle` — plus the universal `duplicate_ac_id`,
`duplicate_issue_id`, and the waiver codes (`waiver_unused`,
`waiver_missing_reason`, `waiver_missing_signoff`). `simple-gh-sdlc` adds
`review_requires_pr`, `done_requires_merged_pr`, `evidence_sha_stale`,
`current_head_unknown` (the PR-bound rules).

## The `spec` Grammar

`spec` is lightweight. A `# SPEC-1: Title` heading, a `Summary:` and `Status:`
(`draft | in-review | done`), then `## Acceptance Criteria` whose items are GFM
task-list entries carrying a nested commit sub-line:

```markdown
# SPEC-1: Validate the import path

Summary: A short spec of the behavior.
Status: in-review

## Acceptance Criteria

- [x] AC-1 Imports resolve under Yarn PnP
  - commit: abc1234
```

Rule codes (`spec`): `passed_ac_missing_evidence`,
`evidence_commit_not_found`, `duplicate_ac_id`, `duplicate_issue_id`.

## The `speckit` Grammar

`speckit` adapts GitHub Spec Kit. A feature is a multi-file bundle
(`specs/<slug>/spec.md` + `tasks.md` + optional `plan.md`,
`constitution.md`, …). A user story is the testable AC unit; a story is done when
all its `[US#]` tasks are checked, and a task may cite `(commit: <sha>)` as its
evidence. Required sections: **User Scenarios / User Stories**, **Functional
Requirements**, and **Tasks**. It is read-only.

## Universal Ids And Blocking

Every node in the validated root has a **universal id** — a colon-delimited path
that names it absolutely:

```text
APP-1                 an issue
APP-1:dev/01          an acceptance criterion
APP-1:dev/01:ev1      a piece of evidence
APP-1:dev/01:proof    that AC's proof
```

The id is *derived* from a node's position — it is never a stored field. Because
ids never contain `:`, the separator is unambiguous at every level.

Cross-references are written **relatively** by default and **absolutely** only
when they must escape their scope. Inside an issue, a bare AC ref means "an AC in
this issue"; to point at another issue's AC, qualify it (`APP-2:dev/01`). The
parser resolves every ref to its absolute form, so the validated root only ever
holds fully-qualified references.

The `simple-sdlc` preset authors blocking via sub-lines under the AC:

```markdown
- [ ] dev/03 v1 Wire the UI
  - status: pending
  - blocked-by: dev/02, APP-2:dev/01, APP-4
  - blocks: dev/04
```

A blocker targets either a **specific AC** (`APP-2:dev/01`, or a bare `dev/02`
for this issue) or a **whole issue** (`APP-4` — satisfied when all of APP-4's ACs
are). A bare token is read as a local AC if one exists, otherwise as an issue.
Blocking therefore crosses levels freely: AC↔AC, AC↔issue, issue↔issue.
Issue↔issue blocking is also authored at the issue level via `Blocks:` /
`Blocked by:`.

`blocked-by` and `blocks` are two ways to author the **same** dependency edge:
`X blocked-by Y` and `Y blocks X` both mean "X depends on Y." Every direction and
level feeds **one** unified directed graph (`core/blocking.ts`), derived from the
validated root, never stored. Blocking checks (cross-tree, one pass):

- Every blocker ref must resolve to a real node (`ac_blocker_missing`).
- An AC may not list itself as a blocker (`ac_self_block`).
- The graph must be acyclic — an impossible-to-satisfy loop, including a
  cross-level deadlock, fails (`ac_block_cycle`).
- A done node may not depend on an unfinished one, via any edge direction or
  level (`ac_blocked_by_unpassed`).

The same graph powers a derived, transitive **blocked / actionable** view
(`blockStatuses`): a node is *blocked* when anything in its upstream dependency
closure is not yet satisfied, and *actionable* otherwise. A node is satisfied
when an AC is passed, or when an issue's ACs are all passed (an AC-less issue,
per its terminal status).

## Waivers

Waivers are universal and eslint-style — core-parsed, not per-preset. A `##
Waivers` section per issue downgrades a matching finding to `acknowledged`:

```bash
ztrack waiver sign <issue> --code <finding-code> [--ac <acId>] --reason "..."
ztrack waiver status
ztrack waiver clear
```

A waiver that matches nothing emits `waiver_unused`; an unreasoned or unsigned
waiver is itself an error. Sign-off is your git identity, captured automatically.

## Evolving The Preset

There is no separate public `custom` preset. Customization is the normal state:
install the closest standalone preset, then edit
`.volter/tracker/validation/preset.mts` — its schema, parser, serialize, and
rules are all yours to change.

Before adding rules, write down:

- What work item types count as cases.
- What states exist and which transitions should fail.
- What AC families exist.
- What evidence each AC family needs.
- Which external systems are sources.
- Which finding codes agents should learn to fix.

Keep hard, deterministic checks in `ztrack check`. Put subjective guidance in
`ztrack lint` or documentation.

### Add one rule

A rule is a record over the **derived model** `m`. Open
`.volter/tracker/validation/preset.mts`, copy an existing `rule<Root, Scope>({...})` block in the
rules array, and change the predicate. The model exposes ready-made scopes:

- `m.issues` — `{ issueId, issue }` per issue
- `m.acs` — `{ issueId, acId, ac }` per acceptance criterion
- `m.evidence` — `{ issueId, acId, evidenceId, ev }` per evidence row
- `m.duplicateAcIds`, `m.duplicateIssueIds`, `m.graph` (cycles / blocker / completion facts)

```ts
rule<MyRoot, { issueId: string; acId: string; ac: MyAC }>({
  code: 'passed_ac_needs_review_tag',     // a new finding code agents will learn to fix
  select: (m) => m.acs,                    // scope: one match per AC
  when: ({ ac }) => ac.status === 'passed' && !ac.text.includes('[reviewed]'),
  message: ({ ac }) => `AC ${ac.id} is passed but not marked [reviewed].`,
  // severity: 'warning',  // optional; default is an error that fails check
}),
```

For a fact that needs cross-issue computation (not just one item), compute it in the preset's
`derive(model)` and read it back in `select`. Run `ztrack check` to see your rule fire.

### Stay current: `ztrack preset upgrade`

Because your preset is an edited copy, ztrack records the pristine original at install
(`.volter/tracker/validation/.preset.base.mts`) as a merge base. When a new ztrack ships improved
upstream rules, `ztrack preset upgrade` does a **3-way merge** (base → upstream vs. base → your
edits) into your `preset.mts`, preserving your changes. Conflicts are written as `<<<<<<<` markers
to resolve by hand; then run `ztrack check`. It is reported as `up-to-date`, `updated`, or
`no-base` (re-run `ztrack init --preset <name>` to re-seed a base) — keep `.preset.base.mts`
committed so the merge is reproducible.

## Building or extending a preset (maintainers)

The sections above cover editing an installed preset. This section is for building a
*new* standalone preset (or reviewing one) at the source level — an agent changing the
preset system should read it first. Reference standalone presets (the bar to copy):
`boilerplates/presets/{simple-sdlc,simple-gh-sdlc,spec,speckit}.ts` — each its own schema,
parser, serialize, rules. The shared mechanism is the core engine (`src/core/engine.ts`); a
new preset imports only `ztrack/preset-kit`.

> **Presets are standalone — there is NO universal model.** Each preset is a self-contained
> `Preset { name, schema, parse, rules, ... }` with its OWN strict schema, its OWN mdast parser,
> and its OWN rules. Presets share NOTHING with each other except the engine *mechanism*
> (`core/engine.ts`) + dev utilities (mdast, zod) + types — **no shared universal parser or
> schema, no generic preset factory, no flag-toggled mega-preset, and no shared "rule library"
> you pick records from** (see the anti-patterns below).

### Architecture contract — non-negotiable

1. **ONE strict top-level schema.** `ValidationInputSchema = z.object({ context, root }).strict()`
   (composed by `makeValidationInputSchema(rootSchema, contextSchema?)`). Core fields +
   preset-specific fields, every nested object `.strict()`. NEVER `.passthrough()`, `z.any()`,
   `z.unknown()` (except an intentionally-opaque external payload inside `Context`), a raw `body`
   field, or a `sections: Record<>` map.
2. **mdast parse straight into the schema.** Document STRUCTURE (headings scope sections; list
   items / table rows / paragraphs are records; GFM checkboxes) comes from the AST. Regex ONLY to
   read field content from within a node's text — NEVER line-scan the raw doc/section to discover
   records or structure. A leading `---` YAML frontmatter block is allowed (metadata not in the body).
3. **The parse target IS the schema; the validated root IS the export.** No projection / `toIssues`
   / second model. `check()` runs `ValidationInputSchema.parse({ context, root })`; the validated
   `root` is what every surface reads (`{ ok, findings, export: root }`).
4. **Pure rules.** `Rule.run = (input: ValidationInput) => Finding[]` — reads only
   `input.root` / `input.context`. No I/O, filesystem, network, time, raw-markdown, global mutable
   state, `Date.now()`/randomness, mutation of `root`, or `throw`. Deterministic. A rule may declare
   `category`/`depth` for the `ztrack check --categories` selector.
5. **One impure edge: the loader, but context is preset-owned.** Real data (git, twin world, issue
   files) enters only through `core/loader.ts`, which reads the backend, frames each issue into a
   bundle, then calls the **active preset's `loadContext`** to gather exactly the observed facts
   THAT preset's rules read, overlaying the universal run selectors (`now`/`phase`/`categories`).
   A preset that needs no observed facts omits `loadContext`; declare a `contextSchema` (extending
   `CoreContextSchema`) only when it adds facts beyond the core git/world.

(The core model — `ValidationInput`, the always-multi-issue `Root { issues }`,
`Issue`/`AcceptanceCriterion`/`Evidence`, and the typed `Context`
(`now`, `phase`, `git`, `world`, `categories`) — is described under "Installed Contract" above and
defined in `engine.ts`. `phase` selects the rule surface (`all` = full write/promote; `gate` =
skip `transition` rules). Primitives (`labels, relations, children, sources, category, proof`) are
opt-in via `primitives`; `audit` is core/always-on.)

### Source the SDLC faithfully

This is where presets go wrong. Derive from the REAL, authoritative source — never a dormant
predecessor or memory. Verify, don't invent.

- **Premade system (speckit / openspec / …):** `WebFetch` the upstream templates + skill/command
  definitions; install/inspect the real tool's output and map its real artifacts to the schema. Do
  NOT inherit invented fields from an in-repo predecessor — confirm every field against the upstream.
- **Bespoke pre-existing process:** the team's written standards/process docs are authoritative;
  read them ALL first. Use any legacy implementation only to enumerate completeness (rule codes); the
  standards win on semantics. Separate in-scope per-issue markdown structure from the provider layer
  (the world/`Context`).
- **Brand-new (fresh repo):** elicit the process from the user and WRITE IT DOWN before coding — the
  ordered states, the AC type(s), the evidence each completion needs, the per-state entry gates, the
  roles/concurrency. Confirm before building.

### Build order

1. **Map the process:** ordered states · AC type(s) · evidence/proof shape · per-state entry gates ·
   roles · what's out of scope (a different provider).
2. **Design the strict schema:** narrow `status`/enums; model each AC type; evidence/proof as a typed
   pool or nested; the primitives the SDLC uses. `.strict()` everywhere.
3. **Write the mdast parser → schema** (structure from AST; field content via regex within node text;
   frontmatter for metadata; a `===MARKER===` split for multi-file/multi-issue bundles).
4. **Write rules**, grouped: structural existence · checkbox⇄status consistency · per-state gates ·
   evidence requirements + freshness/anchoring (read `ctx.git`) · ref-integrity · completeness/
   cross-issue (over `root.issues`, read `ctx.world`). Each emits a stable `code`.
5. **Loader (impure):** read real data → `Context` + bundle; the only place with fs/world/git. Map
   files↔issues by parsed id (NOT ordinal — parse may drop invalid segments).
6. **Write `serialize`** (the inverse of parse) for a read-write preset; export the preset as the
   module's `default` (its `name` MUST equal the filename); then add the manifest sidecar
   `boilerplates/presets/<name>.json` (`description`, optional `aliases`/`recommended`). Presets are
   discovered by scanning the dir + reading sidecars — there is no central registry (a hardcoded
   enum/array/map is an anti-pattern). See `boilerplates/README.md`.
7. **Tests:** clean fixtures that produce ZERO findings (incl. warnings) at each lifecycle stage,
   plus a perturbation that fires each rule; a strict-schema rejection test; and a `parse∘serialize`
   round-trip test for any read-write preset.
8. **Review** (below), then **prove on real data** via the loader; if porting, cross-check findings
   against the legacy/world validator (they should agree where scope overlaps).

### Never (anti-patterns that caused real bugs)

- **A universal/generic model.** No shared universal schema or parser, no generic preset factory
  emitting presets from flags, no shared "rule library" a preset picks records from
  (`rules: [...sharedGroup]`), no "core model" presets extend. The ONLY shared layer is the engine
  mechanism (`core/engine.ts`). A shared rule menu or shared parser is the same anti-pattern in new
  syntax. (This one is reintroduced repeatedly — it is THE thing this section exists to prevent.)
- A two-layer projection model — the multi-issue validated root IS the export.
- `.passthrough()` / `any` / raw-body / metadata mined from body prose when frontmatter or
  structured fields exist.
- Line-scanning a section to find records (use mdast node boundaries).
- Parser-side semantic INFERENCE (keyword heuristics that invent a fact the artifact never states).
  If the standard requires the fact, require it explicitly.
- Per-file checking that leaves `root.issues` size 1 — it silently defeats every cross-issue rule.
- Hard-error completeness over fuzzy matching or a partial corpus — make it advisory (warning) unless
  the corpus is known-complete and matching is exact.
- Silently defaulting a required field (e.g. an explicit `status:`) — record that it was absent and
  flag it.
- Leaving any emitted `code` unclassified if the repo has a code-classification gate.
- **A central preset list/enum/map.** Presets are discovered by scanning `boilerplates/presets/` +
  their `<name>.json` sidecars — never reintroduce a hardcoded set of preset names (a TS union, an
  `INIT_TRACKER_PRESETS` array, a visualizer `STANDALONE_PRESETS` map, or an enumerated
  `--preset a|b|c` in help/docs). Such a list rots when a preset is added/renamed and silently breaks
  consumers. Use `presetManifest()` / `ztrack init --list`; let the guard test
  (`presetManifest.test.ts`) enforce it.

### Review

Run after building or changing a preset. **Launch the three adversarial lenses below IN PARALLEL**
(each as a `general-purpose` sub-agent, or run them yourself in sequence — resetting framing between
each — if you can't spawn). Prepend the target file paths (the preset + its loader) to each prompt.
Then **reproduce the load-bearing findings yourself** (`bun -e` against the real module — never trust
a review blind) and synthesize one report.

**Lens A — Purity / architecture.** Adversarial; assume NON-conformant, prove deviations, cite
file:line, read-only. SCHEMA: every object `.strict()`, no `.passthrough()`/`any`/`unknown`
smuggling content, no raw `body`/`sections: Record<>`, root multi-issue + strict? PARSER: ALL
structure from mdast, regex ONLY for field content (never line-scanning to discover records),
frontmatter only the leading `---`, bundle split collision-safe, parse target IS the schema, NO
parser-side semantic inference? RULES: each pure (reads only root+ctx, no I/O / Date.now / random /
mutation / throw, deterministic), throw-safe on schema-valid edge input? LOADER: the only impure
edge, files↔issues mapped by parsed id NOT ordinal, no silent catch/unsafe assertion? Output
PASS/PARTIAL/FAIL per criterion with file:line + a prioritized must-fix list.

**Lens B — Edge cases / completeness.** Adversarial; find behaviors WRONG or fragile on real input,
give a concrete failing input per issue and reproduce it with `bun -e`, mark DEFINITE vs THEORETICAL,
cite file:line, read-only. Probe: matching (false matches from short substrings — is there a
specificity floor? — missed matches, URL/key normalization); completeness/gates (right vs standards?
over-fires on a partial corpus → should be warning; any rule that can't fire or fires on valid
input; did legacy gate on a field the new schema dropped?); hash/version staleness stability;
frontmatter edges (quotes, lists, CRLF, nested, block scalars, a `---` in the body); multi-issue
bundle (dup ids, empty segments, ordering); state/evidence gates vs the standards; loader edges +
scale (empty dir, no world, missing files, O(n·m)/memory on multi-MB logs). Output prioritized
must-fix / should-fix / low with file:line + failing input; what the tests do NOT cover; a minimal
fix direction per must-fix (recommend, don't implement).

**Lens C — Realistic-run simulation.** Dynamic; role-play the SDLC's actors and drive MANY realistic
end-to-end runs by hand, read-only. Per run: author a realistic artifact for a lifecycle point, run
check/loader, record EXPECTED vs ACTUAL findings, advance state as the next actor would, re-check.
Cover happy path start→done; each state-gate violated; evidence going stale (sha/version drift); a
multi-issue root with cross-issue relations + partial corpus; world/sources grounding (a true
reflection passes, a short-quote/unrelated one does NOT, an unreflected source surfaces at the right
severity); malformed/adversarial input (missing/duplicate/reordered/no-id) — never crash, never
silent-clean a bad artifact. Drive it as the PM/manager loop: does derived state advance correctly,
or get STUCK / LOOP / FALSELY ADVANCE? Output a numbered run log (scenario · authored · expected ·
actual · verdict); ranked DIVERGENCES with **false-pass before false-fail** + triggering input +
suspected file:line.

**Synthesize.** Collect the three reports; reproduce every must-fix yourself (false-pass divergences
first). Produce one ranked must-fix / should-fix / low list, each with file:line + reproduced failing
input. Re-verify until clean: preset tests green (clean fixtures = 0 findings; a perturbation per
rule), `tsc` clean, and — if porting — world/legacy-validator fidelity on real data where scope
overlaps. **Ready = contract held + behavior correct on real data, not just fixtures green.**
