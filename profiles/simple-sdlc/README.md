# simple-sdlc Profile

Use after:

```bash
npx ztrack init --team <KEY> --preset simple-sdlc
```

This profile contains only the operational pieces needed to run a small SDLC with
agents:

```text
scheduler/         schedule config
scheduler/scripts/ scheduled runner, PM tick, recovery, cleanup
scripts/           agent runner
skills/            PM, draft, develop, review skill sources
standards/         shared standards read by those skills
```

## Scheduler

Start with:

```bash
TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376" node profiles/simple-sdlc/scheduler/scripts/run.mjs --once
```

The scheduler reads `scheduler/schedule.json` and deterministically executes the
listed scripts. The PM tick only invokes the PM skill through
`scripts/run-agent.mjs`. Setup installs the profile skills into both
`.agents/skills` for Codex and `.claude/skills` for Claude. The runner uses
`$ztrack-simple-sdlc-pm` for Codex and `/ztrack-simple-sdlc-pm` for Claude. PM
decides whether to dispatch draft, develop, or review work. Nested dispatch also
goes through `scripts/run-agent.mjs`; the PM skill does not know about agent
backend details.

For Termfleet-backed agents:

```bash
export TERMFLEET_CLI="npx tsx /path/to/termfleet/src/cli.ts"
export TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376"
export TERMFLEET_AGENT="codex" # or claude
node profiles/simple-sdlc/scheduler/scripts/run.mjs
```

## Skills

- `skills/pm/SKILL.md`: dispatch and WIP control.
- `skills/draft/SKILL.md`: turn requests into verifiable issues.
- `skills/develop/SKILL.md`: implement one issue and produce evidence.
- `skills/review/SKILL.md`: verify evidence and close or request changes.

Each skill names the standards it reads. Do not add extra standards unless a
skill explicitly references them.
