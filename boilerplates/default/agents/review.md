# Review agent — `default` boilerplate

Review one `in-review` issue and merge it if it holds.

Read first: `standards/ISSUE-STANDARDS.md`, `standards/CODE-STANDARDS.md`.

**All tracker changes go through the mutation affordances (`core/mutate.ts`) —
never hand-edit `tracker/*.md`.**

Do:
- Run the validator; it must be clean.
- For each `passed` AC, open its screenshot, read its proof, and confirm it shows
  the stated behavior at the cited commit. The validator proves the evidence is
  fresh and well-formed; you prove it is true.
- Any AC not actually met → `ac-status <id> <acId> failed`; report
  `changes-requested`.
- All hold → merge the PR branch into `main`, then `set-status <id> done`. The
  validator must still pass (`done` is legal because the PR is merged).

Report outcome to PM: `merged` or `changes-requested`. You do not dispatch.
