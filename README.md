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
  <a href="docs/EXAMPLES.md"><strong>Examples</strong></a> ·
  <a href="#agent-workflows"><strong>Agent workflows</strong></a> ·
  <a href="#community-and-support"><strong>Support</strong></a> ·
  <a href="https://ztrack.dev/startup-pilot.html"><strong>Startup Pilot</strong></a>
</p>

<p align="center"><img src="docs/demo.gif" alt="ztrack check: cite a real commit -> green; fake SHA -> exit 1" width="680"></p>

AI coding agents close tickets on prose. "All tests pass, feature complete" — and the
commit it cited never existed. Your tracker stored the claim with perfect fidelity and
verified nothing.

**ztrack is a typechecker for your issue tracker.** A checked acceptance criterion must
cite a commit SHA that exists in git and is an ancestor of the branch head, evidence that
resolves, screenshots/videos that exist — or it fails with a non-zero exit. The task
schema is defined in [Zod](https://zod.dev).

## What ztrack catches

| Claim in the tracker | What ztrack verifies |
|---|---|
| "Implemented in commit `a1b2c3d`" | the SHA exists in git and is reachable from the branch head |
| "This acceptance criterion is checked" | it has the evidence required by your configured rigor level |
| "The screenshot/video proves it" | the referenced proof resolves and stays tied to the checked requirement |
| "This ticket is ready/done" | required criteria, PR state, assignee, and evidence are internally consistent |

Lint errors are fixed by editing text. Type errors are fixed by producing evidence.

## Quickstart (under a minute)

```bash
npx ztrack init      # writes a config: green with just git + a PR host
npx ztrack check     # typecheck your tasks
```

Cite a real commit and a matching PR → pass. Cite a fake SHA → exit 1.

```text
$ ztrack check

  ✓ DEMO-2  auth middleware           2 ACs, evidence ok
  ✓ DEMO-3  rate limiter              1 AC, evidence ok
  ✗ DEMO-1  "API returns 200"
      checked_dev_ac_commit_hash_missing
      cites a1b2c3d — not found in git

✗ 1 error  — the agent said done. the commit doesn't exist.
exit 1
```

## How it works

ztrack is a verification layer, not a new tracker.

1. Read tasks from your existing work system or a committed snapshot.
2. Parse each task through a Zod schema.
3. Run deterministic checks against git, PR metadata, and referenced evidence.
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
| GitHub Action | repository gate with `uses: volter-ai/ztrack@v0` |

## Agent workflows

- **MCP:** `claude mcp add ztrack -- npx ztrack mcp serve`
- **CI gate:** run `npx ztrack check` in your pipeline, or use `volter-ai/ztrack@v0`
- **Stop-hook:** block an agent's turn until `check` is green — agents fix-and-retry a typechecker until it passes

See [examples](docs/EXAMPLES.md) for a minimal local check, a committed-snapshot
CI gate, and an MCP agent loop.

## Gradual rigor

Rules are organized into categories — well-formed, sourced, code, visual, behavioral —
each with a depth dial, like turning up strictness in a typechecker. Start where your team
is (git + a PR host) and ratchet up. Claims above your configured rigor aren't dropped —
they're counted honestly: *"valid at this level; 14 claims unverified at higher rigor."*

| Category | What it checks | Instrumentation |
|---|---|---|
| **well-formed** | the record parses and refers to things that exist | the tracker alone |
| **sourced** | every requirement traces to where it came from | none → world mirror |
| **code** | a checked AC cites a real commit; evidence stays fresh | git + a PR host |
| **visual** | a checked UI AC carries a resolving image proof | screenshot capability |
| **behavioral** | a checked AC carries pass/fail video or human QA proof | a deployable scenario |

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

- [Examples](docs/EXAMPLES.md)
- [Architecture](ARCHITECTURE.md)
- [Preset guide](PRESET-GUIDE.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Releasing](docs/RELEASING.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

## License

[Apache-2.0](LICENSE)
