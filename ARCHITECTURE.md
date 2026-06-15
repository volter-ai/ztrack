# Tracker Architecture — current vs legacy

This package holds **two generations** of the tracker, mid-migration. This doc says what each piece is, which is **live**, and how data flows — so we stop conflating them.

> **TL;DR**
> - **CORE / current** — the target: `parse → ONE strict Zod schema → pure rules → { findings, export: root }`, reading issues through the universal `TrackerBackend` interface (sqlite or markdown, pluggable). The "export" is just the validated Root; there is **no snapshot**. Live for `default`/`spec`/`speckit`; `peak` is ported (`peakCore`), proven to **0-error gate-parity** with legacy, but **not yet wired into production validation**.
> - **LEGACY / authoritative today** — the original peak validator: `tracker check` **exports a snapshot** (assembled from the store + world) then validates it with the big `peakSnapshotCheck` rulebook. This is what gates production right now.
>
> _(A third, transitional **SPINE** generation — a faithful re-expression of the legacy peak rulebook over a neutral contract, used to shadow-diff the migration — was retired. Its lessons are captured in `SPINE-HARVEST.md`.)_

---

## 1. The data store (shared by all generations)

Issues live in a **local store**, selected by `backend` in `.volter/tracker-config.json`:

| backend | where | what | status |
|---|---|---|---|
| `local` | `.volter/tracker/tracker.sqlite` (a Python program, `backend/tracker-local.py`) | SQLite rows: body markdown + metadata columns + comments | **live default**; scales |
| `markdown` | `.volter/tracker/markdown/<id>.md` (parallel to the DB) | one `.md` per issue: frontmatter metadata + body + `<!--tracker:comments-->` | **peer backend, read-parity-proven** on the real corpus; easy/VCS-friendly while a project fits in memory |

Both are gitignored local runtime state. They are **interchangeable peers** (`TrackerBackend.command(args)`), emit identical JSON, and convert losslessly (`backends/markdownPort.ts`). The store is **not** GitHub; external systems sync through the worlds pipeline, not as live backends.

---

## 2. CORE / CURRENT (the target)

**Contract:** `parse(markdown) → candidate → strict-Zod schema → pure rules(root, ctx) → { ok, findings, export: root }`. The validated `root` **is** the export — validation and "export" are one pass; there is no separate snapshot/assembly step.

| file | role |
|---|---|
| `core/engine.ts` | the contract: `Preset { name, schema, parse, rules, primitives }`, `Context` (git + world), `check()` returning `{ findings, export: root }` |
| `core/registry.ts` | preset catalog (`default`, `spec`, `speckit`, `peak`) resolved by name |
| `core/mutate.ts` | mutation affordances: parse → change one item → serialize → write + append audit |
| `core/audit.ts` | append-only audit log (`.audit.jsonl`); timestamps derived; `observeChanges` catches external edits |
| `core/gitWorld.ts` | builds `ctx.git` (commits, PR/branch heads) |
| `presets/default.ts`, `spec.ts`, `speckitCore.ts`, `peakCore.ts` | the strict schemas + mdast parsers + pure rules per SDLC |
| `presets/peakLoad.ts` | impure loader: read `tracker/*.md` + the twin world → `Context`, run `checkPeak` (multi-issue root) |
| `backends/markdown.ts` | canonical-issue ⇄ markdown (de)serializer |
| `backends/markdownBackend.ts` | the `markdown` peer `TrackerBackend` (issue verbs over the `.md` store) |
| `backends/markdownPort.ts` | lossless SQLite→markdown port + round-trip proof |
| `worldAnnotations.ts` | the **sources feature**: tracker annotations over twin events (`source`/`noise`/`duplicate`), quote-resolves into the event; `.volter/world/<svc>/annotations.jsonl` |

**Core validate flow:**
```
peakLoad.loadIssues(.volter/tracker/markdown) + loadWorld(.volter/world) + gitWorld()
  → check(preset, bundle, ctx)
     → preset.parse (mdast → strict Zod schema)
     → preset.rules(root, ctx)            (pure; read git/world from ctx)
  → { findings, export: root }            ← the root IS the export; no snapshot
```
**Consumed by:** `packages/core-visualizer` (renders `resolvePreset` + `check` over `tracker/*.md`), `peakLoad`, and the preset tests. **Not yet** the production `tracker check`.

**Rule phases (`gate` vs `transition`).** A real SDLC enforces at two surfaces, and so
does core: every `Rule` carries a `phase`. `ctx.phase` selects which run.
- `transition` (heavy readiness/structure/promotion rules — section template, evidence
  anchoring, state→AC gates, approval chain, repo coverage, world-grounding
  *classification*): run only in phase `all`, i.e. when an issue is **written or
  promoted**. This is the strict, complete-standard validation.
- `gate` (everything else — true invariants + the light ongoing check: data integrity,
  source linking, cross-issue reconciliation): run on **every** check.

Legacy splits the same way (peak.ts section rules run at write-time; `peakSnapshotCheck`
is the narrow ongoing gate). Conflating them is why an early peakCore fired ~4861 errors
on the historical corpus where legacy's ongoing `check` fires 0. With phases:
**gate-phase = 0 errors on the real 207-case corpus, exact parity with legacy's ongoing
gate**; strict `all`-phase fires ~4810 — the real go-forward standard plus the historical
migration debt legacy never retro-applied. `runPeak({phase})` and `ctx.phase` choose;
default is `all` (strict). Canceled issues are blanket-exempt from structural/completeness
checks (mirrors legacy's `continue` on canceled).

See `PRESET-GUIDE.md` for how to build/review a core preset.

---

## 3. SPINE / TRANSITIONAL — RETIRED

The `spine/*` layer (a faithful re-expression of the legacy peak rulebook over a neutral
`spine@1` contract, used to shadow-diff the migration) has been **deleted**. It was legacy
in modular form, not a destination. Every rule/concern/scoping-nuance it encoded — and which
of those `peakCore` covers, must port, or correctly drops — is captured in **`SPINE-HARVEST.md`**.
The spine-only `speckit`/`openspec` presets went with it (`speckitCore` is the live speckit;
`openspec` was unused and dropped, not re-ported). `tracker check` is legacy-only again until
the `peakCore` flip lands.

---

## 4. LEGACY / AUTHORITATIVE TODAY

The original peak validator. **This is what gates production.** Its defining trait: it can't validate the live store directly — it **exports a snapshot** (a monolithic object: all cases + subcases + world + comments) and validates that.

| file | role |
|---|---|
| `presets/peak.ts`, `presets/peakMarkdown.ts`, `markdownModel.ts` | legacy peak issue parser + markdown model (regex/tree-walk; superseded by `peakCore`) |
| `presets/peakSnapshotExport.ts` | **the snapshot assembler** — reads issues from the backend (shells the CLI), maps to `TrackerSnapshot` (the validator's input) |
| `presets/peakSnapshotCheck.ts` | **the rulebook** — all peak gates/AC/evidence/source/stakeholder/thread rules over the snapshot (authoritative) |
| `presets/peakExport.ts`, `presets/peakRules.ts`, `presets/peakCheck.ts` | export hooks, legacy rule classification, gate helpers |
| `snapshotContract.ts` | the `TrackerSnapshot` + report Zod schemas |
| `check.ts` | dispatcher: `checkTrackerSnapshot(snapshot)` → legacy `peakSnapshotCheck` (default) or spine (shadow/opt-in) |
| `export.ts` | dispatcher: `exportTrackerSnapshot()` → `peakSnapshotExport` |
| `presetRegistry.ts`, `presets.ts` | legacy `PEAK_PRESET` runtime (parse/schema/render/export/check/hooks) |
| `tx.ts`, `mutate.ts` | legacy multi-edit transaction (apply → re-export → re-check → revert if worse) + snapshot-era AC mutation |
| `cliSnapshot.ts`, `checkRules.ts`, `cliEvidence.ts`, `lint.ts`, `blobStore.ts`, `attest.ts`, `dsse.ts`, `workGraph*.ts` | the `tracker check/snapshot` CLI dispatch, rule categories, evidence/blob/attestation, work-graph |
| `worldSourceBooks.ts` | adapter: twin events → "source books" the legacy snapshot consumes |

**Legacy validate flow (what `tracker check` does today):**
```
cli.ts → cliSnapshot.handleSnapshotCommand(['check'])
  → exportTrackerSnapshot()            → peakSnapshotExport  (assemble snapshot from backend + world + git)
  → checkTrackerSnapshot(snapshot)     → peakSnapshotCheck   (the rulebook; AUTHORITATIVE)
                                        ↘ spine shadow (non-authoritative diff)
  → exit 0/1
```
So **yes: legacy validate runs a snapshot export in the background, then checks it.** That export-then-check coupling is exactly what the core model removes (core's export = the validated Root).

---

## 5. Entry points — which path each uses

| entry | path today |
|---|---|
| `scripts/tracker` / `cli.ts` `check` | **legacy** (export snapshot → `peakSnapshotCheck`); `annotations validate` uses core `worldAnnotations` |
| `mcp.ts` (`tracker_check`, …) | **legacy** authoritative; spine optional/diagnostic |
| `sdk.ts` `createTrackerClient` | backend-agnostic CRUD (`local` or `markdown`); writes via the backend; `tx.ts` re-checks via legacy |
| `server.ts` / `graphql.ts` | GraphQL over the backend (CRUD) |
| `core-visualizer` (separate package) | **core** (`resolvePreset` + `check` over `tracker/*.md`) |
| autonomous runtime (PM / world-ingress / export / develop, via `scripts/tracker` + MCP) | **legacy** authoritative validate + backend writes; world-ingress writes core `worldAnnotations` |

---

## 6. Migration status (where each generation stands)

- **CORE is the target.** `default`/`spec`/`speckit` run on it. `peakCore` is a from-scratch port of the peak standards, adversarially reviewed and **proven** (world-integrity matches the legacy validator across all real services), with `peakLoad` reading real data — but it is **not yet wired into `tracker check`**. Wiring it (behind a flag) + a shadow-diff vs legacy on the real corpus is the remaining step to switch peak validation to core.
- **SPINE is transitional** scaffolding for the legacy→neutral port; it shadows legacy and will be subsumed by the core path.
- **LEGACY is authoritative** until the core peak path is wired and diffed clean. Don't "delete legacy" before that.

---

## 7. Do-not-confuse cheat sheet

- **The store is SQLite (`local`) or a markdown folder — never GitHub.** GitHub/Jira/Slack are world sync spokes, not backends.
- **"Snapshot" is legacy-only.** It's the monolithic object the legacy validator exports-then-checks. The CORE model has no snapshot; the "export" is just `check().export` (the validated Root), produced for free by parse→Zod→rules.
- **Two different "exports":** the legacy **snapshot export** (`peakSnapshotExport`, the validator's input) is *not* the `/export` **delivery** skill (delivering code downstream). This doc is about the former.
- **Two `peakRules.ts`:** `presets/peakRules.ts` (legacy rule classification) ≠ `spine/peakRules.ts` (ported spine rules).
- **Two registries:** `presetRegistry.ts` (legacy `PEAK_PRESET`) ≠ `core/registry.ts` (core presets) ≠ `spine/registry.ts` (spine presets).
- **Two `mutate.ts`:** `mutate.ts` (legacy, snapshot-era) ≠ `core/mutate.ts` (core affordances writing `tracker/*.md` + audit).
- **`peakCore.ts` / `peakLoad.ts` are CORE**, not legacy, despite living under `presets/`.
