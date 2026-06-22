# Installed Preset Demo

This demo is a minimal repo-local validation preset. It is intentionally small:
it shows the core preset shape and one project-owned rule without becoming a
framework.

Use this after installing the nearest starter with `ztrack init --preset
<basic|simple-sdlc|simple-spec|speckit>` and deciding the project needs an
extra deterministic rule.

## The Single Validation Pipeline

ztrack has one validation pipeline. The loader gathers tracker markdown plus the
git world, an mdast parser produces a candidate root, one strict schema
validates it, the engine **derives an analyzed model** from it, and declarative
rules select facts off that model. The validated root (`{ issues: [...] }`) is
the artifact `ztrack check`, the visualizer, and the SDK all read.

An installed preset is REAL editable code: it rents the engine, parser, and
schema from `ztrack/preset-kit` and declares its `rules` as **records**, not
imperative functions. A rule is
`{ code, severity?, category?, depth?, select, when?, message }` —
`select(model)` picks the list to check, `when(item, model)` keeps matches, and
`message(item, model)` is the finding text (location comes off the item). The
model exposes `issues`, `acs`, `evidence`, `duplicateIssueIds`,
`duplicateAcIds`, `graph: { cycles, blockerProblems, completionViolations }`,
and `derived` (this file's own analysis).

## What It Enforces

This compact demo writes two records from scratch: every issue body must cite at
least one `[1]`, `[2]`, ... source marker, and every issue body must include a
`## Summary` section.

This is not a recommended universal rule set. It is a compact example of the
authoring model: import the engine + parser + schema, then write your rules as
records in the `rules` array.

## Install In A Test Repo

```bash
npx ztrack init --team APP --preset simple-sdlc
```

This installs `.volter/tracker/validation/preset.cjs`. The demo file in this
directory is a smaller copyable example of the same core-preset shape.

The config shape is:

```json
{
  "backend": "local",
  "local": { "teamKey": "APP" },
  "validation": {
    "entrypoint": ".volter/tracker/validation/preset.cjs",
    "installedFrom": "simple-sdlc"
  }
}
```

Export the validated root and check it:

```bash
npx ztrack export --out .volter/root.json
npx ztrack check --input .volter/root.json
```

Each issue a rule reads (via `m.issues`) exposes: `id`, `title`, `summary`,
`status`, `stateType`, `assignee`, `labels`, `sourceMarkers`, `sections` (the
`##` heading titles present in the body), and `acceptanceCriteria`. To add a
project rule, add a record to the `rules` array:

```js
rules.push(rule({
  code: 'my_project_rule',
  select: (m) => m.issues,
  when: ({ issue }) => /* condition using issue.labels, issue.stateType/status, issue.sections, ... */,
  message: ({ issue }) => `...${issue.id}...`,
}));
```

For production, edit the records in the installed preset in place and add
clean/failing fixtures for each rule.

See [Preset Reference](../../docs/PRESETS.md).
