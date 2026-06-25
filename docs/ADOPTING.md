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

Start with `default` unless the repo already has written workflow rules that map
cleanly to the lighter `spec`, or to `speckit`.

## Agent Shortcut

If an AI coding agent is doing the adoption, point it at this guide and
[the agent playbook](AGENT-PLAYBOOK.md). A minimal prompt is:

```text
Adopt ztrack in this repository. Read the ztrack README, docs/ADOPTING.md,
docs/AGENT-PLAYBOOK.md, and docs/PRESETS.md first. Choose one install preset
from default, spec, or speckit based on the repo's existing workflow. Prove one
fake-SHA failure and one real-SHA pass, then run ztrack check before finishing.
```

## 1. Install

```bash
npx ztrack init --team APP --preset simple-sdlc
npx ztrack issue scaffold --title "First verified task" > body.md
npx ztrack issue create \
  --title "First verified task" \
  --label type:case \
  --state ready \
  --assignee "$USER" \
  --body-file body.md
npx ztrack check
```

The setup writes `.volter/tracker-config.json`, creates local tracker state
under `.volter/tracker/`, and installs the editable, standalone preset at
`.volter/tracker/validation/preset.mts`.

Prerequisites: Node ≥ 22.18 for `npx` and a git repository — the issue store is
plain markdown files (pure JS, no database). Commit verification can only see
commits fetched into the local checkout.

Use a different starter when the repo already has that shape:

```bash
npx ztrack init --team APP --preset spec
npx ztrack init --team APP --preset speckit
```

## 2. Make The First Failure Intentional

Do not start by wiring every workflow rule. First prove the core gate catches a
bad claim:

1. Create or choose a real git commit.
2. Edit one acceptance criterion from unchecked to passed (`[x]` + `status:
   passed`).
3. Cite a fake commit in its evidence sub-line, such as
   `evidence ev1: commit=deadbee acv=1`, plus a `proof:` line.
4. Run `npx ztrack check`.

Expected with `default`: `evidence_commit_not_found` and exit code `1`.

Then replace the fake SHA with a real commit SHA reachable in the repository.
Expected: exit code `0`.

The temporary files used during this proof, such as `body.md`, `red.json`, and
`green.json`, do not need to be committed unless your project wants to keep them
as fixtures. Commit the ztrack config, the installed `preset.mts`, and the CI
validated root instead.

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

If the answer is only "passed ACs need commit-backed evidence", the lighter
`spec` preset may be enough. If the answer includes workflow-specific states, AC
families, source grounding, or approval chains, start from `default` and evolve
the installed entrypoint into the project's rulebook.

## 4. Add CI

For CI, prefer a committed validated root because a fresh CI checkout does not
contain your local (gitignored) markdown store. Commit the config and installed
validation too; the validated root is checked against that rulebook.

```bash
npx ztrack export --out .volter/root.json
git add .volter/tracker-config.json .volter/tracker/validation/preset.mts .volter/root.json
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
          root: .volter/root.json
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
`.volter/tracker/validation/preset.mts` when your team needs ztrack to know
project-specific truth, for example:

- `done` requires every `dev/NN`, `case/NN`, and `proc/NN` AC to pass.
- A checked UI AC requires screenshot or video evidence, not only a commit.
- Source requirements must trace to Jira, Linear, Slack, or GitHub annotations.
- Sub-issues or blockers must reconcile with parent issues.
- Approval evidence must be fresh against the current AC text and branch head.

Read [Preset Reference](PRESETS.md) before changing the rulebook.

## Agent Adoption Checklist

- [ ] Run `npx ztrack init --team <KEY> --preset <name>`.
- [ ] Create one issue from `ztrack issue scaffold`.
- [ ] Run `ztrack check` before changing workflow rules.
- [ ] Demonstrate one fake-SHA failure and one real-SHA pass.
- [ ] Add a CI validated-root gate.
- [ ] Add MCP or a stop-hook instruction requiring `tracker_check`.
- [ ] Edit `.volter/tracker/validation/preset.mts` only after writing the workflow contract.
- [ ] Add clean and failing fixtures for every project-specific rule.
- [ ] Keep subjective guidance in `ztrack lint`; keep `ztrack check`
  deterministic.
