# ztrack Boilerplates

Boilerplates are optional starter assets that sit above the ztrack core.

## Validation starters (presets)

Every `ztrack init --preset <name>` copies an editable, standalone preset into
`.volter/tracker/validation/preset.mts` (the preset's own schema, parser,
serialize, and rules). The sources live in `boilerplates/presets/`.

Run `ztrack init --list` to see the available presets and their descriptions —
the list is generated from the manifests below, never hand-maintained.

After installation, the file belongs to the target repo. Editing it is how a team
customizes ztrack — see `PRESET-GUIDE.md` for authoring the preset's rules.

## Adding a preset

A preset is **two co-located files** in `boilerplates/presets/`. Drop both; nothing
else needs editing — `ztrack init`, `--list`, `--preset` validation, and the
visualizer all discover presets by scanning this directory.

1. **`<name>.ts`** — the standalone preset (schema/parser/serialize/rules), importing
   only `ztrack/preset-kit`. Its exported `name` field **must equal the filename**
   `<name>`. See `PRESET-GUIDE.md` and the existing presets as the bar to copy.

2. **`<name>.json`** — the manifest sidecar:

   ```json
   {
     "description": "One-line summary shown by `ztrack init --list`.",
     "aliases": ["alt-name"],
     "recommended": false
   }
   ```

   - `description` (required) — the one-liner users see in `ztrack init --list`.
   - `aliases` (optional) — alternate `--preset` inputs that resolve to this preset
     (e.g. `default` is an alias of `simple-sdlc`). Must be unique and must not
     collide with a preset name.
   - `recommended` (optional) — marks the baseline that `ztrack init` installs with
     no `--preset`. **Exactly one** preset across the directory may set this.

`boilerplates/presets/presetManifest.test.ts` guards these invariants (every `.ts`
has a `.json`, exactly one `recommended`, aliases unique/non-colliding, the
preset's `name` matches its filename), so a missing or mismatched manifest fails CI.
(Enforcement is at **CI/test time** — run the repo test suite. `ztrack init` does not
re-validate a hand-edited boilerplate, so a `name` ≠ filename mismatch installs silently.)

There is intentionally **no central list** of presets anywhere in the codebase — do
not reintroduce one (a hardcoded enum/array/map is the bug this design removes).
