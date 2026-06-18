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
validates it, and pure rules run over the validated root. The validated root
(`{ issues: [...] }`) is the artifact `ztrack check`, the visualizer, and the
SDK all read.

An installed preset is a core `Preset` built on `createGenericPreset`, which
returns `{ name, schema, parse, rules, scaffold, primitives }`. `rules` is an
array of pure rules `{ name, run }` where `run = (input) => Finding[]`,
`input = { context, root }`, and a `Finding` is
`{ code, severity: 'error' | 'warning', message, issueId?, acId?, evidenceId? }`.

## What It Enforces

In addition to the generic checks, this demo turns on `requireSourceMarker`
(every issue body must cite at least one `[1]`, `[2]`, ... source marker) and
pushes one project-owned rule: every issue body must include a `## Summary`
section.

This is not a recommended universal rule. It is a compact example of the
extension model: configure `createGenericPreset`, then push your own rule onto
`module.exports.rules`.

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

Each parsed issue a rule can read exposes: `id`, `title`, `summary`, `status`,
`stateType`, `assignee`, `labels`, `sourceMarkers`, `sections` (the `##`
heading titles present in the body), and `acceptanceCriteria`. To add a
project rule, push onto the preset's `rules` array:

```js
module.exports.rules.push({
  name: 'my_project_rule',
  run: ({ root }) => root.issues
    .filter((i) => /* condition using i.labels, i.stateType/i.status, i.sections, i.acceptanceCriteria */)
    .map((i) => ({ code: 'my_project_rule', severity: 'error', issueId: i.id, message: '...' })),
});
```

For production, edit the installed preset in place and add clean/failing
fixtures for each rule.

See [Preset Reference](../../docs/PRESETS.md).
