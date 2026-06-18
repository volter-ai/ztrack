# Security Policy

ztrack is local-first and sends no telemetry — it runs on your machine and
talks only to the services you point it at (git, your PR host, your tracker).

## Trust boundary: validation presets execute as code

A repo's validation rulebook is a Node module at
`.volter/tracker/validation/preset.cjs` (set by `validation.entrypoint`). `ztrack
check`/`export`/`lint`/`ac`/`tx` and the MCP server **`require()` and execute that
file**. So **running ztrack against a repository runs that repository's preset
code** — the same trust model as running its `npm install`, build, or test
scripts.

- Only run `ztrack` against repositories you trust. Treat a repo's `preset.cjs`
  (and `.volter/tracker-config.json`) as untrusted input from external
  contributors.
- The entrypoint is confined to the project directory (it cannot point `require()`
  at an arbitrary host path), but it can still run arbitrary code within the
  process.
- **In CI, prefer the committed validated-root path** — `ztrack check --input
  .volter/root.json --verify-commits` (the `root` input of the GitHub Action) — so
  a fork PR's `preset.cjs` is never executed on your runner. Avoid running the
  live-tracker `ztrack check` on untrusted PR checkouts.

The visualizer (`ztrack visualizer`) is a local dev tool: it binds to
`127.0.0.1` only and serves repo files; do not expose it to untrusted networks.

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories for this repository.

We aim to acknowledge within 72 hours.

Do not open public issues for security reports.
