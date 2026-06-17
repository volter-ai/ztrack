# Adopting ztrack

This guide is written for a person or AI agent adding ztrack to an existing
repository with no prior project context.

ztrack is not a replacement for GitHub Issues, Linear, Jira, or a planning
system. It is a local verification layer: checked task claims must cite evidence
that ztrack can resolve.

## Mental Model

| Piece | Owns |
|---|---|
| Your tracker | Human planning, discussion, assignment, prioritization |
| ztrack store | Local mirror of work items and issue bodies |
| Installed preset | The repo-local shape and rules for "done" |
| `ztrack check` | Deterministic verification of checked claims |
| CI / MCP / stop-hook | Where failures block agents or pull requests |

Start with `basic` unless the repo already has written workflow rules that map
cleanly to `simple-sdlc`, `simple-spec`, or `speckit`.

## Agent Shortcut

If an AI coding agent is doing the adoption, point it at this guide and
[the agent playbook](AGENT-PLAYBOOK.md). A minimal prompt is:

```text
Adopt ztrack in this repository. Read the ztrack README, docs/ADOPTING.md,
docs/AGENT-PLAYBOOK.md, and docs/PRESETS.md first. Choose one install preset
from basic, simple-sdlc, simple-spec, or speckit based on the repo's existing
workflow. Prove one fake-SHA failure and one real-SHA pass, then run ztrack
check before finishing.
```

For repos that should immediately run with a PM/develop/review operating
profile, use the setup command:

```bash
npx -p ztrack ztrack-setup --repo /path/to/repo --team APP --preset simple-sdlc --profile simple-sdlc
```

## 1. Install

```bash
npx ztrack init --team APP --preset basic
npx ztrack issue scaffold --title "First verified task" > body.md
npx ztrack issue create \
  --title "First verified task" \
  --label type:case \
  --state "In Progress" \
  --assignee "$USER" \
  --body-file body.md
npx ztrack check
```

The setup writes `.volter/tracker-config.json`, creates local tracker state
under `.volter/tracker/`, and installs editable validation at
`.volter/tracker/validation/preset.cjs`.

Prerequisites: Node/npm for `npx`, Python 3 on `PATH` for the local store, and a
git repository. Commit verification can only see commits fetched into the local
checkout.

Use a stricter starter when the repo already has that shape:

```bash
npx ztrack init --team APP --preset simple-sdlc
npx ztrack init --team APP --preset simple-spec
npx ztrack init --team APP --preset speckit
```

## 2. Make The First Failure Intentional

Do not start by wiring every workflow rule. First prove the core gate catches a
bad claim:

1. Create or choose a real git commit.
2. Edit one acceptance criterion from unchecked to checked.
3. Cite a fake commit such as `commit: deadbee` and an evidence id such as
   `[E1]`.
4. Add an `[E1]` row in `## Evidence`.
5. Run `npx ztrack check`.

Expected with `basic`: `basic_checked_ac_commit_hash_missing` and exit code `1`.

Then replace the fake SHA with a real commit SHA reachable in the repository.
Expected: exit code `0`.

The temporary files used during this proof, such as `body.md`, `red.json`, and
`green.json`, do not need to be committed unless your project wants to keep them
as fixtures. Commit the ztrack config, installed validation preset, and CI
snapshot instead.

From this repository, the same loop is executable:

```bash
bash demos/local-red-green.sh
```

## 3. Decide What ztrack Should Verify

Write this down before editing the installed preset:

| Question | Example Answer |
|---|---|
| What work item types are real cases? | `type:case`, `type:bug`, `type:feature` |
| What states exist? | `backlog`, `ready`, `in-progress`, `in-review`, `done`, `canceled` |
| What acceptance criterion families exist? | `dev/NN`, `case/NN`, `proc/NN` |
| What proves a checked AC? | commit + PR evidence, screenshot, video, approval |
| Which rules run only on state changes? | section template, approval chain, readiness gates |
| Which rules run on every check? | commit existence, evidence refs, source refs |
| What external systems are source material? | GitHub, Jira, Linear, Slack, docs |

If the answer is only "checked ACs need commit + evidence", keep `basic`. If the
answer includes workflow-specific states, AC families, source grounding, or
approval chains, evolve the installed entrypoint into the project's rulebook.

## 4. Add CI

For CI, prefer a committed snapshot because a fresh CI checkout does not contain
your local SQLite store. Commit the config and installed validation too; the
snapshot points at that rulebook.

```bash
npx ztrack snapshot export --out .volter/snapshot.json
git add .volter/tracker-config.json .volter/tracker/validation/preset.cjs .volter/snapshot.json
```

Then use the action:

```yaml
name: ztrack

on:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: volter-ai/ztrack@v0
        with:
          snapshot: .volter/snapshot.json
```

## 5. Add Agent Enforcement

For MCP-capable agents:

```bash
claude mcp add ztrack -- npx ztrack mcp serve
```

Agent instruction:

```text
Before you finish, call tracker_check. If it is invalid, resolve the findings by
producing real evidence or unchecking unsupported claims. Do not mark an
acceptance criterion passed unless ztrack check is green.
```

For non-MCP agents, run `npx ztrack check` in a stop-hook or final validation
command and treat non-zero exit as incomplete work.

## 6. Evolve The Installed Preset

The installed preset is the customization point. Edit
`.volter/tracker/validation/preset.cjs` when your team needs ztrack to know
project-specific truth, for example:

- `done` requires every `dev/NN`, `case/NN`, and `proc/NN` AC to pass.
- A checked UI AC requires screenshot or video evidence, not only a commit.
- Source requirements must trace to Jira, Linear, Slack, or GitHub annotations.
- Sub-issues or blockers must reconcile with parent issues.
- Approval evidence must be fresh against the current AC text and branch head.

Read [Preset Reference](PRESETS.md) before changing the rulebook.

## Agent Adoption Checklist

- [ ] Run `npx ztrack init --team <KEY> --preset <basic|simple-sdlc|simple-spec|speckit>`.
- [ ] Create one issue from `ztrack issue scaffold`.
- [ ] Run `ztrack check` before changing workflow rules.
- [ ] Demonstrate one fake-SHA failure and one real-SHA pass.
- [ ] Add a CI snapshot gate.
- [ ] Add MCP or a stop-hook instruction requiring `tracker_check`.
- [ ] Edit `.volter/tracker/validation/preset.cjs` only after writing the workflow contract.
- [ ] Add clean and failing fixtures for every project-specific rule.
- [ ] Keep subjective guidance in `ztrack lint`; keep `ztrack check`
  deterministic.
