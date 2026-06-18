# Preset Reference

A ztrack preset is the repo-local rulebook for what "done" means. `ztrack init`
always installs one editable preset at:

```text
.volter/tracker/validation/preset.cjs
```

After installation, that file belongs to the target repository. Teams should
edit it as their workflow becomes more specific.

## Install Presets

| Preset | Use When | What It Enforces |
|---|---|---|
| `basic` | Unknown or early-stage repos | checked ACs need commit + evidence refs; non-canceled cases need an assignee |
| `simple-sdlc` | A small software lifecycle | `basic` plus source markers, at least one AC on active cases, and all ACs passed before done |
| `simple-spec` | Repos that write issue-shaped specs | `simple-sdlc` evidence style plus required `## Requirements` and `## Acceptance Criteria` sections |
| `speckit` | Repos following GitHub Spec Kit conventions | `simple-sdlc` evidence style plus required `## User Stories`, `## Functional Requirements`, and `## Tasks` sections |

Install one with:

```bash
npx ztrack init --team APP --preset basic
npx ztrack init --team APP --preset simple-sdlc
npx ztrack init --team APP --preset simple-spec
npx ztrack init --team APP --preset speckit
```

Omitting `--preset` uses `basic`.

## Which Preset To Start With

Use `basic` if you are adopting ztrack into an existing repo and do not yet have
written workflow rules. It proves the core value quickly: checked work must cite
real evidence.

Use `simple-sdlc` if the repo already treats tickets as lifecycle records and
you want ztrack to block unsourced or AC-less active work.

Use `simple-spec` if issues are the spec surface and should always carry
requirements plus acceptance criteria.

Use `speckit` if the project already uses, or is adopting, GitHub Spec Kit style
feature records.

## Installed Contract

The installed file is plain CommonJS so a fresh repo can edit it without a build
step. It exports a core `Preset` produced by `createGenericPreset`:

```js
module.exports = require("ztrack/preset-kit").createGenericPreset({
  name: "basic",
  requireSourceMarker: false,
  requireSdlcGates: false,
  requireSpecSections: false,
  requireSpeckitSections: false,
});
```

`createGenericPreset` returns a real core `Preset` — an mdast parser, one strict
Zod schema, and pure rules. Each `--preset` flips the booleans above. Most teams
should edit that file instead of creating a new package.

A preset defines validation as ONE typed pipeline: the loader (the only impure
boundary) reads the backend and calls the preset's own `loadContext` to gather
its observed facts → an mdast parser produces a candidate `root` →
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

### Authoring A Custom Preset

To go beyond the generic kit, replace `preset.cjs` with your own core `Preset`:

```js
const { z } = require("zod");

module.exports = {
  name: "my-sdlc",
  // ONE strict schema; every nested object .strict(), no .passthrough()/any/unknown.
  schema: z.object({
    issues: z.array(z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      status: z.enum(["pending", "active", "done"]),
      acceptanceCriteria: z.array(z.object({
        id: z.string(),
        status: z.enum(["pending", "passed"]),
        evidence: z.array(z.object({ id: z.string() }).strict()),
      }).strict()),
    }).strict()),
  }).strict(),
  // mdast -> candidate root (structure from the AST, regex only within node text).
  parse(markdown) {
    return { issues: [] };
  },
  // the preset's HALF of the impure loader: gather ONLY the observed facts this
  // preset's rules read (git/world/services). Omit if rules need no context.
  loadContext({ projectRoot }) {
    return require("ztrack/preset-kit").gitWorld(projectRoot, []);
  },
  // pure rules over the validated { context, root }.
  rules: [
    {
      name: "checked_ac_needs_evidence",
      run({ root }) {
        return root.issues.flatMap((issue) =>
          issue.acceptanceCriteria
            .filter((ac) => ac.status === "passed" && ac.evidence.length === 0)
            .map((ac) => ({
              code: "checked_ac_needs_evidence",
              severity: "error",
              message: `${issue.id}/${ac.id} is passed but cites no evidence`,
            })));
      },
    },
  ],
};
```

Reference core presets live in the repository at `src/presets/{default,spec,speckitCore}.ts`
(see https://github.com/volter-ai/ztrack) — they're the worked examples to copy.

## Evidence Grammar

Installed presets recognize checkbox acceptance criteria:

```markdown
- [ ] dev/01 status: pending Implement the behavior. [1]
- [x] dev/02 status: passed Wire the API. commit: abc1234 [E1]
```

And evidence entries — each a GFM list item under `## Evidence` (one entry per
list item, so the parser reads each as its own node):

```markdown
## Evidence

- [E1] type: pr ac: dev/02 repo: owner/repo number: 12 head: abc1234 justification: Shows the implementation.
```

Common checks:

- Non-canceled cases need an assignee.
- Checked or `status: passed` ACs need a commit hash.
- In a git repo, cited commits must exist.
- Checked ACs need evidence refs.
- Evidence refs must point to `[E...]` rows.

## Universal Ids And Blocking

Every node in the validated root has a **universal id** — a colon-delimited path
that names it absolutely:

```text
APP-1                 an issue
APP-1:dev/01          an acceptance criterion
APP-1:dev/01:E1       a piece of evidence
APP-1:dev/01:proof    that AC's proof
```

The id is *derived* from a node's position — it is never a stored field. Because
ids never contain `:`, the separator is unambiguous at every level.

Cross-references are written **relatively** by default and **absolutely** only
when they must escape their scope. Inside an issue, a bare AC ref means "an AC in
this issue"; to point at another issue's AC, qualify it. The parser resolves every
ref to its absolute form, so the validated root only ever holds fully-qualified
references.

The `basic`, `simple-sdlc`, `simple-spec`, and `speckit` presets implement
blocking with `blocked-by:` / `blocks:` on the checkbox line:

```markdown
- [ ] dev/03 status: pending Wire the UI. blocked-by: dev/02, APP-2:dev/01, APP-4 [1]
```

The default reference preset authors the same via sub-lines under the AC:

```markdown
- [ ] AC-3 v1 Wire the UI
  - status: pending
  - blocked-by: AC-2, APP-2:dev/01, APP-4
  - blocks: AC-4
```

A blocker targets either a **specific AC** (`APP-2:dev/01`, or a bare `dev/02` for
this issue) or a **whole issue** (`APP-4` — satisfied when all of APP-4's ACs are).
A bare token is read as a local AC if one exists, otherwise as an issue. Blocking
therefore crosses levels freely: AC↔AC, AC↔issue, issue↔issue. Issue↔issue blocking
is also authored at the issue level via `relations` (`Blocks:` / `Blocked by:`).

`blocked-by` and `blocks` are two ways to author the **same** dependency edge:
`X blocked-by Y` and `Y blocks X` both mean "X depends on Y." Every direction and
level feeds **one** unified directed graph (`core/blocking.ts`), derived from the
validated root, never stored. Blocking checks (cross-tree, one pass):

- Every blocker ref must resolve to a real node (`ac_blocker_missing`).
- An AC may not list itself as a blocker (`ac_self_block`).
- The graph must be acyclic — an impossible-to-satisfy loop, including a cross-level
  deadlock, fails (`ac_block_cycle`).
- A done node may not depend on an unfinished one, via any edge direction or level
  (`ac_blocked_by_unpassed`).

The same graph powers a derived, transitive **blocked / actionable** view
(`blockStatuses`): a node is *blocked* when anything in its upstream dependency
closure is not yet satisfied, and *actionable* otherwise. A node is satisfied when an
AC is passed, or when an issue's ACs are all passed (an AC-less issue, per its
terminal status).

## Evolving The Preset

There is no separate public `custom` preset. Customization is the normal state:
install the closest starter, then edit `.volter/tracker/validation/preset.cjs`.

Before adding rules, write down:

- What work item types count as cases.
- What states exist and which transitions should fail.
- What AC families exist.
- What evidence each AC family needs.
- Which external systems are sources.
- Which finding codes agents should learn to fix.

Keep hard, deterministic checks in `ztrack check`. Put subjective guidance in
`ztrack lint` or documentation.
