# Installed Preset Demo

This demo is a minimal repo-local validation preset. It is intentionally small:
it shows the core preset shape and one project-owned rule without becoming a
framework.

Use this after installing the nearest starter with `ztrack init --preset
<default|spec|speckit>` and deciding the project needs an extra deterministic
rule.

## The Single Validation Pipeline

ztrack has one validation pipeline. The loader gathers tracker markdown plus the
git world, the preset's mdast parser produces a candidate root, one strict schema
validates it, the engine **derives an analyzed model** from it, and declarative
rules select facts off that model. The validated root (`{ issues: [...] }`) is
the artifact `ztrack check`, the visualizer, and the SDK all read.

An installed preset is a REAL, standalone, editable module: it imports the
engine, mdast helpers, and root-schema constructor from `ztrack/preset-kit`, and
brings its OWN strict schema, parser, and `serialize`. It declares its `rules` as
**records**, not imperative functions. A rule is
`{ code, severity?, category?, depth?, select, when?, message }` —
`select(model)` picks the list to check, `when(item, model)` keeps matches, and
`message(item, model)` is the finding text (location comes off the item). The
model exposes `issues`, `acs`, `evidence`, `duplicateIssueIds`,
`duplicateAcIds`, `graph: { cycles, blockerProblems, completionViolations }`,
and `derived` (this file's own analysis).

## What It Enforces

This compact demo writes two records from scratch: every issue must have a
non-empty `Summary:`, and every passed acceptance criterion must cite at least
one piece of evidence.

This is not a recommended universal rule set. It is a compact example of the
authoring model: bring your own schema + parser + serialize, then write your
rules as records in the `rules` array.

## Install In A Test Repo

```bash
npx ztrack init --team APP --preset default
```

This installs `.volter/tracker/validation/preset.mts`. The demo file in this
directory is a smaller copyable example of the same standalone-preset shape.

The config shape is:

```json
{
  "backend": "markdown",
  "markdown": { "teamKey": "APP" },
  "validation": {
    "entrypoint": ".volter/tracker/validation/preset.mts",
    "installedFrom": "default"
  }
}
```

Export the validated root and check it:

```bash
npx ztrack export --out .volter/root.json
npx ztrack check --input .volter/root.json
```

Each issue a rule reads (via `m.issues`) exposes whatever this preset's schema
declares — at minimum `id`, `title`, `summary`, `status`, and
`acceptanceCriteria`. To add a project rule, add a record to the `rules` array:

```ts
rule<MyRoot, { issueId: string; issue: Issue }>({
  code: 'my_project_rule',
  select: (m) => m.issues,
  when: ({ issue }) => /* condition over this preset's own issue fields (status, labels, …) */,
  message: ({ issue }) => `...${issue.id}...`,
}),
```

For production, edit the records in the installed preset in place and add
clean/failing fixtures for each rule.

See [Preset Reference](../../docs/PRESETS.md).
