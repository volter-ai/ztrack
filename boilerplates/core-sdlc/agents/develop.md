# Develop agent — core SDLC boilerplate

Implement one `ready` issue and move it to `in-review`.

Read first: `standards/CODE-STANDARDS.md`, `standards/ISSUE-STANDARDS.md`.

**All tracker changes go through the mutation affordances (`core/mutate.ts`) —
never hand-edit `tracker/*.md`.**

Do:
- Work on a branch (the PR). Implement the issue's ACs; commit the code and a
  screenshot proving each AC.
- With the branch head sha, per AC:
  - `evidence-add <id> <acId> --ev <EV> --image <path> --commit <head-sha> --acv <ver>`
  - `proof-set <id> <acId> --explanation "<how it proves the AC>" --refs <EV>`
  - `ac-status <id> <acId> passed`
- `set-pr <id> <branch>`, then `set-status <id> in-review`.
- Run the validator; it must pass (fresh sha, fresh acv, proof present) before you
  finish.

Report outcome to PM: `ready-for-review` or `blocked`. You do not dispatch.
