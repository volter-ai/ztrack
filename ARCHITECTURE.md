# ztrack Architecture

ztrack is a local task tracker whose tickets close on **evidence, not prose**: an
agent files claims, and `ztrack check` runs the rulebook — tickets that violate their
gates fail. This doc maps the pieces, the two validation surfaces, and how data flows.

> **TL;DR**
> - **Installed preset runtime** — what `ztrack check` runs in normal repos. `ztrack init --preset basic|simple-sdlc|simple-spec|speckit` copies an editable runtime to `.volter/tracker/validation/preset.cjs`; the config points at that local file through `validation.entrypoint`.
> - **Core contract** — the internal/reference shape for richer SDLC engines: `parse(markdown) → ONE strict Zod schema → pure rules(root, ctx) → { findings, export: root }`, reading issues through the universal `TrackerBackend` interface (sqlite or markdown, pluggable). The validated `root` **is** the export — there is no separate assembly step.

---

## 1. The data store

Issues live in a **local store**, selected by `backend` in `.volter/tracker-config.json`:

| backend | where | what |
|---|---|---|
| `local` | `.volter/tracker/tracker.sqlite` (a Python program, `backend/tracker-local.py`) | SQLite rows: body markdown + metadata columns + comments |
| `markdown` | `.volter/tracker/markdown/<id>.md` | one `.md` per issue: frontmatter metadata + body + `<!--tracker:comments-->` |

Both are gitignored local runtime state. They are **interchangeable peers**
(`TrackerBackend.command(args)`), emit identical JSON, and convert losslessly
(`backends/markdownPort.ts`). The store is **not** a SaaS — external systems sync
through the worlds pipeline (see §5), never as live backends.

---

## 2. Core contract

**Contract:** `parse(markdown) → candidate → strict-Zod schema → pure rules(root, ctx) → { ok, findings, export: root }`. The validated `root` **is** the export — validation and "export" are one pass; there is no separate snapshot/assembly step.

| file | role |
|---|---|
| `core/engine.ts` | the contract: `Preset { name, schema, parse, rules, primitives }`, `Context` (git + world), `check()` returning `{ findings, export: root }` |
| `core/registry.ts` | internal reference catalog resolved by name |
| `core/mutate.ts` | mutation affordances: parse → change one item → serialize → write + append audit |
| `core/audit.ts` | append-only audit log (`.audit.jsonl`); timestamps derived; `observeChanges` catches external edits |
| `core/gitWorld.ts` | builds `ctx.git` (commits, PR/branch heads) |
| `presets/default.ts`, `spec.ts`, `speckitCore.ts` | internal/reference strict schemas + mdast parsers + pure rules per SDLC |
| `backends/markdown.ts` | canonical-issue ⇄ markdown (de)serializer |
| `backends/markdownBackend.ts` | the `markdown` peer `TrackerBackend` (issue verbs over the `.md` store) |
| `backends/markdownPort.ts` | lossless SQLite→markdown port + round-trip proof |
| `presets/issueMarkdown.ts`, `markdownModel.ts` | the lenient issue-markdown parser/model (mdast tree-walk); `markdown-model` re-exports it |
| `acVersion.ts` | content-hash of an acceptance criterion (`AC-Version`) for freshness/anchoring |

**Core validate flow:**
```
loadIssues(backend) + loadWorld(.volter/world) + gitWorld()
  → check(preset, bundle, ctx)
     → preset.parse  (mdast → strict Zod schema)
     → preset.rules(root, ctx)            (pure; read git/world from ctx)
  → { findings, export: root }            ← the root IS the export; no snapshot
```

**Rule phases (`gate` vs `transition`).** A real SDLC enforces at two surfaces, and so
does the core: every `Rule` carries a `phase`, and `ctx.phase` selects which run.
- `transition` (heavy readiness/structure/promotion rules — section template, evidence
  anchoring, state→AC gates, approval chain, repo coverage): run only in phase `all`,
  i.e. when an issue is **written or promoted**. This is the strict, complete-standard pass.
- `gate` (everything else — true invariants and the light ongoing check: data integrity,
  source linking, cross-issue reconciliation): run on **every** check.

Splitting the two is deliberate: an always-on gate that also enforced the full
write-time standard would fail issues for historical/structural debt on every routine
check. `default` is `all` (strict). Canceled issues are blanket-exempt from
structural/completeness checks.

See `PRESET-GUIDE.md` for how to build or review a core preset.

---

## 3. Installed preset runtime — what `ztrack check` runs

The CLI does not parse the store in-process; it resolves the active **preset runtime**
and asks it to export a snapshot and validate it. In new repos this runtime is the
installed `.volter/tracker/validation/preset.cjs` file created by init.

| file | role |
|---|---|
| `presets.ts` | the `TrackerPresetRuntime` interface (parse/schema/diagnostics + `snapshot.{exportSnapshot, checkSnapshot}`) and shared helpers |
| `boilerplates/presets/preset.cjs` | template copied by `ztrack init --preset basic|simple-sdlc|simple-spec|speckit` |
| `presetRegistry.ts` | `resolveTrackerValidation(config)` → the repo-local `validation.entrypoint` file; missing or legacy-only configs fail with init guidance |
| `snapshotContract.ts` | the `TrackerSnapshot` + report Zod schemas (`tracker-snapshot`) |
| `export.ts` | `exportTrackerSnapshot()` → active preset's `snapshot.exportSnapshot` |
| `check.ts` | `checkTrackerSnapshot()` → active preset's `snapshot.checkSnapshot` |
| `cliSnapshot.ts` | the `check` / `snapshot export` CLI dispatch |
| `checkRules.ts` | rule-code classification (category/depth) |
| `blobStore.ts`, `attest.ts`, `dsse.ts` | evidence blobs + in-toto/DSSE attestation over a checked snapshot |
| `lint.ts` | issue-body lint (structure warnings) |
| `mutate.ts`, `tx.ts` | AC mutation + multi-edit transaction (apply → re-export → re-check → revert if worse) |

**Validate flow (what `ztrack check` does):**
```
cli.ts → cliSnapshot.handleSnapshotCommand(['check'])
  → exportTrackerSnapshot()            (assemble snapshot from backend + world + git)
  → checkTrackerSnapshot(snapshot)     (the active preset's rulebook)
  → exit 0/1
```

A repo selects its rulebook with `validation.entrypoint`, a local file exporting
a `TrackerPresetRuntime`. Legacy configs that only set
`organization.validationPreset` are rejected with migration guidance. The public
init presets are `basic`, `simple-sdlc`, `simple-spec`, and `speckit`; all four
become editable repo-local runtimes after installation.

---

## 4. Entry points

| entry | path |
|---|---|
| `ztrack` / `cli.ts` `check` | snapshot validator (export → check) |
| `mcp.ts` (`tracker_check`, …) | snapshot validator over MCP |
| `sdk.ts` `createTrackerClient` | backend-agnostic CRUD (`local` or `markdown`); writes via the backend; `tx.ts` re-checks |
| `server.ts` / `graphql.ts` | GraphQL over the backend (CRUD) |
| `core/cli.ts` | the core-contract `check` over a single issue file (engine demo / preset dev) |
| `visualizer/` (`ztrack visualizer`) | standalone Bun web app over the core export; runs every `tracker/*.md` through its preset and renders issues, ACs, findings, and timestamps (read-only) |

---

## 5. World integration (optional)

ztrack can use a **mirrored world** of the SaaS systems your code talks to
(GitHub/Jira/Slack/...) as an evidence substrate, via the optional external
`@volter/twin` peer.

| file | role |
|---|---|
| `worldAnnotations.ts` | tracker annotations over twin events (`source`/`noise`/`duplicate`), quote-resolved into the event; stored at `.volter/world/<svc>/annotations.jsonl` |
| `worldSourceBooks.ts` | adapter: twin events → "source books" the snapshot consumes |

`@volter/twin` is an **optional** peer dependency distributed through GitHub
Packages under `volter-ai`. Without it installed, the core and snapshot
validators work over the store + git. The world files are source-level adapter
code, not default npm exports; see `docs/WORLD-INTEGRATION.md` for registry
setup before building a world-backed installed preset.

---

## 6. Do-not-confuse cheat sheet

- **The store is SQLite (`local`) or a markdown folder — never a SaaS.** GitHub/Jira/Slack are world sync spokes, not backends.
- **Two validation models:** the **installed runtime path** (`check.ts` → preset `snapshot.checkSnapshot`) is what users get from `ztrack init`; it exports a monolithic snapshot, then checks it. The **core contract** (`core/engine.ts` plus internal reference presets) has no snapshot — the "export" is just `check().export` (the validated Root).
- **Two `mutate.ts`:** `mutate.ts` (snapshot-era AC mutation) ≠ `core/mutate.ts` (core affordances writing the store + audit).
- **`markdownModel.ts` re-exports `presets/issueMarkdown.ts`** — the same lenient issue-markdown model under both names.
