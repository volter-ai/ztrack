# Code Standards — `default` profile

The rules `develop` and `review` follow. **All tracker state changes go through
the mutation affordances** (`core/mutate.ts`) — never hand-edit `tracker/*.md`.
Mutations rewrite the body and append the audit log, so history is automatic.

## Develop

- Implement exactly the ACs of the assigned `ready` issue — no scope creep.
- Work on a branch (your "PR"). Commit code, then capture a screenshot proving
  each AC and commit the screenshots too.
- With the branch head sha, for each AC run:
  - `evidence-add <id> <acId> --ev <EV> --image <path> --commit <head-sha> --acv <ver>`
    (`commit` must be the **current head** — the validator rejects a stale sha)
  - `proof-set <id> <acId> --explanation "<how it proves the AC>" --refs <EV>`
    (a passed AC is incomplete without a proof)
  - `ac-status <id> <acId> passed`
- `set-pr <id> <branch>`, then `set-status <id> in-review`.
- If you change an AC's wording, bump its version and recapture evidence against
  the new version and head sha.
- Finish only when the validator is clean.

## Review

- Re-run the validator. It must be clean.
- For each `passed` AC, open the cited screenshot, read the proof, and confirm it
  actually shows the stated behavior **at the cited commit**. The validator proves
  the evidence is *fresh and well-formed*; you prove it is *true*.
- If an AC is not actually met → `ac-status <id> <acId> failed` and send it back.
- If all hold → merge the PR branch into `main`, then `set-status <id> done`. The
  merge is what makes `done` legal (the validator gates `done` on a merged PR).

## Evidence hygiene

- One screenshot per AC behavior. No video and no external links — this profile's
  evidence is images only.
- A screenshot goes stale the moment new commits land on the branch; recapture
  rather than leaving a sha that no longer matches the head.
