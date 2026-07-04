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
bash demos/check-e2e.sh
bash demos/missing-peer-gate.sh
bash demos/loop-gate-ci.sh
bash demos/pm-matrix.sh
bash demos/loop-e2e.sh
bash demos/real-project-marathon.sh
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

`check-e2e.sh` is the real-CLI E2E for `ztrack check` RULE BEHAVIORS — the
shipped path, through the standalone `default` preset the packed+installed CLI
writes as `preset.mts`. It's the primary proof that the check rules fire (and
stay quiet) correctly through the real CLI. Deterministic, no live agent; a CI
gate.

`missing-peer-gate.sh` is the real (non-mocked) CLI E2E for #13's optional-peer
contract: packs the repo and installs it in two fresh consumer projects — peers
absent (`sync github` fails closed with the install hint, everything else keeps
working), and peers installed but run under plain node/npx (the bun-hint path,
since `@volter-ai-dev/twin-github` ships TypeScript source only). Deterministic,
no gh auth, no live GitHub network call; a CI/publish gate.

`loop-gate-ci.sh` is deterministic CI coverage for the ztrack loop — everything
in `loop-e2e.sh` that does NOT need a live agent. It drives the real Stop hook
(`plugins/ztrack-gate/hooks/stop-loop.sh`) with crafted session_id payloads and
asserts on its exit codes, and exercises the real `ztrack waiver` CLI
round-trip. No model calls, so it runs in CI; a CI gate.

`pm-matrix.sh` is the package-manager compatibility matrix: it installs the
packed ztrack under every layout that npm's flat `node_modules` doesn't
exercise — pnpm (strict isolated store), yarn classic, yarn Berry/PnP, and bun
— and runs `init` + a green `check` under each. Catches resolution regressions
(phantom deps, the `require`/`exports` conditions, PnP) that the npm-based
fresh-project dry run can't; a CI gate.

`loop-e2e.sh` is a REAL end-to-end test of the ztrack loop: a live headless
Claude Code agent driven by the armed-loop Stop hook plus a real `ztrack
check`. It proves the loop's distinguishing behavior — armed+red holds the
turn, armed+green releases, not-armed is free — asserting on `num_turns` from
the agent's JSON result. Needs the `claude` CLI logged in (or
`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`) and network; not a CI gate.

`real-project-marathon.sh` is a long-running endurance exercise, not a CI gate.
It builds one realistic multi-package workspace once, then repeats a
red/green/root/SDK/MCP/fresh-clone dev-cycle slice (like `real-project-cycle.sh`)
over and over — for `$ZTRACK_REAL_PROJECT_MINUTES` (default 120) or up to
`$ZTRACK_REAL_PROJECT_MAX_CYCLES` cycles — to surface drift or flakiness that
only shows up after many iterations against a growing project.

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
