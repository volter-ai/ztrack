<h1 align="center">ztrack</h1>

<p align="center"><strong>Typecheck and lint your task management.</strong> Done is earned, not declared.</p>

<p align="center">
  <a href="https://github.com/volter-ai/ztrack/actions/workflows/ci.yml"><img src="https://github.com/volter-ai/ztrack/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.npmjs.com/package/ztrack"><img src="https://img.shields.io/npm/v/ztrack.svg" alt="npm"></a>
  <a href="https://www.npmjs.com/package/ztrack"><img src="https://img.shields.io/npm/dm/ztrack.svg" alt="npm downloads"></a>
  <a href="https://github.com/volter-ai/ztrack/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/telemetry-none-brightgreen.svg" alt="no telemetry">
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> ·
  <a href="docs/ADOPTING.md"><strong>Adopt</strong></a> ·
  <a href="docs/EXAMPLES.md"><strong>Examples</strong></a> ·
  <a href="docs/COOKBOOKS.md"><strong>Cookbooks</strong></a> ·
  <a href="#agent-workflows"><strong>Agent workflows</strong></a> ·
  <a href="#community-and-support"><strong>Support</strong></a> ·
  <a href="https://ztrack.dev/startup-pilot.html"><strong>Startup Pilot</strong></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/volter-ai/ztrack/main/docs/demo.gif" alt="ztrack check: cite a real commit -> green; fake SHA -> exit 1" width="680"></p>

AI coding agents close tickets on prose. "All tests pass, feature complete" — and the
commit it cited never existed. Your tracker stored the claim with perfect fidelity and
verified nothing.

**ztrack is a typechecker for your issue tracker.** With the installed presets,
a checked acceptance criterion must cite a commit SHA that exists in git plus the
evidence and proof the preset requires. Teams can extend the installed preset to
validate PRs, screenshots, videos, approvals, and source systems.

## What ztrack catches

| Claim in the tracker | What ztrack verifies |
|---|---|
| "Implemented in commit `a1b2c3d`" | the SHA exists in the local git object database |
| "This acceptance criterion is passed" | it cites evidence captured at a real commit, against the current AC version |
| "This evidence proves it" | the AC carries a `proof:` that names the evidence it relies on |
| "This ticket is ready/done" | the installed preset's lifecycle gates (PR exists/merged, every AC passed) hold |

Lint errors are fixed by editing text. Type errors are fixed by producing evidence.

**What it does _not_ verify** (be honest with your team): the default preset checks that the
cited commit **exists** in git — not that it is *relevant* to the criterion (an unrelated real
SHA passes), and not that a referenced screenshot file exists on disk (image paths are
structural strings unless your preset resolves them). It raises the floor from "prose can lie"
to "the proof must exist and be real"; encode stricter, project-specific grounding (source
checks, file resolution, PR metadata) in the editable `preset.mts`.

## Quickstart

> **Prerequisites:** Node ≥ 24 (the installed preset is `.mts`, loaded via native type
> stripping — so an older Node will not run it) and `git`. That's it — no database, no Python.
> The `ztrack visualizer` additionally needs [Bun](https://bun.sh).

Like `eslint --init` then `eslint`, you install a preset (your ruleset) and then check
against it. ztrack is a project dev-dependency (the installed preset imports the mechanism
from it, exactly like an eslint config imports its plugins — so a global or one-off `npx`
install is not enough). Install one, create an issue whose acceptance criterion is marked
done but cites a **fabricated** commit, and watch ztrack catch it:

```bash
npm install -D ztrack                # add ztrack to the project (the preset imports it)

npx ztrack init --preset default     # installs .volter/tracker/validation/preset.mts — real, editable code

cat > body.md <<'EOF'
Assignee: me
Status: ready

## Acceptance Criteria

- [x] dev/01 v1 GET /health returns 200
  - status: passed
  - evidence ev1: image=health.png commit=deadbeef acv=1
  - proof: "screenshot shows a 200 response" -> ev1
EOF
npx ztrack issue create --title "Add /health" --label type:case --state ready --assignee me --body-file body.md
npx ztrack check                     # ✗ the cited commit isn't in git (verified by default)
```

```text
✗ ztrack check failed     issues 1 • errors 1 • warnings 0

LOCAL-1
╰─  ✗ error  evidence_commit_not_found
   └─ Evidence ev1 cites commit deadbeef, which does not exist.

✗ exit 1 — the checkbox says done. the commit doesn't exist.
```

Now make it real: commit the work, cite a SHA that actually exists, and re-import the
corrected body (the issue is stored independently, so editing `body.md` alone isn't enough —
`issue edit` re-imports it):

```bash
git add -A && git commit -m "add /health endpoint"   # a real commit to cite
SHA=$(git rev-parse HEAD)
cat > body.md <<EOF
Assignee: me
Status: ready

## Acceptance Criteria

- [x] dev/01 v1 GET /health returns 200
  - status: passed
  - evidence ev1: image=health.png commit=$SHA acv=1
  - proof: "screenshot shows a 200 response" -> ev1
EOF
npx ztrack issue edit LOCAL-1 --body-file body.md    # re-import the corrected body
npx ztrack check                                     # ✓ now it passes
```

That's the whole idea: a checked acceptance criterion must cite proof that actually
exists. The installed `preset.mts` is real, editable code — open it and change the rules.

> **Package managers:** verified on Node 24+ under **npm, pnpm, yarn (classic + Berry +
> PnP), and bun**. The pure-JS store needs no subprocess, so Yarn PnP works with no
> extra configuration.

### Two ways to start

```bash
# A) Local tracker — author and verify work locally
npx ztrack init
npx ztrack issue scaffold --title "Add /health" > issue.md   # a starter body you fill in
npx ztrack issue create --title "Add /health" --label type:case --state draft --assignee me --body-file issue.md
npx ztrack check                                             # ✓ passes — now fill in the AC + evidence

# B) Linked to GitHub Issues — your issues ARE the GitHub issues, synced both ways
npx ztrack init --sync github --repo owner/name   # links + pulls existing issues
npx ztrack check                                   # verifies; reconciles with GitHub around it
```

Either way, **`check` and `loop` are how you use it**, over one target:

```bash
ztrack check                 # the whole tracker
ztrack check LOCAL-1         # one issue
ztrack check ./body.md       # a loose markdown file, as an issue
ztrack check                 # inside a worktree → auto-scopes to the branch's issue
ztrack loop start LOCAL-1    # a ralph loop: the Stop hook holds the turn until LOCAL-1 is green
```

## Adopt it into your repo

For the full adoption path — a CI gate, a committed validated root, MCP, and the agent
stop-hook loop — see [Adopting ztrack](docs/ADOPTING.md).

## How it works

ztrack is a verification layer, not a new tracker.

1. Read tasks from your existing work system or a committed validated root.
2. Parse the tracker into one strict, multi-issue root through a Zod schema.
3. The loader gathers git/world facts into a typed context; pure rules validate the typed root.
4. Exit non-zero when a checked claim is not backed by real proof.
5. Let CI, MCP, or an agent stop-hook block the workflow until the evidence exists.

## Works with your tracker

Keep **Linear**, **Jira**, or **GitHub Issues** as the human surface. ztrack sits next to
them and only validates the claims agents or humans make there.

| Surface | Role |
|---|---|
| Linear / Jira / GitHub Issues | where people plan, review, and discuss work |
| ztrack CLI | local and CI verification |
| ztrack MCP | agent-facing task/evidence loop |
| ztrack visualizer | local web view of issues, acceptance criteria, and findings |
| GitHub Action | repository gate with `uses: volter-ai/ztrack@v0` |

Two-way sync with GitHub Issues is built in — a synced issue *is* the GitHub issue. Link it
once at init and it stays synced, or sync on demand:

```bash
ztrack init --sync github --repo owner/name # link permanently (then `check`/`loop` stay synced)
ztrack sync github                          # pull then push the linked repo (no --repo needed)
ztrack sync github --repo owner/name --pull # or an explicit repo, one direction
```

It syncs through the [twin](#how-it-works) (delta folds + an egress idempotency ledger), so it
never does a full re-read/re-write. Auth uses the `gh` CLI or `GITHUB_TOKEN`.

What a linked team should know:

- **GitHub is the source of truth.** In linked mode ztrack **gitignores** the local issue store
  (`.volter/tracker/markdown/`) — your issues live on GitHub, not in your repo. (In *local* mode
  that store is committed instead.) Re-clones repopulate it on the next `ztrack sync github`.
- **Push vs pull.** `sync github` pulls GitHub's issues, then pushes your local edits back — a
  three-way merge (a committed base vs. your tracker vs. GitHub) reconciles field by field, so
  non-overlapping edits on each side both land.
- **Conflicts gate the check.** When the *same field* changed on both sides, ztrack raises an
  unwaivable `sync_conflict` finding (so `check` fails until you resolve it) and writes a
  local-only `## Conflicts` block into the issue body. Resolve by editing and re-syncing, or pick
  a policy: `--policy hub-wins | twin-wins | merge` (default `merge`), settable on `sync`/`init`
  or as `sync.policy` in the tracker config.

`ztrack check` (and `ztrack loop start`, the ralph loop) take the same target: nothing for the
whole tracker, an **issue id** (`ztrack check ZT-1`), a **file** (`ztrack check ./body.md`), or —
inside a worktree named for an issue — that issue automatically.

## Agent workflows

- **MCP:** `claude mcp add ztrack -- npx ztrack mcp serve`
- **CI gate:** run `npx ztrack check` in your pipeline, or use `volter-ai/ztrack@v0`
- **Autonomy loop:** a ralph-pattern loop whose completion oracle is `check` — `ztrack loop start <issue>` holds the agent's turn until that issue is green (then disarms), capped so it can't grind forever. Three honest escapes (none fakes "done"): disarm, a per-session self-exempt that can't outlive the session, and a durable `ztrack waiver sign` (signed off as your git identity, anchored to the acceptance-criteria fingerprint) that auto-stales when those criteria change — or just descope the AC when it's genuinely out of scope. Turn it on via the bundled Claude Code plugin (one toggle, armed-only so interactive work is untouched):

  ```
  /plugin marketplace add volter-ai/ztrack
  /plugin install ztrack-gate@ztrack
  ```
  See [plugins/ztrack-gate](plugins/ztrack-gate). For non-plugin / dual-harness setups, wire `hooks/stop-loop.sh` into your `Stop` hooks directly.

See [examples](docs/EXAMPLES.md) for a minimal local check, a committed validated-root
CI gate, and an MCP agent loop.

## Visualize

For a read-only web view of the tracker — issues, acceptance-criteria progress,
findings, and audit-derived timestamps — run the visualizer (requires
[Bun](https://bun.sh)):

```bash
ztrack visualizer                 # default preset, http://localhost:3300
ztrack viz --preset speckit --port 4000
```

It validates the live tracker on each request through the same core as `check`,
so the board never drifts from what CI enforces.

If you are adding ztrack to an existing repository, start with
[Adopting ztrack](docs/ADOPTING.md). If an AI agent is doing the setup, give it
[the agent playbook](docs/AGENT-PLAYBOOK.md).

## Install presets

`ztrack init --preset <name>` installs one editable, **standalone** preset into the
target repo: `.volter/tracker/validation/preset.mts` — its own schema, parser, and rules,
importing only `ztrack/preset-kit`. Edit it freely.

| Preset | Use When |
|---|---|
| `default` | a dev lifecycle (draft→ready→in-progress→in-review→done) with commit + image evidence and proof |
| `spec` | issue bodies are specs whose ACs cite commit-backed evidence |
| `speckit` | GitHub Spec Kit style feature records (user stories, tasks, phases) |

See [Preset reference](docs/PRESETS.md) for the exact gates.

## Project-specific rigor

The installed preset is intentionally editable. Start with commit plus evidence
row checks, then encode project-specific rules in
`.volter/tracker/validation/preset.mts`: source grounding, section gates,
approval requirements, PR metadata, screenshot files, video evidence, or external
world/source checks.

## Why believe it

ztrack runs our own autonomous agent fleet in production — it's what we use to ship real
code. Every release re-proves in CI that a fabricated commit SHA fails the check.

Current status: ztrack is pre-beta and has been battle-tested first on our own production
workflow. The deterministic core is general, but new tracker conventions may expose rough
edges. Please open issues with the smallest workflow shape that breaks.

## How it compares

| | Records claim | Validates structure | Verifies evidence of "done" |
|---|:---:|:---:|:---:|
| Linear / Jira | ✓ | shape only | — |
| Beads / Backlog.md | ✓ | partial | — |
| spec-kit / OpenSpec | ✓ | ✓ (prose shape) | — |
| Eval / observability | ephemeral | — | scores outputs |
| **ztrack** | ✓ | ✓ | ✓ |

## Managed setup

The open-source core is free to self-host and run locally. Teams that want help wiring
ztrack into an existing tracker, CI, MCP, and agent stop-hook workflow can apply for
[Startup Pilot](https://ztrack.dev/startup-pilot.html). No payment is collected until we
confirm there is a good fit.

## Community and support

- Questions and bugs: open a GitHub issue with the matching template.
- Feature ideas: include the workflow problem and the evidence you want ztrack to verify.
- Managed setup: use the [Startup Pilot](https://ztrack.dev/startup-pilot.html) form.
- Security reports: use GitHub Security Advisories; do not open public security issues.

## Documentation

- [Docs index](docs/README.md)
- [Examples](docs/EXAMPLES.md)
- [Adopting ztrack](docs/ADOPTING.md)
- [Cookbooks](docs/COOKBOOKS.md)
- [Visualizer](visualizer/README.md) — local web view of tracker state
- [Preset reference](docs/PRESETS.md)
- [AI agent playbook](docs/AGENT-PLAYBOOK.md)
- [World integration](docs/WORLD-INTEGRATION.md) — advanced source-backed validation boundary
- [Architecture](ARCHITECTURE.md)
- [Maintainer preset guide](PRESET-GUIDE.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Releasing](docs/RELEASING.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

## License

[Apache-2.0](LICENSE)
