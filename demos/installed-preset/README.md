# Installed Preset Demo

This demo is a minimal repo-local validation preset. It is intentionally small:
it shows the runtime shape and one project-owned rule without becoming a
framework.

Use this after installing the nearest starter with `ztrack init --preset
<basic|simple-sdlc|simple-spec|speckit>` and deciding the project needs an
extra deterministic rule.

## What It Enforces

In addition to normal snapshot shape, every case must have at least one source
reference marker (`[1]`, `[2]`, etc.) in the body.

This is not a recommended universal rule. It is a compact example of a
project-owned rule.

## Install In A Test Repo

```bash
npx ztrack init --team APP --preset simple-sdlc
```

This installs `.volter/tracker/validation/preset.cjs`. The demo file in this
directory is a smaller copyable example of the same runtime shape.

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

Create a snapshot and check it:

```bash
npx ztrack snapshot export --out .volter/snapshot.json
npx ztrack check --input .volter/snapshot.json
```

For production, edit the installed preset in place and add clean/failing
fixtures for each rule.

See [Preset Reference](../../docs/PRESETS.md).
