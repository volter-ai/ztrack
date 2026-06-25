# Examples

## Minimal Local Check

```bash
npx ztrack init --team APP
npx ztrack issue scaffold --title "Protect API endpoint" > body.md
npx ztrack issue create --title "Protect API endpoint" --label type:case --state "In Progress" --assignee "$USER" --body-file body.md
npx ztrack issue list
npx ztrack check
```

With the `simple-sdlc` preset, a passed acceptance criterion needs commit-backed
evidence that can be verified against git, plus a proof naming that evidence (an
image is optional, and verified at its commit when cited — see
[Evidence](EVIDENCE.md)). A fake commit SHA is a hard type error, not a warning.

## CI Validated-Root Gate

For CI, prefer a committed validated root. A fresh CI checkout does not preserve
your local tracker store. Commit the config and installed validation with the
validated root.

```bash
npx ztrack export --out .volter/root.json
git add .volter/tracker-config.json .volter/tracker/validation/preset.mts .volter/root.json
```

Then gate the validated root in GitHub Actions:

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

### Phases: full vs continuous gate

`ztrack check` runs every rule by default (`--phase all`) — including the structure/readiness
transition rules. For an **ongoing PR gate** you usually want only the continuous rules (skip the
promotion/transition checks on already-landed issues):

```bash
npx ztrack check --phase gate
```

Use `--phase all` for the strict validation at a promotion boundary; `--phase gate` for the
lightweight check that runs on every push.

### CI gate for a GitHub-linked tracker

In linked mode your issues live on GitHub (the local store is gitignored), so there is no committed
`root.json` to gate. Pull the linked issues first, then check — as raw steps (the `volter-ai/ztrack`
Action gates a committed root; it does not sync):

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}   # auth for sync; no PAT prompt
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: npx ztrack sync github --pull        # repo/policy come from the init link
      - run: npx ztrack check --phase gate
```

`sync github --pull` repopulates the local cache from GitHub; auth uses the `gh` CLI or
`GITHUB_TOKEN` (never a prompted PAT). A `sync_conflict` (same field edited on both sides) fails the
check until resolved — see [Works with your tracker](../README.md#works-with-your-tracker).

## MCP Agent Loop

```bash
claude mcp add ztrack -- npx ztrack mcp serve
```

The server (`ztrack mcp serve`, over stdio) exposes seven agent-facing tools:

| Tool | Does |
|---|---|
| `tracker_check` | validate the tracker / an issue / a file — the completion oracle |
| `tracker_issue_list` | list issues |
| `tracker_issue_view` | inspect one issue (and its AC schema shape) |
| `tracker_issue_create` | create an issue |
| `tracker_patch` | overlay schema fields onto an issue or AC (mark passed, cite evidence) |
| `tracker_fmt` | canonicalize an issue body through the preset grammar |
| `tracker_init` | install a preset + config |

Ask the agent to call `tracker_check` before it finishes work. If the check is
red, the agent should keep producing the missing evidence rather than marking the
task done. (Arming the autonomy **loop** is CLI-side — `ztrack loop start` — not an MCP tool;
an MCP-only agent self-gates by calling `tracker_check`.)
