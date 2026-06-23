# Examples

## Minimal Local Check

```bash
npx ztrack init --team APP
npx ztrack issue scaffold --title "Protect API endpoint" > body.md
npx ztrack issue create --title "Protect API endpoint" --label type:case --state "In Progress" --assignee "$USER" --body-file body.md
npx ztrack issue list
npx ztrack check
```

With the `default` preset, a passed acceptance criterion needs image+commit
evidence that can be verified against git, plus a proof naming that evidence. A
fake commit SHA is a hard type error, not a warning.

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

## MCP Agent Loop

```bash
claude mcp add ztrack -- npx ztrack mcp serve
```

Ask the agent to call `tracker_check` before it finishes work. If the check is
red, the agent should keep producing the missing evidence rather than marking the
task done.
