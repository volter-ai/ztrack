---
name: ztrack-simple-sdlc-pm
description: Dispatch PM work for a ztrack simple-sdlc repository; use when running scheduled PM ticks, choosing draft/develop/review work, enforcing WIP, or routing agent outcomes.
---

# ztrack simple-sdlc PM

Read:

- `profiles/simple-sdlc/standards/workflow.md`
- `profiles/simple-sdlc/standards/issue-and-evidence.md`

## Tick

This is an execution skill, not a status report. Do not stop after summarizing
state. A tick is complete only after exactly one eligible dispatch happened, or
after you verified that no eligible develop/review dispatch exists.

1. Run `ztrack check --json`.
2. Run `ztrack issue list --state open --limit 100 --json identifier,title,state,labels,assignee`.
3. Respect WIP from `workflow.md`.
4. Dispatch exactly one agent per tick, in this order:
   - If an issue is `In Review` and does not have label `ztrack:reviewing`, first claim it with `ztrack issue edit <id> --add-label "ztrack:reviewing"`, then run `ZTRACK_AGENT=review ZTRACK_ISSUE=<id> node profiles/simple-sdlc/scripts/run-agent.mjs`.
   - Else if no issue is `In Review`, WIP allows develop, and an issue is `Ready`, first claim it with `ztrack issue edit <id> --state "In Progress"`, then run `ZTRACK_AGENT=develop ZTRACK_ISSUE=<id> node profiles/simple-sdlc/scripts/run-agent.mjs`.
   - Else stop without dispatch.
5. After dispatch, run `ztrack check --json`. Do not wait for the dispatched agent to finish.

Use `node profiles/simple-sdlc/scripts/run-agent.mjs` exactly as the dispatch
interface. Do not choose an agent backend, write an ad hoc agent command, or
inline another agent invocation. Always pass `ZTRACK_ISSUE` for develop and
review dispatches. Never dispatch review for an issue already labeled
`ztrack:reviewing`.

Never implement, review, or mark ACs passed yourself.
Never dispatch draft from a scheduled PM tick unless a human explicitly asked
this tick to draft new work.
