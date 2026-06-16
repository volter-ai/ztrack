# Examples

## Minimal Local Check

```bash
npx ztrack init --team APP
npx ztrack issue scaffold --title "Protect API endpoint"
npx ztrack issue list
npx ztrack check
```

At the default rigor, a checked acceptance criterion needs evidence that can be
verified against git and your configured PR host. A fake commit SHA is a hard
type error, not a warning.

## CI Snapshot Gate

For CI, prefer a committed snapshot. A fresh CI checkout does not preserve your
local tracker store.

```bash
npx ztrack snapshot export --out .volter/snapshot.json
git add .volter/snapshot.json
```

Then gate the snapshot in GitHub Actions:

```yaml
name: ztrack

on:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: volter-ai/ztrack@v0
        with:
          snapshot: .volter/snapshot.json
```

## MCP Agent Loop

```bash
claude mcp add ztrack -- npx ztrack mcp serve
```

Ask the agent to call `tracker_check` before it finishes work. If the check is
red, the agent should keep producing the missing evidence rather than marking the
task done.
