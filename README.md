<h1 align="center">ztrack</h1>

<p align="center"><strong>Typecheck and lint your task management.</strong> Done is earned, not declared.</p>

<p align="center">
  <a href="https://github.com/volter-ai/ztrack/actions/workflows/ci.yml"><img src="https://github.com/volter-ai/ztrack/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.npmjs.com/package/ztrack"><img src="https://img.shields.io/npm/v/ztrack.svg" alt="npm"></a>
  <a href="https://www.npmjs.com/package/ztrack"><img src="https://img.shields.io/npm/dm/ztrack.svg" alt="npm downloads"></a>
  <a href="https://github.com/volter-ai/ztrack/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/telemetry-none-brightgreen.svg" alt="no telemetry">
</p>

<p align="center">
  <a href="#quickstart-under-a-minute"><strong>Quickstart</strong></a> ·
  <a href="docs/ADOPTING.md"><strong>Adopt</strong></a> ·
  <a href="docs/EXAMPLES.md"><strong>Examples</strong></a> ·
  <a href="docs/COOKBOOKS.md"><strong>Cookbooks</strong></a> ·
  <a href="#agent-workflows"><strong>Agent workflows</strong></a> ·
  <a href="#community-and-support"><strong>Support</strong></a> ·
  <a href="https://ztrack.dev/startup-pilot.html"><strong>Startup Pilot</strong></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/volter-ai/ztrack/main/docs/demo.gif" alt="ztrack check: cite a real commit -> green; fake SHA -> exit 1" width="680"></p>

AI coding agents close tickets on prose. "All tests pass, feature complete" — and the
commit it cited never existed. Your tracker stored the claim with perfect fidelity and
verified nothing.

**ztrack is a typechecker for your issue tracker.** With the installed presets,
a checked acceptance criterion must cite a commit SHA that exists in git plus an
evidence row in the issue. Teams can extend the installed preset to validate PRs,
screenshots, videos, approvals, and source systems.

## What ztrack catches

| Claim in the tracker | What ztrack verifies |
|---|---|
| "Implemented in commit `a1b2c3d`" | the SHA exists in the local git object database |
| "This acceptance criterion is checked" | it cites a commit and an `[E...]` evidence row |
| "This evidence proves it" | the evidence row exists and is linked from the checked AC |
| "This ticket is ready/done" | the installed preset's required criteria and sections are internally consistent |

Lint errors are fixed by editing text. Type errors are fixed by producing evidence.

## Quickstart (under a minute)

```bash
npx ztrack init --preset basic
npx ztrack issue scaffold --title "First verified task" > body.md
npx ztrack issue create --title "First verified task" --label type:case --state "In Progress" --assignee "$USER" --body-file body.md
npx ztrack check
```

Cite a fake SHA in a checked AC → exit 1. Replace it with a real commit and an
evidence row → pass.

```text
$ ztrack check

  ✓ DEMO-2  auth middleware           2 ACs, evidence rows ok
  ✓ DEMO-3  rate limiter              1 AC, evidence rows ok
  ✗ DEMO-1  "API returns 200"
      basic_checked_ac_commit_hash_missing
      cites a1b2c3d — not found in git

✗ 1 error  — the agent said done. the commit doesn't exist.
exit 1
```

## How it works

ztrack is a verification layer, not a new tracker.

1. Read tasks from your existing work system or a committed snapshot.
2. Parse each task through a Zod schema.
3. Run deterministic checks against git and referenced evidence rows.
4. Exit non-zero when a checked claim is not backed by real proof.
5. Let CI, MCP, or an agent stop-hook block the workflow until the evidence exists.

## Works with your tracker

Keep **Linear**, **Jira**, or **GitHub Issues** as the human surface. ztrack sits next to
them and only validates the claims agents or humans make there.

| Surface | Role |
|---|---|
| Linear / Jira / GitHub Issues | where people plan, review, and discuss work |
| ztrack CLI | local and CI verification |
| ztrack MCP | agent-facing task/evidence loop |
| ztrack visualizer | local web view of issues, acceptance criteria, and findings |
| GitHub Action | repository gate with `uses: volter-ai/ztrack@v0` |

## Agent workflows

- **MCP:** `claude mcp add ztrack -- npx ztrack mcp serve`
- **CI gate:** run `npx ztrack check` in your pipeline, or use `volter-ai/ztrack@v0`
- **Stop-hook:** block an agent's turn until `check` is green — agents fix-and-retry a typechecker until it passes

See [examples](docs/EXAMPLES.md) for a minimal local check, a committed-snapshot
CI gate, and an MCP agent loop.

## Visualize

For a read-only web view of the tracker — issues, acceptance-criteria progress,
findings, and audit-derived timestamps — run the visualizer (requires
[Bun](https://bun.sh)):

```bash
ztrack visualizer                 # default preset, http://localhost:3300
ztrack viz --preset speckit --port 4000
```

It validates the live tracker on each request through the same core as `check`,
so the board never drifts from what CI enforces.

If you are adding ztrack to an existing repository, start with
[Adopting ztrack](docs/ADOPTING.md). If an AI agent is doing the setup, give it
[the agent playbook](docs/AGENT-PLAYBOOK.md).

To install validation plus an operating profile in one shot:

```bash
npx -p ztrack ztrack-setup --repo /path/to/repo --team APP --preset simple-sdlc --profile simple-sdlc
```

## Install presets

`ztrack init` installs one editable validation file into the target repo:
`.volter/tracker/validation/preset.cjs`.

| Preset | Use When |
|---|---|
| `basic` | first adoption or unknown workflow |
| `simple-sdlc` | source-grounded work items with lifecycle gates |
| `simple-spec` | issue bodies are specs with requirements and ACs |
| `speckit` | GitHub Spec Kit style feature records |

See [Preset reference](docs/PRESETS.md) for the exact gates.

## Project-specific rigor

The installed preset is intentionally editable. Start with commit plus evidence
row checks, then encode project-specific rules in
`.volter/tracker/validation/preset.cjs`: source grounding, section gates,
approval requirements, PR metadata, screenshot files, video evidence, or external
world/source checks.

## Why believe it

ztrack runs our own autonomous agent fleet in production — it's what we use to ship real
code. Every release re-proves in CI that a fabricated commit SHA fails the check.

Current status: ztrack is pre-beta and has been battle-tested first on our own production
workflow. The deterministic core is general, but new tracker conventions may expose rough
edges. Please open issues with the smallest workflow shape that breaks.

## How it compares

| | Records claim | Validates structure | Verifies evidence of "done" |
|---|:---:|:---:|:---:|
| Linear / Jira | ✓ | shape only | — |
| Beads / Backlog.md | ✓ | partial | — |
| spec-kit / OpenSpec | ✓ | ✓ (prose shape) | — |
| Eval / observability | ephemeral | — | scores outputs |
| **ztrack** | ✓ | ✓ | ✓ |

## Managed setup

The open-source core is free to self-host and run locally. Teams that want help wiring
ztrack into an existing tracker, CI, MCP, and agent stop-hook workflow can apply for
[Startup Pilot](https://ztrack.dev/startup-pilot.html). No payment is collected until we
confirm there is a good fit.

## Community and support

- Questions and bugs: open a GitHub issue with the matching template.
- Feature ideas: include the workflow problem and the evidence you want ztrack to verify.
- Managed setup: use the [Startup Pilot](https://ztrack.dev/startup-pilot.html) form.
- Security reports: use GitHub Security Advisories; do not open public security issues.

## Documentation

- [Docs index](docs/README.md)
- [Examples](docs/EXAMPLES.md)
- [Adopting ztrack](docs/ADOPTING.md)
- [Cookbooks](docs/COOKBOOKS.md)
- [Visualizer](visualizer/README.md) — local web view of tracker state
- [Preset reference](docs/PRESETS.md)
- [Agent profiles](profiles/README.md)
- [AI agent playbook](docs/AGENT-PLAYBOOK.md)
- [World integration](docs/WORLD-INTEGRATION.md) — advanced source-backed validation boundary
- [Architecture](ARCHITECTURE.md)
- [Maintainer preset guide](PRESET-GUIDE.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Releasing](docs/RELEASING.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

## License

[Apache-2.0](LICENSE)
