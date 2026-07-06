<h1 align="center">ztrack</h1>

<p align="center"><strong>Done is earned, not declared.</strong> A verification gate for AI coding agents — every &ldquo;done&rdquo; backed by a real commit and proof, or it doesn&rsquo;t pass.</p>

<p align="center">
  <a href="https://github.com/volter-ai/ztrack/actions/workflows/ci.yml"><img src="https://github.com/volter-ai/ztrack/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.npmjs.com/package/ztrack"><img src="https://img.shields.io/npm/v/ztrack.svg" alt="npm"></a>
  <a href="https://www.npmjs.com/package/ztrack"><img src="https://img.shields.io/npm/dm/ztrack.svg" alt="npm downloads"></a>
  <a href="https://github.com/volter-ai/ztrack/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/telemetry-none-brightgreen.svg" alt="no telemetry">
</p>

<p align="center">
  <a href="#setup"><strong>Setup</strong></a> ·
  <a href="#usage"><strong>Usage</strong></a> ·
  <a href="docs/GUIDE.md"><strong>Guide</strong></a> ·
  <a href="#community-and-support"><strong>Support</strong></a> ·
  <a href="https://ztrack.dev/startup-pilot.html"><strong>Startup Pilot</strong></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/volter-ai/ztrack/main/docs/demo.gif" alt="ztrack check: cite a real commit -> green; fake SHA -> exit 1" width="680"></p>

AI coding agents close tickets on prose. "All tests pass, feature complete" — and the
commit it cited never existed. Your tracker stored the claim with perfect fidelity and
verified nothing.

**ztrack is a typechecker for your issue tracker.** A checked acceptance criterion must cite a
commit SHA that exists in git, plus the evidence and proof the preset requires. You use it **two
ways**, over the same work:

- **`ztrack check`** — verify on demand (CI, pre-merge, a spot check). Pass or exit non-zero.
- **`ztrack loop`** — a *ralph loop*: Stop/SubagentStop hooks hold your agent's turn (and any
  subagent's) until the work is actually green. **Recommended while developing** — the agent
  can't call it done until it is.

`check` is the oracle; `loop` runs that oracle on every turn until the agent earns "done."

## What ztrack catches

| Claim in the tracker | What ztrack verifies |
|---|---|
| "Implemented in commit `a1b2c3d`" | the SHA exists in the local git object database |
| "This acceptance criterion is passed" | it cites evidence captured at a real commit, against the current AC version |
| "This evidence proves it" | the AC carries a `proof:` that names the evidence it relies on |
| "This ticket is ready/done" | the installed preset's lifecycle gates hold — every AC passed (and, on a PR-based preset, the PR exists/merged) |

Lint errors are fixed by editing text. Type errors are fixed by producing evidence.

**What it does _not_ verify** (be honest with your team): the `simple-sdlc` preset checks that the
cited commit **exists** and — if you cite an image — that the image is committed at that commit (a
fabricated screenshot path fails). By default it does not check *relevance* — a real, unrelated commit
with a real screenshot still passes — but an AC can opt in to a `paths:` **relevance anchor** (or the
repo can require one on every passed AC) so a claimed commit must at least touch the area it claims;
see [Relevance](#relevance) below. Full semantic judgment ("is this commit really the right fix for
the right reason") is still the irreducible thing a deterministic checker can't make. It raises the
floor from "prose can lie" to "the proof must exist, be real, and land in the claimed area"; encode
stricter, project-specific grounding in the editable `preset.mts`.

---

# Setup

> **Prerequisites:** Node ≥ 22.18 (the installed preset is `.mts`, loaded via native type
> stripping, on by default from Node 22.18 / 23.6 / 24) and `git`. No database, no Python. The
> `ztrack visualizer` additionally needs [Bun](https://bun.sh). Verified under npm, pnpm, yarn
> (classic + Berry + PnP), and bun.

ztrack is a project dev-dependency — the installed preset imports the mechanism from it, exactly
like an eslint config imports its plugins (a global or one-off `npx` install is not enough):

```bash
npm install -D ztrack       # add ztrack to the project (the preset imports it)
npx ztrack init             # installs .volter/tracker/validation/preset.mts — real, editable rules
```

That's the whole setup for local verification. Three things you choose here:

**1. Local or linked.** The default is a **local tracker** — issues live as markdown in your repo,
committed alongside the code. To make your issues *be* GitHub Issues, synced both ways:

```bash
npx ztrack init --sync github --repo owner/name   # links + pulls existing issues; check/loop stay synced
```

**2. Your preset (the ruleset).** `ztrack init` installs the recommended **`simple-sdlc`** baseline.
See all presets with `ztrack init --list`; choose one with `--preset <name>`. The installed
`preset.mts` is real, editable code — open it and change the rules. (Reference: [Presets](docs/PRESETS.md).)

**3. The loop gate** — only needed for `ztrack loop` usage. Install the Stop/SubagentStop-hook
plugin once; it's **dormant unless a loop is armed**, so it's safe to leave enabled globally:

```bash
/plugin marketplace add volter-ai/ztrack     # in Claude Code
/plugin install ztrack-gate@ztrack
```

Not using Claude Code plugins? Wire the Stop and SubagentStop hooks yourself — see the
[Guide → drive an agent to green](docs/GUIDE.md#3-usage-drive-an-agent-to-green).

---

# Usage

**First decide where your work lives, then how you'll drive it** — two choices each, four doors:

| You have… | Do |
|---|---|
| **GitHub Issues already** | `npx ztrack init --sync github --repo owner/name` — your issues pull in and GitHub stays the source of truth ([linked sync](docs/GUIDE.md#how-linked-sync-works)) |
| **a pile of tasks, no tracker** | `npx ztrack init`, write the tasks down as you naturally would, then `npx ztrack import notes/tasks.md --register` materializes them into issues (or `issue create` one by one) ([importing](docs/GUIDE.md#importing-a-freeform-backlog)) |
| **one issue to finish** | `ztrack loop start <id> --until done` — the Stop-hook gate holds your agent's turn until the work is genuinely done ([drive to green](#drive-to-green--ztrack-loop)) |
| **a whole backlog to burn down** | groom → order → dispatch one loop-armed subagent per `issue list --actionable` row, wave by wave ([orchestrating a backlog](docs/GUIDE.md#orchestrating-a-whole-backlog-one-long-lived-session-many-issues)) |

Two patterns, **the same targets**. Pick by the job:

| | **`ztrack check`** | **`ztrack loop start`** |
|---|---|---|
| **does** | verifies once, exits `0`/`1` | a ralph loop — Stop/SubagentStop hooks hold every turn in the root (main agent and subagents alike) until the target is green, then disarm |
| **use for** | CI gate, pre-merge, a manual "is this real?" | driving an agent to actually finish — **recommended during development** |
| **bounds** | one run | capped iterations, with honest escapes; cooperative, not a sandbox |

Both take the same target — nothing, an id, a file, or the current branch's issue:

```bash
ztrack check                 # (nothing)     the whole tracker
ztrack check LOCAL-1         # <issue-id>    one issue
ztrack check ./body.md       # <file.md>     a loose markdown file, treated as an issue
ztrack check                 # (in a worktree named for an issue) → that issue, automatically

ztrack loop start LOCAL-1    # loop takes the exact same target grammar
```

A loose `./body.md` is checked for **structure + evidence** (the core promise); lifecycle/PR gates
(ready/in-review/done) apply only to **stored** issues, so a loose file is treated as a draft.

### Verify once — `ztrack check`

Install, init, author an acceptance criterion that claims done but cites a **fabricated** commit,
and watch ztrack catch it:

```bash
cat > body.md <<'EOF'
Assignee: me
Status: ready

## Acceptance Criteria

- [x] dev/01 v1 GET /health returns 200
  - status: passed
  - evidence ev1: commit=deadbeef acv=1
  - proof: "screenshot shows a 200 response" -> ev1
EOF
npx ztrack issue create --title "Add /health" --label type:case --state ready --assignee me --body-file body.md
npx ztrack check                     # ✗ the cited commit isn't in git
```

```text
✗ ztrack check failed     issues 1 • errors 1 • warnings 0

LOCAL-1
╰─  ✗ error  evidence_commit_not_found
   └─ Evidence ev1 cites commit deadbeef, which does not exist.

✗ exit 1 — the checkbox says done. the commit doesn't exist.
```

Now make it real — commit the work, cite a SHA that exists, re-import the body (the issue is stored
independently, so editing `body.md` alone isn't enough), and re-check:

```bash
git add -A && git commit -m "add /health endpoint"
SHA=$(git rev-parse HEAD)
sed "s/deadbeef/$SHA/" body.md > body.fixed.md          # cite a SHA that exists
npx ztrack issue edit LOCAL-1 --body-file body.fixed.md  # re-import the corrected body
npx ztrack check                                         # ✓ now it passes
```

That's the whole idea: a checked acceptance criterion must cite proof that actually exists.

### Drive to green — `ztrack loop`

The recommended development flow, in three steps:

**1. Install the gate once** — dormant unless a loop is armed, so it's safe to leave enabled (Claude
Code; non-plugin wiring is in the [Guide](docs/GUIDE.md#3-usage-drive-an-agent-to-green)):

```bash
/plugin marketplace add volter-ai/ztrack
/plugin install ztrack-gate@ztrack
```

**2. Arm a loop** on the issue you're working — two modes, same `start`:

```bash
ztrack loop start LOCAL-1                 # validate-current-stage: hold until LOCAL-1's CURRENT status passes check
ztrack loop start LOCAL-1 --until done    # drive-to-stage: hold until LOCAL-1's status reaches "done" (or later) AND passes check there
```

`--until <stage>` is for driving an issue somewhere it isn't yet — the stage is any value in the
active preset's status vocabulary (e.g. `ready`, `in-review`, `done`), validated at arm time (an
unknown stage fails loud, naming the real vocabulary). It's the difference between "is the current
stage real?" and "get this all the way to done" — without pre-flipping the issue to a stage that
isn't true yet just to make the oracle look at it. Flipping the status early doesn't cheat this:
that stage's own lifecycle gates (e.g. every AC passed before `in-review`) still have to pass for
real, so an early `--state done` with unpassed ACs stays red on its own. `--until` only makes
sense for a single issue (an id, or the bare/auto-resolved worktree issue) — a file or the whole
tracker has no one status to drive.

**3. Point your agent at the issue** — hand it the id (its working rules are in the
[agent playbook](docs/AGENT-PLAYBOOK.md)). When the agent — or a subagent it delegates to — tries
to stop, the Stop/SubagentStop hook runs `ztrack check`; if the issue is still red — or, under
`--until`, its status hasn't reached the target stage yet — the turn is held and the agent keeps
working — until the work is genuinely green (then the loop disarms), or it hits the iteration cap.

It's **cooperative**, not a sandbox: the agent can disarm (`ztrack loop stop`), self-exempt for a
session, or an authority can [waive](docs/PRESETS.md#waivers) a finding it knowingly accepts — so it
never grinds forever on something it can't satisfy honestly.

```bash
ztrack loop status            # is a loop armed? capped?
ztrack loop stop              # disarm
```

You set the target; the loop holds the standard.

**Driving a whole backlog** (not just one issue) is the same loop, dispatched wave by wave:
`ztrack issue list --actionable` names every not-done, unblocked issue — the dispatch frontier — and
`--blocked` names what's stalling the rest. See [Guide → Orchestrating a whole
backlog](docs/GUIDE.md#orchestrating-a-whole-backlog-one-long-lived-session-many-issues) for the full
intake → groom → order → dispatch flow.

## When the checker is wrong

`ztrack check` is deterministic, but deterministic isn't the same as always right for your repo — a
legacy AC that predates evidence discipline, or a finding that genuinely doesn't apply. The sanctioned
override is a **waiver**, signed by a human (or an agent acting under one), not editing the check's
output or disabling a rule globally:

```bash
ztrack waiver sign <issue> --code <finding-code> [--ac <acId>] [--ref <subject>] --reason "..."
ztrack waiver status <issue>
ztrack waiver clear <issue> [--code <finding-code>]
```

A waiver lives in the issue body's `## Waivers` section, one line per waiver — pinned to the single
offending occurrence, `// eslint-disable-next-line` style:

```
- code: evidence_commit_not_found ac: dev/01 ref: cafebabe… reason: repo predates the import by: Jane Doe (jane@co.com)
```

`sign` downgrades the matching finding from `error` to `acknowledged` — `check` still reports it, but
exits `0`. The `ref:` pin (auto-captured by `sign` when the finding is unambiguous; pass `--ref
<subject>` yourself when it isn't) scopes the waiver to ONE occurrence — the offending value, e.g. a
commit SHA — so it self-expires the moment that occurrence changes instead of silencing the rule
forever. Sign-off is captured automatically from your git identity (`git config user.name` /
`user.email`); you can't waive anonymously. Hygiene is enforced in every direction: an unreasoned or
unsigned waiver is itself an error (`waiver_missing_reason`, `waiver_missing_signoff`); an unpinned
waiver that could pin is flagged `waiver_overbroad` (`ztrack waiver migrate` rewrites legacy broad
rows into per-occurrence pins); and a waiver that stops matching anything is flagged `waiver_unused`
(a warning, not blocking) so a stale waiver doesn't silently keep suppressing forever.

Prefer fixing the issue; waive only a finding you knowingly accept. Full grammar in
[Presets → Waivers](docs/PRESETS.md#waivers).

## Relevance

By default `ztrack check` verifies that cited evidence *exists and is real* — not that it's *about*
the claimed work. An acceptance criterion can opt in to a **relevance anchor**: a `paths:` glob
declaring the repo area it concerns. Once declared, a passed AC's cited commit(s) must touch at least
one of those paths, or the claim is rejected:

```markdown
- [x] dev/01 v1 GET /health returns 200
  - status: passed
  - paths: src/**
  - evidence ev1: commit=<sha> acv=1
  - proof: "the commit adds the health endpoint" -> ev1
```

A commit that only touches `docs/` here fails with `evidence_commit_unrelated`; one that touches a
`src/` file passes. `paths:` accepts globs (`*` within a segment, `**` across segments, literal
files/dirs, comma-separated lists) and is satisfied by ANY cited commit touching ANY declared path.

`paths:` is opt-in — a passed AC that omits it is never relevance-checked (existing repos are
unaffected). Set `"relevance": "required"` in `.volter/tracker-config.json` to make it mandatory:
every passed AC must then declare `paths:`, or `passed_ac_missing_paths` fires. This is still not full
semantic judgment (a commit that touches the right files for the wrong reason still passes) — it's a
deterministic floor: the cited proof must at least be **in** the area it claims to fix.

---

## How it works

ztrack is a verification layer, not a new tracker. It reads tasks from your work system (or a
committed validated root), parses them into one strict multi-issue root through a Zod schema,
gathers git/world facts into a typed context, and runs pure rules over it — exiting non-zero when a
checked claim isn't backed by real proof. CI, MCP, or an agent Stop hook can block on that exit.

Keep **Linear**, **Jira**, or **GitHub Issues** as the human surface; ztrack sits next to them and
validates the claims agents or humans make there. Two-way sync with GitHub Issues is built in (a
synced issue *is* the GitHub issue) — see the [Guide → linked sync](docs/GUIDE.md#how-linked-sync-works).

## One document, many issues

Your existing plan or backlog markdown can *be* the tracker. Declare it as a `document` source and
every heading whose text starts with an id (`APP-1 — Add the /health endpoint`) becomes an issue —
no reformatting, no separate store to keep in sync:

```bash
cat > PLAN.md <<'EOF'
## APP-1 — Add the /health endpoint

status: ready
assignee: me

### Acceptance Criteria

- [ ] dev/01 v1 GET /health returns 200
  - status: pending
EOF
```

```jsonc
// .volter/tracker-config.json
{ "sources": [{ "path": ".volter/tracker/markdown" }, { "path": "PLAN.md", "format": "document" }] }
```

```bash
npx ztrack issue list --json identifier,title   # -> APP-1  Add the /health endpoint
npx ztrack check                                # reads PLAN.md like any other store
```

`ac patch`/`issue edit` splice a verified change straight back into the doc at the heading's
recorded span — patching `dev/01` above changes only its checkbox and status/evidence/proof lines;
every other byte in `PLAN.md` is untouched. State, assignee, and anything wider than title/body
still fail closed, naming the file to edit directly instead. With 2+ declared sources,
`--source <name>` scopes `issue list` and `check` to one or more of them (repeatable AND
comma-separated, on both commands). Grammar, the write model, scoping, and diagnostics:
[Sources](docs/SOURCES.md).

Already have a messier backlog — headings, prose, checkboxes, no id tokens? `ztrack import` (accepts
a file, a directory, or a quoted glob) materializes it into that same grammar **in place**,
idempotently: `ztrack import notes/backlog.md --dry-run` previews the plan, plain `ztrack import`
writes it, `--register` declares the result as a source. Pre-checked `[x]` items import unchecked
with a preserved-claim marker (a checked-but-unproven claim is exactly what `check` rejects); an
`Acceptance Criteria` or `Waivers` section is recognized document-source structure and is never
turned into an issue, so waiver rows survive untouched — see
[Sources → Importing a freeform backlog](docs/SOURCES.md#importing-a-freeform-backlog).

## Agent workflows

ztrack is built to be an AI agent's **completion oracle** — three ways to wire it, smallest to most
autonomous:

- **CI gate:** the `volter-ai/ztrack@v1` Action over a committed validated root (or `npx ztrack check --phase gate`) — full recipe, including linked mode, in the [Guide → gate it in CI](docs/GUIDE.md#gate-it-in-ci).
- **MCP:** `claude mcp add ztrack -- npx ztrack mcp serve` — the agent calls `tracker_check` before finishing.
- **Autonomy loop:** the [`ztrack loop`](#drive-to-green--ztrack-loop) Stop-hook gate above — the recommended development flow.

Full setup (MCP tools, the loop, the Stop-hook `settings.json`) is in the
[Guide → drive an agent to green](docs/GUIDE.md#3-usage-drive-an-agent-to-green); the copy-paste agent
adoption prompt is in the [agent playbook](docs/AGENT-PLAYBOOK.md).

## Presets

`ztrack init --preset <name>` installs one editable, **standalone** preset — its own schema, parser,
and rules, importing only `ztrack/preset-kit`:

| Preset | Use when |
|---|---|
| `simple-sdlc` | a dev lifecycle (draft→ready→in-progress→in-review→done) with commit+proof evidence — **PR-free**, runs locally. The recommended baseline; `default` is an alias for it |
| `simple-gh-sdlc` | the same, **plus** a GitHub PR at in-review and a merged PR for done |
| `spec` | issue bodies are specs whose ACs cite commit-backed evidence |
| `speckit` | GitHub Spec Kit style feature records (user stories, tasks, phases) |

`ztrack init --list` shows every preset; [Presets](docs/PRESETS.md) documents the exact gates and how
to add your own rule.

## Visualize

For a read-only web view of the tracker — issues, acceptance-criteria progress, findings, and
audit-derived timestamps — run the visualizer (requires [Bun](https://bun.sh)):

```bash
ztrack visualizer                 # the active preset, http://localhost:3300
ztrack viz --preset speckit --port 4000
```

It validates the live tracker on each request through the same core as `check`, so the board never
drifts from what CI enforces.

## Why believe it

ztrack runs our own autonomous agent fleet in production — it's what we use to ship real code. Every
release re-proves in CI that a fabricated commit SHA fails the check.

**Stability & dependencies (be honest before adopting).** Since 1.0.0 ztrack follows semver
proper: the CLI flag surface, the package-root API, and the bundled preset contracts break only at
a **major** version — minor and patch releases are safe to take. Still read the
[CHANGELOG](CHANGELOG.md) before upgrading across a major. The deterministic **local** core
(check, evidence, presets) depends only on the markdown store and git, and needs nothing beyond
`ztrack` itself. **GitHub two-way sync** and **world-backed evidence** route through `@volter-ai-dev/twin` (same publisher) — since 0.38.0 that's an **optional
peer dependency**, not a regular one: adopt only local verification and nothing extra installs or
runs; adopt sync and you must `npm install -D @volter-ai-dev/twin @volter-ai-dev/twin-github`
yourself, and run the sync command under **bun** (not npx/node) — see the [canonical
recipe](docs/GUIDE.md#github-sync-since-038-install-the-peers-run-under-bun).

## How it compares

| | Records claim | Validates structure | Verifies evidence of "done" |
|---|:---:|:---:|:---:|
| Linear / Jira | ✓ | shape only | — |
| Beads / Backlog.md | ✓ | partial | — |
| spec-kit / OpenSpec | ✓ | ✓ (prose shape) | — |
| Eval / observability | ephemeral | — | scores outputs |
| **ztrack** | ✓ | ✓ | ✓ |

## Managed setup

The open-source core is free to self-host and run locally. Teams that want help wiring ztrack into an
existing tracker, CI, MCP, and the agent Stop-hook loop can apply for
[Startup Pilot](https://ztrack.dev/startup-pilot.html). No payment is collected until we confirm a
good fit.

## Community and support

- Questions and bugs: open a GitHub issue with the matching template.
- Feature ideas: include the workflow problem and the evidence you want ztrack to verify.
- Managed setup: use the [Startup Pilot](https://ztrack.dev/startup-pilot.html) form.
- Security reports: use GitHub Security Advisories; do not open public security issues.

## Documentation

The README is the front door; these go deep:

- **[Guide](docs/GUIDE.md)** — setup, the two usage patterns, CI gate, agent enforcement, visualize.
- **[Presets](docs/PRESETS.md)** — choose and customize the ruleset; the grammar; add a rule; build your own preset; `preset upgrade`.
- **[Sources](docs/SOURCES.md)** — declare where issues live; the document format (one file, many issues); write-back and diagnostics.
- **[Evidence](docs/EVIDENCE.md)** — cite, store, and verify proof; in-toto + DSSE attestation.
- **[Agent playbook](docs/AGENT-PLAYBOOK.md)** — the copy-paste prompt for an agent adopting and driving ztrack.
- **[Programmatic API](docs/API.md)** · **[Architecture](ARCHITECTURE.md)** · **[Visualizer](visualizer/README.md)**
- **[Roadmap](ROADMAP.md)** · **[Contributing](CONTRIBUTING.md)** · **[Security](SECURITY.md)** · **[Changelog](CHANGELOG.md)**

## License

[Apache-2.0](LICENSE)
