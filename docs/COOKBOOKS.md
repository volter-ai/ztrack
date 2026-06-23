# ztrack Cookbooks

Cookbooks should teach one complete workflow at a time. Each one should be
copy-pasteable, deterministic, and honest about what ztrack can verify locally.

## Cookbook Map

| Cookbook | Audience | Shows | Status |
|---|---|---|---|
| Local red/green loop | Any first-time user | `init`, `issue create`, fake SHA failure, real SHA pass | Ready |
| Full dev cycle | Maintainers before release | packed install, realistic app, planning, implementation, review gate, rework, CI/MCP/SDK/clone validation | Ready in `demos/full-dev-cycle.sh` |
| Real project cycle | Release readiness | generated multi-package workspace, project-specific validation, review/rework/release, CI/MCP/SDK/clone validation | Ready in `demos/real-project-cycle.sh` |
| Existing repo adoption | Maintainers and agents | install, first issue, first gate, CI/MCP | Ready in `docs/ADOPTING.md` |
| Preset selection | Maintainers and agents | choosing `default`, `spec`, or `speckit` | Ready in `docs/PRESETS.md` |
| Installed preset shape | Teams with their own SDLC | editable standalone preset (own schema/parser/serialize/rules over the derived model) + repo-local edit path | Starter in `demos/installed-preset/` |
| CI validated-root gate | OSS maintainers | committed `.volter/root.json` + GitHub Action | Ready in `docs/EXAMPLES.md` |
| MCP agent loop | Agent users | `tracker_check`, evidence-first `tracker_patch` | Ready in `docs/EXAMPLES.md` |
| SDK/API integration | Tool builders | `createTrackerClient` issue CRUD | Ready in `demos/sdk-api/` |
| Visualize the tracker | Anyone reviewing state | `ztrack visualizer` web view of issues, ACs, findings | Ready (`ztrack visualizer`) |

## Local Red/Green Loop

This is the smallest demo that proves the core promise: a checked acceptance
criterion that cites a fabricated commit fails; the same criterion with a real
commit and evidence passes.

From this repository:

```bash
bash demos/local-red-green.sh
```

The demo creates a temporary git repository, initializes ztrack with `default`,
creates one issue, runs a red check whose evidence cites `commit: deadbee`, then
edits the issue to cite the real temp-repo commit and runs a green check.

Expected shape:

```text
red exit: 1
red finding: evidence_commit_not_found
green exit: 0
green status: pass
```

## Fresh Project Dry Run

For a quick package-level confidence check, run:

```bash
bash demos/fresh-project-dry-run.sh
```

It packs the current checkout, installs that tarball into new temporary
projects, and proves:

- all three public presets produce a fake-SHA failure and real-SHA pass;
- the committed validated-root CI gate works with `--verify-commits`;
- the MCP server can initialize, create an issue, patch an AC, and return a
  passing `tracker_check` report;
- the SDK can create, view, and list issues through `createTrackerClient`.

## Full Dev Cycle

Before publishing a release, run the full lifecycle demo:

```bash
bash demos/full-dev-cycle.sh
```

It builds a realistic temporary library project, creates several implementation
commits, installs ztrack from the packed tarball, adopts `default`, creates
four issues with evidence and proof, blocks a premature Done transition,
proves one fake-SHA failure, fixes it, exports a CI validated root, exercises SDK
and MCP access, commits the intended adoption files, clones the project fresh,
and validates the committed root from that clone.

## Real Project Cycle

For release readiness, run the heavier project exercise:

```bash
bash demos/real-project-cycle.sh
```

It generates a multi-package `northwind-ops` workspace with inventory, API,
admin, docs, runbooks, ADRs, and Node tests. It installs ztrack from the packed
tarball, adopts `default`, edits the installed preset to add a
project-specific API rollout rule, creates four issues, exercises planning,
implementation, review, rework, custom-rule failure, fake-SHA failure, release
validated root, SDK, MCP, committed workflow files, and a fresh clone validation.

## Visualize The Tracker

For a read-only web view of the tracker instead of CLI output, run the
visualizer (requires [Bun](https://bun.sh); the first run installs its client
dependencies once):

```bash
ztrack visualizer                 # default preset, http://localhost:3300
ztrack viz --preset speckit --port 4000 --project /path/to/repo
```

It runs every `tracker/*.md` (or, under `speckit`, every `specs/<slug>/` feature
dir) through the same core as `check`, then renders issues, acceptance-criteria
progress, findings, and audit-derived timestamps. It validates live on each
request, so the board reflects exactly what `ztrack check` would enforce — it
does not write to the tracker. See [the visualizer README](../visualizer/README.md).

## Cookbook Rules

- Prefer commands that can run in a fresh temp directory.
- Show the failing case before the passing case when the workflow is about a
  gate.
- Include the exact finding code users should see.
- Avoid SaaS credentials in baseline demos; keep GitHub/Linear/Jira examples as
  optional integrations.
- If a cookbook depends on git, create a real local commit in the script.
- If a cookbook marks an AC passed, include both a commit citation and an
  evidence row.

## Next Demos To Add

1. Expand `demos/installed-preset/` with a live-store loader and tests.
