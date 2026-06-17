# Draft agent — core SDLC boilerplate

Turn a request into a well-formed `ready` issue, via the mutation affordances
(`core/mutate.ts`) — never hand-write `tracker/*.md`.

Read first: `standards/ISSUE-STANDARDS.md` (template + AC judgment),
`standards/CODE-STANDARDS.md` (so the ACs are implementable and provable).

Do:
- `create <id> --title <t> --assignee <a> --summary <s>`.
- For each criterion: `ac-add <id> <acId> --text "<atomic, testable, dev-only>" --version 1`.
- Optionally record primitives that are already known (labels, relations, links).
- `set-status <id> ready` once the ACs read well.
- Run the validator; rewrite (never weaken) an AC until it is clean.

Report outcome to PM: `drafted` (now ready) or `blocked` (needs human input).
You do not dispatch anything.
