# Security Policy

ztrack is local-first and sends no telemetry — it runs on your machine and
talks only to the services you point it at (git, your PR host, your tracker).

## Trust boundary: validation presets execute as code

A repo's validation rulebook is a Node module at
`.volter/tracker/validation/preset.mts` (set by `validation.entrypoint`). `ztrack
check`/`export`/`lint`/`ac`/`tx` and the MCP server **import and execute that
file**. So **running ztrack against a repository runs that repository's preset
code** — the same trust model as running its `npm install`, build, or test
scripts.

- Only run `ztrack` against repositories you trust. Treat a repo's `preset.mts`
  (and `.volter/tracker-config.json`) as untrusted input from external
  contributors.
- The entrypoint is confined to the project directory (it cannot point the import
  at an arbitrary host path), but it can still run arbitrary code within the
  process.
- **The committed validated-root path (`ztrack check --input .volter/root.json
  --verify-commits`, the `root` input of the GitHub Action) does NOT avoid executing a
  preset.** It avoids reading the live tracker store (useful because a fresh CI checkout
  doesn't have it) — but `--input` still loads and executes the checkout's configured
  `preset.mts` to validate that root, exactly like every other check surface. There is no
  no-code check.
- **To validate an untrusted checkout's data with TRUSTED code**, also pass `ztrack check
  --preset <path>` (the `preset` input of the GitHub Action) pointed at a preset module
  from a checkout you trust — it loads in place of the configured entrypoint and, unlike
  the entrypoint, is not confined to the project (it's the operator's own trust decision,
  like `eslint -c`). The fork-PR-safe recipe, for a `pull_request_target` workflow:
  1. Check out the **base ref** (trusted) into one directory, e.g. `base/`.
  2. Check out the **PR head** (untrusted) into another, e.g. `head/`.
  3. In `head/`, run `ztrack export` (or use a root the PR already committed) to get
     `head/.volter/root.json` — this executes the head's own preset, so do it in a
     sandboxed/no-secrets job, or better, have the PR author commit the root and skip this
     step entirely.
  4. Validate the head's root with the base's preset, both from the trusted checkout:
     `ztrack check --input head/.volter/root.json --verify-commits --preset
     base/.volter/tracker/validation/preset.mts` (or the `root`/`preset` Action inputs).
     Only `base/`'s code executes; the head's `preset.mts` never runs on your runner.
- Avoid running a bare live-tracker `ztrack check` (no `--input`, no `--preset`) on
  untrusted PR checkouts — that always executes the checkout's own `preset.mts`.

The visualizer (`ztrack visualizer`) is a local dev tool: it binds to
`127.0.0.1` only and serves repo files; do not expose it to untrusted networks.

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories for this repository.

We aim to acknowledge within 72 hours.

Do not open public issues for security reports.
