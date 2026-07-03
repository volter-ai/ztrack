# ztrack Demos

Runnable demos live here. They should be safe to run from a checkout and should
create temporary working directories instead of mutating this repository.

## Available

```bash
bash demos/local-red-green.sh
bash demos/fresh-project-dry-run.sh
bash demos/full-dev-cycle.sh
bash demos/real-project-cycle.sh
bash demos/import-backlog-demo.sh
```

`local-red-green.sh` proves the `default` `ztrack check` contract with a
fabricated commit failure and a real commit pass.

`fresh-project-dry-run.sh` packs the current checkout and installs it into fresh
temporary repositories to prove all public presets, the CI validated-root path,
and the MCP loop, and the SDK demo.

`full-dev-cycle.sh` is the release-grade lifecycle demo. It builds a realistic
temporary OSS project, creates multiple implementation commits and tracker
issues, blocks a premature Done transition, validates red/green evidence,
exercises the CI validated-root path, SDK, MCP, and verifies a fresh clone.

`real-project-cycle.sh` is the heavier adoption exercise. It generates a
multi-package workspace with inventory, API, admin, docs, tests, runbooks, an
ADR, custom project validation in the installed preset, review/rework loops, the
CI validated-root path, SDK, MCP, and fresh-clone validation.

`import-backlog-demo.sh` proves `ztrack import` end to end through the real
packed+installed CLI: a messy freeform backlog file, `--dry-run` (writes
nothing), a real materialize + `--register`, `ztrack check` green, `ztrack ac
patch` splicing into an imported AC with check staying green, and a FOLDER
import (default excludes, whole-batch no-op on re-import).

## SDK API

From a repo that already ran `npx ztrack init`:

```bash
cp /path/to/ztrack/demos/sdk-api/run.mjs ./ztrack-sdk-demo.mjs
node ./ztrack-sdk-demo.mjs
```

The script creates, views, and lists an issue through `createTrackerClient`.

## Installed Preset Shape

```bash
ls demos/installed-preset
```

This shows the repo-local standalone preset shape for teams that need their own
deterministic rulebook: its own strict schema, mdast parser, serialize, and a
`rules` array of records over the validated root (`{ issues: [...] }`).
