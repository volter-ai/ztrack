# Core SDLC Boilerplate

The starter bundle of **docs and agents** for the internal core SDLC example,
on top of the tracker core.

This is **not** the core system. The core is the parse + Zod rules in
`src/core/` (the `engine`/`check` entry point) plus the
reference preset in `src/presets/default.ts` (its `parse` /
`schema` / `rules`). This boilerplate only *consumes* the core: its agents read
the validated export and call the validator.

The dependency points one way: **boilerplate → preset → core**. The core never
imports or knows about this boilerplate, and each SDLC ships its own boilerplate
(different standards, different agents) over the same core engine.

```
standards/   the rules the agents follow
  ISSUE-STANDARDS.md     issue body template + AC judgment (validator = its executable subset)
  CODE-STANDARDS.md      how develop/review implement and prove ACs
  ROADMAP-STANDARDS.md   concurrency / WIP / PM dispatch
agents/      the four agents (only PM dispatches)
  pm.md  draft.md  develop.md  review.md
```
