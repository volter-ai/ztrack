# ztrack Boilerplates

Boilerplates are optional starter assets that sit above the ztrack core.

## Validation starters (presets)

Every `ztrack init --preset <name>` copies an editable, standalone preset into
`.volter/tracker/validation/preset.mts` (the preset's own schema, parser,
serialize, and rules). The sources live in `boilerplates/presets/`.

Run `ztrack init --list` to see the available presets and their descriptions —
the list is generated from the manifests below, never hand-maintained.

After installation, the file belongs to the target repo. Editing it is how a team
customizes ztrack — see [docs/PRESETS.md § Building or extending a preset](../docs/PRESETS.md#building-or-extending-a-preset-maintainers) for authoring the preset's rules.

## Adding a preset

A preset is **two co-located files** in `boilerplates/presets/`, and the `.ts` file
**exports a `visualizer` block**. Drop the two files; nothing else needs editing —
`ztrack init`, `--list`, `--preset` validation, and the visualizer all discover
presets by scanning this directory.

1. **`<name>.ts`** — the standalone preset (schema/parser/serialize/rules), importing
   only `ztrack/preset-kit`. Its exported `name` field **must equal the filename**
   `<name>`. See [docs/PRESETS.md § Building or extending a preset](../docs/PRESETS.md#building-or-extending-a-preset-maintainers) and the existing presets as the bar to copy.

   Its default export **must also carry a `visualizer` block** (typed `VisualizerSpec`,
   `ztrack/preset-kit`) — the dashboard's vocabulary as plain data: status order, what an
   AC is called, and which fields hold the assignee/PR/AC text/proof/evidence. Map only
   the fields your schema actually has (see the shipped presets — `spec.ts`, `speckit.ts` —
   for how a smaller schema maps a smaller subset). `statusOrder` must equal your schema's
   own issue-status enum; `boilerplates/presets/visualizerVocabulary.test.ts` guards both
   the block's presence and that equality.

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
`boilerplates/presets/visualizerVocabulary.test.ts` guards the `visualizer` block
described above (every preset has one; its `statusOrder` equals the schema's
issue-status enum), so a missing block or a status renamed on one side only also
fails CI. (Enforcement is at **CI/test time** — run the repo test suite. `ztrack init`
does not re-validate a hand-edited boilerplate, so a `name` ≠ filename mismatch or a
stale `visualizer` block installs silently.)

There is intentionally **no central list** of presets anywhere in the codebase — do
not reintroduce one (a hardcoded enum/array/map is the bug this design removes).

## Dashboard extension starter (visualizer)

Presets (above) are the dashboard's DATA extension point — status order, AC vocabulary,
and which fields hold what. `boilerplates/visualizer/extension.tsx` is the matching CODE
extension point: a complete, heavily-commented, worked example of a repo-owned dashboard
extension, importing only `ztrack/visualizer-kit` (the render-only `VisualizerExtension`
contract — `issuePanels`/`acText`/`acProof`/`acEvidence`/`statusClass`; see
[docs/API.md](../docs/API.md) and `src/visualizerKit.ts`).

It demonstrates, over the `simple-sdlc` preset's own acceptance-criteria fields:

- **`issuePanels`** — one custom issue-level panel, "Proof coverage": for every acceptance
  criterion on the open issue, whether it has both a proof and evidence that actually backs
  it, rendered inside the issue detail drawer beside the core "Acceptance Criteria" panel.
- **`acEvidence`** — one custom renderer for an AC's evidence list (short commit sha, AC
  version, and a real project-relative link when a screenshot/artifact is attached).

To use it in a real repo, copy the file verbatim to
`<stateDir>/tracker/visualizer/extension.tsx` (e.g. `.volter/tracker/visualizer/extension.tsx`
for the default state dir):

```bash
mkdir -p .volter/tracker/visualizer
cp node_modules/ztrack/boilerplates/visualizer/extension.tsx .volter/tracker/visualizer/extension.tsx
```

The running visualizer board picks it up on the very next `/assets/app.js` fetch — no
server restart needed. From there it's yours: edit it to add your own panels or AC
renderers, same as a copied preset. `boilerplates/visualizer/extension.e2e.test.tsx`
copies this exact file into a fixture repo and DOM-renders the board to prove the shipped
example itself works, not a re-typed stand-in.
