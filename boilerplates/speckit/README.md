# `speckit` boilerplate

The manager for the GitHub Spec Kit SDLC. You add feature requests to
`.specify/backlog.json`; the **PM cycle** (`pm-cycle.ts`) reads each feature's
derived stage (from the speckit preset) and dispatches the matching Spec Kit
skill on Termfleet to push it forward:

```
(no constitution) -> /speckit-constitution
backlog request   -> /speckit-specify
specifying        -> /speckit-clarify
planning          -> /speckit-plan
tasking           -> /speckit-tasks
in-progress       -> /speckit-implement   (+ our commit-citation verification layer)
done              -> nothing
```

The "agents/skills" are Spec Kit's own installed skills (`.claude/skills/speckit-*`);
the cycle just maps stage -> skill and waits for the stage to advance, exactly
like `boilerplates/default/pm-cycle.ts` maps issue-state -> develop/review.

Run: `bun pm-cycle.ts --repo <speckit-project> --url <termfleet>`
