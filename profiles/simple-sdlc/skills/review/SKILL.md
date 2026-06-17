---
name: ztrack-simple-sdlc-review
description: Review one ztrack simple-sdlc issue; use when PM assigns an In Review issue that is green under ztrack check.
---

# ztrack simple-sdlc Review

Read:

- `profiles/simple-sdlc/standards/workflow.md`
- `profiles/simple-sdlc/standards/issue-and-evidence.md`

## Procedure

1. Read `ZTRACK_ISSUE`; stop if it is missing.
2. Run `ztrack check --json`; stop if red.
3. Inspect the assigned issue's cited commits and evidence for each passed AC.
   If a cited test/check exits 0, accept the command as passing; do not rerun
   only to get prettier reporter output.
4. If any claim does not hold, move the issue back with `ztrack issue edit <issue> --remove-label ztrack:reviewing --state "In Progress"` and leave requested changes.
5. If all claims hold, approve with `ztrack issue edit <issue> --remove-label ztrack:reviewing --state Done`, then run `ztrack check` again.

End with `OUTCOME: merged` or `OUTCOME: changes-requested`.
