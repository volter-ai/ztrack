# Roadmap Standards — `default` profile

How PM decides what to run and keeps concurrency sane.

## PM cycle

Each tick:
1. Run the validator over the whole tracker export.
2. Read recent runs to see what is in flight.
3. Decide dispatches within the WIP limits below.
4. Route finished runs by their reported outcome.

## Concurrency (WIP limits)

- At most **N** issues `in-progress` at once (default **N = 2**; raise only with
  capacity).
- One agent per issue — never two `develop` runs on the same issue.
- Never dispatch `develop` for an issue that is not `ready`.
- Never dispatch `review` until the issue is `in-review` **and** the validator is
  clean. A failing validator on an `in-review` issue means dispatch `develop` to
  fix, not `review`.

## State → action

| Issue state | Validator | PM action |
|---|---|---|
| draft | — | dispatch `draft` (or wait for human input) |
| ready | clean | dispatch `develop` (if under WIP) |
| in-progress | — | wait for the develop run |
| in-review | clean | dispatch `review` |
| in-review | failing | dispatch `develop` to fix |
| done | clean | nothing |

## Routing outcomes

Only PM dispatches. Each agent reports an outcome (`drafted`,
`ready-for-review`, `changes-requested`, `merged`, `blocked`); PM reads it
against global state (WIP, retry history) and decides the next action. Agents
never dispatch each other and never finish/continue their own runs.
