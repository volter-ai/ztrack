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
live in the repository at `boilerplates/presets/{default,spec,speckit}.ts` (see
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

Every owning preset (`default`, `spec`) defines `parse` AND `serialize` on the
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
PR: feat/health          # simple-gh-sdlc only
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

The `default` preset authors blocking via sub-lines under the AC:

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
