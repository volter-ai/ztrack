# Using ztrack

A task-oriented guide to adopting and running ztrack — for a person or an AI agent adding it to an
existing repository. ztrack is not a replacement for GitHub Issues / Linear / Jira; it's a local
**verification layer**: a checked task claim must cite evidence ztrack can resolve.

| Piece | Owns |
|---|---|
| Your tracker (GitHub/Linear/Jira) | human planning, discussion, assignment |
| ztrack store | local mirror of work items and issue bodies |
| Installed preset (`.volter/tracker/validation/preset.mts`) | the repo-local rules for "done" |
| `ztrack check` | deterministic verification of checked claims |
| CI / MCP / stop-hook | where failures block agents or PRs |

This guide follows the two-step shape of the [README](../README.md): **[set up](#1-setup)** ztrack
once, then **use** it two ways — **[`check`](#2-usage-verify-on-demand)** to verify on demand, and
**[`loop`](#3-usage-drive-an-agent-to-green)** to hold an agent's turn until the work is green. Each
is expanded below.

## 1. Setup

```bash
npx ztrack init                       # installs the recommended preset + config (run `ztrack init --list` to choose)
npx ztrack issue scaffold --title "First verified task" > body.md
npx ztrack issue create --title "First verified task" --label type:case --state ready --assignee "$USER" --body-file body.md
npx ztrack check
```

`init` writes `.volter/tracker-config.json`, a markdown issue store under `.volter/tracker/`, and the
editable preset at `.volter/tracker/validation/preset.mts`. **Prerequisites:** Node ≥ 22.18 and a git
repo (the store is plain markdown — no database). Pick a preset with
[`ztrack init --list`](PRESETS.md) — `simple-sdlc` is the recommended baseline.

**Local or linked.** The default is a local tracker (issues committed as markdown in your repo). To
make your issues *be* GitHub Issues, synced both ways, init with a link:
`npx ztrack init --sync github --repo owner/name` (see [How linked sync works](#how-linked-sync-works)).

**Sources.** The default is one implicit store, `.volter/tracker/markdown/` (one file per issue).
Declare `sources:` in `.volter/tracker-config.json` to add more, including a `document` source —
one markdown file (your existing plan or backlog) decomposed into many issues by its id-bearing
headings. See [Sources](SOURCES.md).

**Prove the gate.** Before wiring any workflow rules, prove the core gate catches a bad claim:

1. Mark one acceptance criterion passed (`[x]` + `status: passed`).
2. Cite a **fake** commit: `evidence ev1: commit=deadbeef acv=1`, plus a `proof:` line.
3. `npx ztrack check` → `evidence_commit_not_found`, **exit 1**.
4. Replace the fake SHA with a real commit reachable in the repo → **exit 0**.

That red→green is the whole idea. Run it end-to-end from this repo with `bash demos/local-red-green.sh`.
(For what counts as evidence — images, attach mode, attestation — see [Evidence](EVIDENCE.md).)

When you're ready, write down what "done" means and [customize the preset](#4-customize-the-preset).

## 2. Usage: verify on demand

`ztrack check` verifies once and exits `0`/`1`. Use it for a manual "is this real?", pre-merge, and
CI gating. It takes the **same target grammar** the loop does:

```bash
ztrack check                 # (nothing)     the whole tracker
ztrack check LOCAL-1         # <issue-id>    one issue
ztrack check ./body.md       # <file.md>     a loose markdown file, treated as an issue
ztrack check                 # (in a worktree named for an issue) → that issue, automatically
```

A loose `./body.md` is checked for **structure + evidence**; lifecycle/PR gates (ready/in-review/done)
apply only to **stored** issues, so a loose file is treated as a draft.

### Gate it in CI

A fresh CI checkout doesn't contain your local store, so commit a **validated root** and gate that:

```bash
npx ztrack export --out .volter/root.json
git add .volter/tracker-config.json .volter/tracker/validation/preset.mts .volter/root.json
```

```yaml
name: ztrack
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: volter-ai/ztrack@v0
        with:
          root: .volter/root.json
```

**Phases.** `ztrack check` runs every rule by default (`--phase all`, including structure/readiness
transitions). For an ongoing PR gate you usually want only the continuous rules:

```bash
npx ztrack check --phase gate    # skip promotion/transition checks on already-landed issues
```

**GitHub-linked tracker.** In linked mode your issues live on GitHub (the local store is gitignored),
so there's no committed `root.json`. Pull then check (the Action gates a committed root; it does not
sync) — this needs the optional sync peers installed and must run under bun; see the canonical
recipe just below.

### GitHub sync since 0.38: install the peers, run under bun

Two-way GitHub sync (`ztrack sync github`) is powered by `@volter-ai-dev/twin` and
`@volter-ai-dev/twin-github`. Since 0.38.0 (the twin/twin-github split — see CHANGELOG) these are
**optional peer dependencies**, not regular dependencies of `ztrack`. Everything else — `check`,
`evidence`, `issue *`, every preset — works with nothing extra installed; only `sync github` (and a
preset that opts into world-backed evidence, see [EVIDENCE.md](EVIDENCE.md#advanced-validating-against-a-mirrored-world))
needs them.

1. **Install the peers explicitly** — a plain `npm install ztrack` does not pull them in:

   ```bash
   npm install -D @volter-ai-dev/twin @volter-ai-dev/twin-github
   ```

   Without them, any twin-touching command fails closed with: *"ztrack sync github requires the
   optional sync packages. Install them with: npm install -D @volter-ai-dev/twin
   @volter-ai-dev/twin-github"*.

2. **Run `sync github` under bun, not npx/node.** `@volter-ai-dev/twin-github` ships TypeScript
   source only (no compiled JS entry point). Node — even with the peer correctly installed —
   refuses to type-strip a `.ts` file that lives under `node_modules`
   (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`); this is a hard platform restriction, not
   something a flag lifts. bun is TS-native and loads it directly:

   ```bash
   bunx ztrack sync github --pull
   # or, if ztrack is already a devDependency:
   bun node_modules/.bin/ztrack sync github --pull
   ```

   `npx ztrack sync github` (or a plain `node` run) fails by design with a hint to use bun instead.
   Every other command keeps working fine under npx/node — only `sync github` needs bun.

3. **CI recipe** — install bun, install the peers, run sync under bun, then gate with the usual
   Action (which stays on Node — `check` itself never touches twin):

   ```yaml
   jobs:
     check:
       runs-on: ubuntu-latest
       env:
         GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}   # auth for sync; no PAT prompt
       steps:
         - uses: actions/checkout@v6
           with: { fetch-depth: 0 }
         - uses: oven-sh/setup-bun@v2
           with: { bun-version: 1.2.20 }
         - run: npm install -D @volter-ai-dev/twin @volter-ai-dev/twin-github
         - run: bunx ztrack sync github --pull        # repo/policy come from the init link
         - run: npx ztrack check --phase gate          # check has no twin dependency; node is fine
   ```

Auth uses the `gh` CLI or `GITHUB_TOKEN` (never a prompted PAT).

### How linked sync works

- **GitHub is the source of truth.** In linked mode ztrack **gitignores** the local issue store
  (`.volter/tracker/markdown/`) — issues live on GitHub, not in your repo (in *local* mode that store
  is committed). Re-clones repopulate it on the next `ztrack sync github`.
- **Push vs pull.** `ztrack sync github` pulls GitHub's issues then pushes your local edits back — a
  three-way merge (committed base vs. your tracker vs. GitHub) reconciles field by field, so
  non-overlapping edits on both sides land.
- **Conflicts gate the check.** When the *same field* changed on both sides, ztrack raises an
  unwaivable `sync_conflict` (so `check` fails until resolved) and writes a local-only `## Conflicts`
  block into the body. Resolve by editing + re-syncing, or pick a `--policy hub-wins | twin-wins |
  merge` (default `merge`), settable on `sync`/`init` or as `sync.policy` in the config.

### Parent/child issues

`--parent <id>` filters `issue list`, and sets/clears the link on `issue create` and `issue edit`
(`--remove-parent` detaches) — the CLI and SDK both take it. `parent` is the source of truth; the
`children` array on the parent side is a **denormalized view** derived from it, not independently
edited. `issue edit --parent`/`--remove-parent` keeps both ends honest: it updates the OLD and the
NEW parent's `children` on every real reparent. `issue create --parent` does **not** backfill the new
parent's `children` (a child minted with a parent from birth won't show up in the parent's `children`
until something re-triggers the sync); nor does an `issue edit --parent` that names the SAME parent it
already has (that's not a change, so nothing to sync) — detach (`issue edit <child> --remove-parent`)
then reattach (`issue edit <child> --parent <id>`) if you need to force a backfill. `issue list
--parent <id>` is unaffected either way — it filters by the `parent` pointer directly and never reads
`children`.

**Project label.** `--project <name>` sets a free-form project/grouping label on `issue create` and
`issue edit` (`--remove-project` clears it); the CLI and SDK both take it. Unlike `--parent`, it is
**not** validated against a project registry and does **not** filter `issue list` — it's a plain
string stored on the issue and surfaced on `issue view`/GraphQL as `project: { id, name }` (both set
to the string you passed). This is unrelated to the visualizer's own `--project <dir>` flag (a
filesystem path — see [Visualize](#5-visualize)).

### Importing a freeform backlog

Real backlogs are rarely written in the strict grammar above — they're headings, prose, and
checkboxes with no id tokens, which parses to zero issues today, silently. `ztrack import
<path-or-glob>...` materializes that freeform markdown into the grammar **in place, idempotently**:

```bash
ztrack import notes/backlog.md --dry-run   # preview the planned issue tree + diff; writes nothing
ztrack import notes/backlog.md             # materialize
ztrack import notes/ --register            # a directory (recursive) or a quoted glob, each file
                                            # its own document source; --register declares the
                                            # result(s) in tracker-config.json's `sources`
```

Re-running it is always safe: an already-canonical file is a no-op, and re-importing after
appending new freeform content touches only the new bytes. A pre-checked `- [x]` item imports
UNCHECKED with a preserved-claim marker (`(imported: previously marked done — needs evidence)`) —
closing it for real is a normal `ztrack ac patch` citing the actual commit. Full grammar mapping,
the `[x]` policy, and the idempotence contract:
[Sources → Importing a freeform backlog](SOURCES.md#importing-a-freeform-backlog).

## 3. Usage: drive an agent to green

This is the **recommended development flow**. `ztrack loop start <issue>` arms a *ralph loop* whose
oracle is `check`: Stop/SubagentStop hooks hold every turn in the armed root — the main agent's and
any subagent's it delegates to — until that issue is green, then disarms — capped so it can't grind
forever. It takes the [same target grammar](#2-usage-verify-on-demand) as `check`
(id, file, or the current worktree's issue).

```bash
ztrack loop start LOCAL-1                 # arm: the agent's turn won't end until LOCAL-1's CURRENT stage passes check
ztrack loop start LOCAL-1 --until done    # arm, driving further: hold until LOCAL-1's status reaches "done" (or later) AND passes check there
ztrack loop status                       # is a loop armed? capped? shows the --until stage, if any
ztrack loop stop                         # disarm
```

**Two modes, same `start`.** Bare `loop start` answers "is the CURRENT stage real?" — the loop
disarms the moment `check` is green at whatever status the issue already has. `--until <stage>`
answers a different question: "drive this issue all the way to `<stage>`." That distinction matters
because, without it, driving an agent to completion meant pre-flipping the issue into a
gate-triggering status (e.g. `in-review`, so `review_requires_all_acs_passed` fires) just to give
the loop something to hold on — gaming the oracle with a status that wasn't true yet. With
`--until`, the loop itself holds the turn until the status genuinely gets there.

`<stage>` is a value from the active preset's status vocabulary, in its declaration order (the same
order the preset's own lifecycle gates use to mean "at or beyond") — `ready`, `in-progress`,
`in-review`, `done` for the default `simple-sdlc` preset. It's validated at ARM TIME: an unknown
stage fails immediately, naming the real vocabulary with a did-you-mean, and a project with no
loadable validation preset fails the arm outright (a stage target is meaningless without a
vocabulary to rank it in) — never a silent degrade to bare semantics. `--until` only applies to a
target that resolves to ONE issue (an explicit id, or the bare/auto-resolved worktree issue); a
file or the whole tracker has no single status to drive, and arming one with `--until` fails loud.

Flipping the issue's status to the target stage early does **not** defeat this: that stage's own
lifecycle gates still evaluate for real, so `ztrack issue edit LOCAL-1 --state done` before every AC
is actually passed just trades one red finding (`loop_until_not_reached`) for another
(`review_requires_all_acs_passed`) — the loop stays held either way. This also means `--until` is
useful WHILE AUTHORING an issue, not just while implementing one: `ztrack loop start LOCAL-1 --until
ready` arms before the issue even has real dev ACs, and holds the drafting agent until the order has
acceptance criteria and passes `ready`'s own gates — a loop for writing a good ticket, not just for
closing one.

`loop start` also does two arm-time honesty checks, warning (never refusing) rather than silently
doing something surprising: it best-effort detects whether the ztrack-gate Stop/SubagentStop hooks
are actually wired anywhere it can see (the plugin enabled, or the hooks wired by hand in Claude
Code settings) and warns with the install pointer below if not — another harness may wire the hooks
invisibly to this check, so a negative result only warns; and a BARE arm (no `--until`) on a target
that's already green right now warns that the loop has nothing to hold on and will disarm on the
very first turn — still arms, since that's occasionally exactly what you want (a quick "did I break
anything" check-and-release). Arming the same already-green issue WITH `--until` is the intended
use and gets no such warning.

**Honest escapes (none fakes "done"):** disarm, a per-actor self-exempt (a session or a subagent)
that can't outlive it, and a durable [`ztrack waiver sign`](PRESETS.md#waivers) for a finding an
authority knowingly accepts — or descope the AC. It's cooperative, not a sandbox.

**Install the gate** (Claude Code). The plugin is **armed-only**, so interactive work is untouched and
it's safe to leave enabled globally:

```
/plugin marketplace add volter-ai/ztrack
/plugin install ztrack-gate@ztrack
```

For a non-plugin / custom harness, wire the hook into both your `Stop` **and** `SubagentStop` hooks
directly (the same script, registered under both events — it reads `hook_event_name` from
neither; a subagent's turn ends via `SubagentStop`, never `Stop`, so skipping it leaves subagent
turns ungated) — it ships at `node_modules/ztrack/plugins/ztrack-gate/hooks/stop-loop.sh`
(armed-only). In a Claude Code `settings.json`:

```json
{
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "bash node_modules/ztrack/plugins/ztrack-gate/hooks/stop-loop.sh" } ] } ],
    "SubagentStop": [ { "hooks": [ { "type": "command", "command": "bash node_modules/ztrack/plugins/ztrack-gate/hooks/stop-loop.sh" } ] } ]
  }
}
```

The package also ships `node_modules/ztrack/hooks/stop-check.sh`, an **always-on** gate (same `Stop`
wiring) that auto-scopes to the branch/worktree issue every turn — use it for continuous gating
without arming a loop.

### Orchestrating a whole backlog: one long-lived session, many issues

Everything above drives **one issue**. That's actually the *degenerate* case of a bigger pattern: one
orchestrator session that takes a whole backlog — a big pile of tasks, with real dependencies between
them — from "written down" to "done", dispatching a loop-armed subagent per unblocked issue instead of
working one at a time. Four moves, in order, all built from pieces already covered above:

**1. Intake — get the backlog into the tracker.** Three real entry points, pick whichever matches how
the work already exists:

```bash
ztrack import notes/backlog.md              # (a) author one freeform file, materialize it in place
ztrack import notes/ --register             # (b) point ztrack at a folder of issue-shaped .md files
ztrack init --sync github --repo owner/name # (c) import from GitHub Issues (two-way sync)
```

(a)/(b) are [Importing a freeform backlog](#importing-a-freeform-backlog) — write the tasks the way
you'd naturally write them (headings, prose, checkboxes), and `import` turns them into real issues,
idempotently, without inventing evidence for anything that looked pre-checked. (c) is the
[linked-sync setup](#how-linked-sync-works) — GitHub becomes the source of truth and `ztrack sync
github --pull` (or the CI step) keeps the local view current.

**2. Groom — get every issue ready.** An imported or freshly-written issue is usually a stub: a title
and maybe a summary, no real acceptance criteria yet. Arm a *drafting* loop per issue and run an
authoring agent on it:

```bash
ztrack loop start LOCAL-1 --until ready
```

This holds the turn until the issue has genuine `dev/NN` acceptance criteria and passes `ready`'s own
gates (see [drive-to-stage](#3-usage-drive-an-agent-to-green) above) — **not** until any code exists;
evidence is a `done`-gate concern, not a `ready`-gate one. Repeat for every issue in the backlog before
moving on — an orchestrator that dispatches implementation work onto a stub issue is dispatching onto
nothing testable.

**3. Order — encode the real dependencies.** Once issues are ready, name what actually blocks what:
issue-level `Blocked by: <id>` / `Blocks: <id>` lines (a paragraph in the body), or a per-AC
`blocked-by: <ref>` / `blocks: <ref>` line nested under a specific acceptance criterion when the
dependency is narrower than "the whole other issue" (see [Presets → Universal ids and
blocking](PRESETS.md#universal-ids-and-blocking) for the exact grammar, and
`boilerplates/presets/simple-sdlc.ts` for a worked example). `ztrack check` is what proves this is even
a valid plan: it fails closed on a
blocking **cycle** (`ac_block_cycle`), a reference to an issue/AC that doesn't exist
(`relation_target_missing` / `ac_blocker_missing`), and a one-sided relation
(`relation_not_reciprocal`, a warning) — so a backlog that passes `check` is a genuine DAG, not just a
pile of hopeful cross-references.

**4. Dispatch — work the frontier, wave by wave.** With the DAG in place, ask which issues are
actionable **right now** instead of re-deriving the graph by hand:

```bash
ztrack issue list --actionable --json identifier,title,state    # the dispatch frontier: not done, not blocked
ztrack issue list --blocked --json identifier,title,blockers     # the complement: named, nearest unmet blocker(s)
```

`--actionable` is every not-done issue with no unmet (transitive) dependency — map each row straight to
a subagent dispatch: one loop-armed `ztrack loop start <id> --until done` per issue, each in its **own
worktree** (so concurrent subagents don't collide on the same files or the same loop marker — a loop is
armed per worktree). Merge each back into the trunk **sequentially**, running `ztrack check` after every
merge (the same gate from [§2](#2-usage-verify-on-demand)) before starting the next wave. Once a wave
lands, re-run `--actionable` — issues that were blocked on the just-finished wave are now on the
frontier — and dispatch again. Repeat until `--actionable` returns nothing and the whole backlog is
`done`.

`--blocked` is the diagnostic when a wave stalls: it doesn't dump the whole transitive closure of
unmet work behind a stuck issue, just the **nearest** hop(s) — the actual thing to go unblock next
(and its current status), not everything eventually standing between here and done. A row can be
blocked by another whole issue, or by one specific acceptance criterion of one (a narrower,
AC-to-AC dependency) — either way it shows up the same: an id, or `id:acId`, plus that node's status.
Both `--actionable` and `--blocked` refuse to be combined (they're two views of one computation, not
composable with each other) and reject `--parent` (not modeled at this level); `--state`/`--label`/
`--search`/`--limit`/`--json <fields>` all compose normally on top, same as plain `issue list`. Neither
crashes on a tracker whose `check` is otherwise red, and with no relations authored anywhere,
`--actionable` degrades to "every not-done issue" and `--blocked` to nothing — the honest answer when
there's no DAG to walk yet.

An issue's `state` is always in the row (both views): `--actionable` includes issues already
`in-progress`/`in-review` — they're unblocked, just already claimed — so an orchestrator dispatching
fresh subagents should filter those out (or treat re-dispatching one as "resume", not "start").

The single-issue loop this section opened with is this same lifecycle with a backlog of one — intake
and grooming already done by hand, one node, no ordering to prove, one dispatch, one wave.

### Expose ztrack as MCP tools

An MCP-capable agent can drive ztrack directly (and self-gate without the loop by calling
`tracker_check` before finishing):

```bash
claude mcp add ztrack -- npx ztrack mcp serve
```

`ztrack mcp serve` (over stdio) exposes seven agent-facing tools:

| Tool | Does |
|---|---|
| `tracker_check` | validate the tracker / an issue / a file — the completion oracle |
| `tracker_issue_list` / `tracker_issue_view` / `tracker_issue_create` | list / inspect / create issues |
| `tracker_patch` | overlay schema fields onto an issue or AC (mark passed, cite evidence) |
| `tracker_fmt` | canonicalize an issue body through the preset grammar |
| `tracker_init` | install a preset + config |

Tell the agent: *call `tracker_check` before finishing; if it's red, produce the missing evidence
rather than marking the task done.* The copy-paste one-shot adoption prompt and driving rules live in
the [AI agent playbook](AGENT-PLAYBOOK.md). For a non-MCP harness with no hook system, run
`npx ztrack check` as a final command and treat a non-zero exit as incomplete work.

## When the checker is wrong

`ztrack check` is deterministic, but that doesn't mean every finding applies to your repo — a legacy
AC that predates evidence discipline, a rule that's genuinely wrong for this project. The sanctioned
override is a **waiver**, not editing check's output or turning a rule off globally:

```bash
ztrack waiver sign <issue> --code <finding-code> [--ac <acId>] --reason "..."
ztrack waiver status <issue>
ztrack waiver clear <issue> [--code <finding-code>]
```

A waiver is stored in the issue body's `## Waivers` section, one row per waiver:

```
- code: evidence_commit_unrelated reason: pre-dates paths anchors by: Jane Doe (jane@co.com)
```

`sign` downgrades the matching finding's severity from `error` to `acknowledged` — `check` keeps
reporting it (as `ack`) but exits `0`. Sign-off (the `by:` field) is captured automatically from your
git identity (`git config user.name` / `user.email`), so a waiver always records who accepted the
risk. An unreasoned or unsigned waiver is itself an error (`waiver_missing_reason`,
`waiver_missing_signoff`); a waiver that stops matching any finding — the underlying issue got fixed,
or the rule changed — is flagged `waiver_unused` (a warning, not blocking), so waivers don't silently
accumulate as dead suppression. This is also the mechanism that keeps [`ztrack loop`](#3-usage-drive-an-agent-to-green)
from grinding forever on a finding it can't honestly satisfy.

Prefer fixing the issue; waive only a finding you knowingly accept. Full grammar (including AC-scoped
waivers via `--ac`) is in [Presets → Waivers](PRESETS.md#waivers).

## Relevance

By default, `ztrack check` verifies that cited evidence *exists and is real* — it does not verify that
the evidence is *about* the claimed work. An acceptance criterion can opt in to a **relevance
anchor**: a `paths:` glob declaring which repo paths the AC concerns. Once an AC declares `paths:`,
its cited commit(s) must touch at least one of them, or the checked claim is rejected:

```markdown
- [x] dev/01 v1 GET /health returns 200
  - status: passed
  - paths: src/**
  - evidence ev1: commit=<sha> acv=1
  - proof: "the commit adds the health endpoint" -> ev1
```

A commit here that only touches `docs/` fails with `evidence_commit_unrelated`; one that touches a
`src/` file passes. `paths:` takes globs (`*` within one path segment, `**` across segments,
literal files or directories, a comma-separated list of several) and is satisfied if ANY cited commit
touches ANY declared path.

`paths:` is opt-in by default — a passed AC that omits it is never relevance-checked, so existing repos
are unaffected. To make it mandatory repo-wide, set in `.volter/tracker-config.json`:

```json
{ "relevance": "required" }
```

With `relevance: "required"`, every passed AC must declare `paths:`, or `passed_ac_missing_paths`
fires — so no passed AC can skip the relevance check by omission. Either way, this is still not full
semantic judgment (a commit that touches the right files for the wrong reason still passes) — it's a
deterministic floor: the cited proof must at least land in the area it claims to fix.

## 4. Customize the preset

The installed preset is the customization point. Write down what "done" means before editing it:

| Question | Example |
|---|---|
| What states exist, and which transitions should fail? | `draft→ready→in-progress→in-review→done` |
| What AC families exist? | `dev/NN`, `case/NN`, `proc/NN` |
| What proves a checked AC? | commit + proof; screenshot/video; approval |
| Which rules run only on a state change vs. every check? | readiness gates vs. commit existence |
| What external systems are source material? | GitHub, Jira, Linear, Slack |

If the answer is just "passed ACs need commit-backed evidence," the lighter `spec` preset may be
enough. For workflow-specific states, AC families, source grounding, or approval chains, start from
`simple-sdlc` and evolve `.volter/tracker/validation/preset.mts` — see the
[Preset reference](PRESETS.md) for the grammar, adding a rule, `preset upgrade`, and
[building your own preset](PRESETS.md#building-or-extending-a-preset-maintainers).

## 5. Visualize

```bash
ztrack visualizer                 # the active preset, http://localhost:3300
ztrack viz --preset speckit --port 4000 --project /path/to/repo
```

A read-only web view (requires [Bun](https://bun.sh); first run installs its client deps once). It
runs the tracker through the same core as `check` on every request, so the board reflects exactly
what CI enforces — it never writes. See [the visualizer README](../visualizer/README.md).

## Runnable demos

Every flow above is exercised by a script in [`demos/`](../demos/):

| Demo | Shows |
|---|---|
| `demos/local-red-green.sh` | the red→green core promise in a temp repo |
| `demos/fresh-project-dry-run.sh` | packs + installs the tarball; every preset's red/green, CI gate, MCP, SDK |
| `demos/full-dev-cycle.sh` | a realistic library: planning → implementation → review gate → rework → CI/MCP/SDK/clone |
| `demos/real-project-cycle.sh` | a multi-package workspace with a project-specific custom rule |
| `demos/sdk-api/run.mjs` | programmatic use via `createTrackerClient` (see [API](API.md)) |

## Adoption checklist

- [ ] `npx ztrack init` (or `--preset <name>`; `ztrack init --list` to choose).
- [ ] Create one issue from `ztrack issue scaffold`, run `ztrack check`.
- [ ] Demonstrate one fake-SHA failure and one real-SHA pass.
- [ ] Add a CI validated-root gate (or the linked-tracker variant).
- [ ] For development, install the loop gate and drive an issue with `ztrack loop start`.
- [ ] Add MCP / a stop-hook requiring `tracker_check`.
- [ ] Edit `.volter/tracker/validation/preset.mts` only after writing the workflow contract.
- [ ] Add clean + failing fixtures for every project-specific rule; keep subjective guidance in
  `ztrack lint`, keep `ztrack check` deterministic.

> Adopting with an AI agent? Hand it the [AI agent playbook](AGENT-PLAYBOOK.md) — it has the
> copy-paste one-shot adoption prompt.
