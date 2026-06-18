# ztrack Demos

Runnable demos live here. They should be safe to run from a checkout and should
create temporary working directories instead of mutating this repository.

## Available

```bash
bash demos/local-red-green.sh
bash demos/fresh-project-dry-run.sh
bash demos/autonomous-profile-setup.sh
bash demos/full-dev-cycle.sh
bash demos/real-project-cycle.sh
```

`local-red-green.sh` proves the `basic` `ztrack check` contract with a
fabricated commit failure and a real commit pass.

`fresh-project-dry-run.sh` packs the current checkout and installs it into fresh
temporary repositories to prove all public presets, the CI validated-root path,
and the MCP loop, and the SDK demo.

`autonomous-profile-setup.sh` packs ztrack, creates a new repo, installs the
`simple-sdlc` preset and profile, installs the scheduler config, seeds
starter issues, and verifies the scheduler wakes the PM skill through
`run-agent`.

`full-dev-cycle.sh` is the release-grade lifecycle demo. It builds a realistic
temporary OSS project, creates multiple implementation commits and tracker
issues, blocks a premature Done transition, validates red/green evidence,
exercises the CI validated-root path, SDK, MCP, and verifies a fresh clone.

`real-project-cycle.sh` is the heavier adoption exercise. It generates a
multi-package workspace with inventory, API, admin, docs, tests, runbooks, an
ADR, custom project validation in the installed preset, review/rework loops, the
CI validated-root path, SDK, MCP, and fresh-clone validation.

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

This shows the repo-local core preset shape for teams that need their own
deterministic rulebook: configure `createGenericPreset` and push a rule onto
`module.exports.rules` over the validated root (`{ issues: [...] }`).
