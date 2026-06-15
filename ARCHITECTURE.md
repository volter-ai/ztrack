# ztrack Architecture

ztrack is a local task tracker whose tickets close on **evidence, not prose**: an
agent files claims, and `ztrack check` runs the rulebook — tickets that violate their
gates fail. This doc maps the pieces, the two validation surfaces, and how data flows.

> **TL;DR**
> - **Core contract** — `parse(markdown) → ONE strict Zod schema → pure rules(root, ctx) → { findings, export: root }`, reading issues through the universal `TrackerBackend` interface (sqlite or markdown, pluggable). The validated `root` **is** the export — there is no separate assembly step. Presets `default`, `spec`, `speckit` run on it.
> - **Snapshot validator** — what the `ztrack check` CLI runs today: the active preset (resolved by name, or by a repo-local `validation.entrypoint`) **exports a snapshot** of the store + world, then validates it with the preset's rulebook. The shipped `generic` preset (`presets/genericRuntime.ts`) implements this over the `backend/tracker-local.py` store.

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
| `core/registry.ts` | preset catalog (`default`, `spec`, `speckit`) resolved by name |
| `core/mutate.ts` | mutation affordances: parse → change one item → serialize → write + append audit |
| `core/audit.ts` | append-only audit log (`.audit.jsonl`); timestamps derived; `observeChanges` catches external edits |
| `core/gitWorld.ts` | builds `ctx.git` (commits, PR/branch heads) |
| `presets/default.ts`, `spec.ts`, `speckitCore.ts` | the strict schemas + mdast parsers + pure rules per SDLC |
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

## 3. Snapshot validator — what `ztrack check` runs

The CLI does not parse the store in-process; it resolves the active **preset runtime**
and asks it to export a snapshot and validate it. This keeps the rulebook pluggable per
deployment (swap the preset, keep the CLI).

| file | role |
|---|---|
| `presets.ts` | the `TrackerPresetRuntime` interface (parse/schema/diagnostics + `snapshot.{exportSnapshot, checkSnapshot}`) and shared helpers |
| `presets/genericRuntime.ts` | **`GENERIC_PRESET`** — the shipped runtime: reads the store via `backend/tracker-local.py`, builds a `TrackerSnapshot`, and checks acceptance criteria / evidence / sources |
| `presetRegistry.ts` | `resolveTrackerValidation(config)` → the named preset **or** a repo-local `validation.entrypoint` file |
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

A repo selects its rulebook with `validation.entrypoint` (a local file exporting a
`TrackerPresetRuntime`) or `organization.validationPreset` (a built-in name). The
`generic` preset is the day-one default.

---

## 4. Entry points

| entry | path |
|---|---|
| `ztrack` / `cli.ts` `check` | snapshot validator (export → check); `annotations validate` uses `worldAnnotations` |
| `mcp.ts` (`tracker_check`, …) | snapshot validator over MCP |
| `sdk.ts` `createTrackerClient` | backend-agnostic CRUD (`local` or `markdown`); writes via the backend; `tx.ts` re-checks |
| `server.ts` / `graphql.ts` | GraphQL over the backend (CRUD) |
| `core/cli.ts` | the core-contract `check` over a single issue file (engine demo / preset dev) |

---

## 5. World integration (optional)

ztrack can use a **mirrored world** of the SaaS systems your code talks to
(GitHub/Jira/Slack/…) as an evidence substrate, via the optional `@volter/twin` peer.

| file | role |
|---|---|
| `worldAnnotations.ts` | tracker annotations over twin events (`source`/`noise`/`duplicate`), quote-resolved into the event; stored at `.volter/world/<svc>/annotations.jsonl` |
| `worldSourceBooks.ts` | adapter: twin events → "source books" the snapshot consumes |

`@volter/twin` is an **optional** peer dependency. Without it installed, the core and
snapshot validators work over the store + git; the `annotations` command and world
source books are unavailable.

---

## 6. Do-not-confuse cheat sheet

- **The store is SQLite (`local`) or a markdown folder — never a SaaS.** GitHub/Jira/Slack are world sync spokes, not backends.
- **Two validation models:** the **core contract** (`core/engine.ts` + `default`/`spec`/`speckit`) has no snapshot — the "export" is just `check().export` (the validated Root). The **snapshot validator** (`check.ts` → preset `snapshot.checkSnapshot`) is what the CLI runs; it exports a monolithic snapshot, then checks it.
- **Two `mutate.ts`:** `mutate.ts` (snapshot-era AC mutation) ≠ `core/mutate.ts` (core affordances writing the store + audit).
- **`markdownModel.ts` re-exports `presets/issueMarkdown.ts`** — the same lenient issue-markdown model under both names.
