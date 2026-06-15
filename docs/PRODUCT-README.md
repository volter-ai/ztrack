# ztrack

The verified task tracker for AI agents: a local SQLite-backed tracker whose
tickets close on evidence, not prose. Agents file claims; `ztrack check`
exports a snapshot of the store (plus optional `@volter/twin` world source books)
and runs the full rulebook — tickets that violate their gates fail the check.

## Quickstart

```bash
bunx ztrack init --team APP
bunx ztrack issue create --title "First issue"
bunx ztrack issue list
bunx ztrack check        # export the snapshot, run the rulebook
```

A case-labeled issue is validated through the configured validation entrypoint,
which provides a parser and Zod schema. The
current shipped checker still exposes compatibility category/profile selectors while
the rulebook migrates into installed validation files; new validation behavior
should be added to the entrypoint's schema, not to a parallel policy DSL. At the
day-one default, checking an AC without a commit SHA that exists in the repo, or
without matching PR evidence where required, produces errors and a non-zero
exit.

Project-file presets extend the same parser + Zod model to native file sets
such as Spec Kit, OpenSpec, Backlog.md, Kiro, Task Master, BMAD, or Beads
artifacts. The first Spec Kit parser/projection surface is available as an
experimental package export; full checker/CLI integration is still planned.
When a preset is initialized for a repo, tracker should scaffold editable
repo-local validation files under `.volter/tracker/validation/` and configure
normal commands to load that local entrypoint. Project-file presets validate
their native model and expose a common work graph centered on issues,
acceptance criteria, sources, scenarios, tasks, and evidence.

## Surface

- **CLI**: `init`, `issue` (create/list/view/edit/comment/close/relate),
  `project`, `label`, `search`, `api query` (GraphQL), `check`,
  `snapshot export`, `check`, and more — `ztrack --help`.
- **SDK**: `createTrackerClient()` — issues, projects, GraphQL, snapshots.
- **`ztrack/check`**: `checkTrackerSnapshot(snapshot,
  { projectRoot, config, issues, failOnWarning })` — the rulebook as a pure
  call over a snapshot; deployment context (the git repo used to verify
  SHAs, team conventions) enters via options. Returns a report shaped
  `{ summary: { status, findingCounts, … }, findings: [ … ] }` — the verdict and
  counts live under `report.summary`, the individual issues under `report.findings`
  (the CLI unwraps these for you). Malformed snapshots return a structured failing
  report (`snapshot_shape_invalid`), never a crash.
- **`ztrack/export`**: `exportTrackerSnapshot()` —
  tracker store + world source books → `tracker-snapshot@1` snapshot.
- **`ztrack/tracker-snapshot`**: the Zod snapshot schema.
- **`ztrack/markdown-model`**: the lenient issue-markdown parser.
- **`ztrack/presets`**: raw markdown parser and validation preset
  interface.
- **`ztrack/presets/generic`** / **`ztrack/presets/default`**: the shipped generic
  preset runtime (the day-one validation) and the conformant `default` core preset.
  Treat these as the starter/template for a repo-local preset; the target runtime
  contract is an editable file selected via `validation.entrypoint`, not a package
  preset chosen on every run.
- **`ztrack/presets/speckit`**: experimental Spec Kit file-set parser,
  native Zod model, and `ProjectGraph` projection; intended as boilerplate for
  repo-local installed validation files.
- **`ztrack/work-graph`**: Zod schemas and TypeScript types for the
  common `ProjectGraph` emitted by project-file presets.

## Notes

- Requires Python 3 at runtime (`backend/tracker-local.py`, the storage
  backend spawned by the SDK) and `bun`.
- Install `@volter/twin` alongside for world integration (declared as an optional peer).
- Config at `<project>/.volter/tracker-config.json` (`ztrack init` scaffolds
  it; directory name overridable via `VOLTER_STATE_DIR`). Repo-local validation
  is selected with `validation.entrypoint`; compatibility configs may still use
  `organization.validationPreset` while installed validation migration is in
  progress. Team conventions for the rulebook (linked-issue patterns, browse
  URL templates) live under the `organization` key.
