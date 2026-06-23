# ztrack Boilerplates

Boilerplates are optional starter assets that sit above the ztrack core.

## Validation Starters

Every `ztrack init --preset <name>` copies an editable, standalone preset into
`.volter/tracker/validation/preset.mts` (the preset's own schema, parser,
serialize, and rules; the sources live in `boilerplates/presets/<name>.ts`).

- `default`: the primary dev lifecycle — image+commit evidence, proof, and
  lifecycle gates (draft→ready→in-progress→in-review→done).
- `spec`: lightweight spec issues whose ACs cite commit-backed evidence.
- `speckit`: GitHub Spec Kit-shaped multi-file feature records (read-only).

After installation, the file belongs to the target repo. Editing it is how a
team customizes ztrack — see `PRESET-GUIDE.md` for authoring a preset.
