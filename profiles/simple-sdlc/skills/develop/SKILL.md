---
name: ztrack-simple-sdlc-develop
description: Implement one ztrack simple-sdlc issue and produce real evidence; use when assigned a Ready or rework issue by PM.
---

# ztrack simple-sdlc Develop

Read:

- `profiles/simple-sdlc/standards/issue-and-evidence.md`

## Procedure

1. Read `ZTRACK_ISSUE`; stop if it is missing.
2. View only that assigned issue and implement only its ACs.
3. Run project tests/checks. If a relevant check exits 0, accept it as passing;
   do not rerun only to get prettier reporter output.
4. Commit implementation.
5. For each genuinely satisfied AC, add evidence before checking it. In local repos with no PR, run `ztrack evidence add <issue> --type test --ac <ac> --head <commit> --justification "<test/check that passed>"`, then `ztrack ac check <issue> <ac> --commit <commit> --evidence E1`.
6. Leave unsupported ACs unchecked.
7. Move the issue to `In Review` only when `ztrack check` is green and no
   other issue is already `In Review`: `ztrack issue edit <issue> --state "In Review"`.
   If another issue is in review, leave this issue `In Progress` and end with
   `OUTCOME: blocked review-capacity`.

End with `OUTCOME: ready-for-review` or `OUTCOME: blocked <reason>`.
