# ztrack Architecture

ztrack is a local task tracker whose tickets close on **evidence, not prose**: an
agent files claims, and `ztrack check` runs the rulebook — tickets that violate their
gates fail. This doc maps the pieces of the single validation pipeline and how data flows.

> **TL;DR**
> - **One typed pipeline.** Validation is a single pass: a loader reads issue markdown and, through the active preset's `loadContext`, gathers that preset's observed facts into a typed `Context`; the preset parses markdown to an mdast-backed `root`; `ValidationInputSchema.parse({ context, root })` types the whole input; pure rules run; the validated `root` **is** the export. There is no separate snapshot model assembled after validation.
> - **One impure boundary.** `src/core/loader.ts` is the only place that does I/O (tracker backend, git, time). Everything downstream — schema, rules, export — is pure and operates over the typed `Context` and `root`.
> - **One installed preset.** `ztrack init` writes `.volter/tracker/validation/preset.cjs = createGenericPreset({...})`, a real core `Preset` (mdast parse + strict Zod schema + pure rules) editable with no build step. `ztrack check`/`init` run that preset through the same pipeline.

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

**Contract:** `loadValidationInput → preset.parse (mdast → root) → ValidationInputSchema.parse({ context, root }) → pure rules → { ok, findings, export: root }`. There is ONE top-level strict schema, `ValidationInputSchema = z.object({ context: CoreContextSchema, root: RootSchema }).strict()` (built by `makeValidationInputSchema`), that types the entire validation input. The validated `root` **is** the export — validation and "export" are one pass; there is no separate snapshot/assembly step. That export is what the CLI, visualizer, SDK, and audit/attestation all consume.

The `root` is **multi-issue** — `Root { issues: Issue[] }` — so cross-issue rules (duplicate issue ids, relation/dependency consistency) run over the whole tracker in the same pass.

| file | role |
|---|---|
| `core/loader.ts` | the **only impure boundary**: reads issue markdown from the backend, frames issues into one bundle, then calls the active preset's `loadContext` to gather its observed facts and overlays the universal run selectors (`now`/`phase`/`categories`) into the typed `Context` |
| `core/bundle.ts` | `buildIssueBundle` — frames every issue into ONE markdown bundle (`===ISSUE <id>===` envelope) the preset parses |
| `core/engine.ts` | the contract: `Preset { name, schema, parse, rules, loadContext?, contextSchema?, primitives?, scaffold? }`, `check(preset, markdown, ctx)` and `checkRoot(preset, root, ctx)`, the strict `ValidationInputSchema`/`makeValidationInputSchema`, `Rule.run = (input: ValidationInput) => Finding[]` (pure — no I/O, git, time, raw markdown; optional `category`/`depth`), returning `{ ok, findings, export: root }` |
| `core/registry.ts` | internal reference catalog resolved by name |
| `core/mutate.ts` | mutation affordances: parse → change one item → serialize → write + append audit |
| `core/audit.ts` | append-only audit log (`.audit.jsonl`); timestamps derived; `observeChanges` catches external edits |
| `core/gitWorld.ts` | preset-agnostic git facts (commits, PR/branch heads) a preset's `loadContext` calls — it knows nothing about any preset's schema |
| `core/ref.ts` | universal node addressing: the derived colon-delimited id (`issue`/`issue:ac`/`issue:ac:evidence`/`issue:ac:proof`) used by cross-tree references like blocking |
| `core/blocking.ts` | the unified blocking graph — a derived projection over the root that folds AC `blocked-by`/`blocks` and issue `relations` (every direction and level) into one dependency DAG; powers cycle detection, the out-of-order completion gate, and the transitive blocked/actionable view (`blockStatuses`) |
| `presets/default.ts`, `spec.ts`, `speckitCore.ts` | internal/reference strict schemas + mdast parsers + pure rules per SDLC |
| `backends/markdown.ts` | canonical-issue ⇄ markdown (de)serializer |
| `backends/markdownBackend.ts` | the `markdown` peer `TrackerBackend` (issue verbs over the `.md` store) |
| `backends/markdownPort.ts` | lossless SQLite→markdown port + round-trip proof |
| `presets/issueMarkdown.ts`, `markdownModel.ts` | the lenient issue-markdown parser/model (mdast tree-walk); `markdown-model` re-exports it |
| `acVersion.ts` | content-hash of an acceptance criterion (`AC-Version`) for freshness/anchoring |

**Validate flow:**
```
loader.loadValidationInput(backend, preset)  (impure: backend read + frame bundle)
  → buildIssueBundle(issues)                  (===ISSUE <id>=== envelope)
  → ctx = preset.loadContext({ projectRoot, bundle })  (preset-owned: git/world/services)
          + universal { now, phase, categories }
  → check(preset, bundle, ctx)
     → preset.parse  (mdast → root)
     → ValidationInputSchema.parse({ context, root })   (one strict top-level schema)
     → rules.run(input)                       (pure; read git/world from input.context)
  → { findings, export: root }                ← the validated root IS the export; no snapshot
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

## 3. The installed preset — what `ztrack check` runs

`ztrack check` and `ztrack init` run **the** pipeline from §2 against the live tracker.
The active rulebook is the repo-local `.volter/tracker/validation/preset.cjs` that init
writes:

```js
module.exports = require('ztrack/preset-kit').createGenericPreset({
  name, requireSourceMarker, requireSdlcGates, requireSpecSections, requireSpeckitSections,
})
```

This is a **real core `Preset`** — mdast parse + strict Zod schema + pure rules — not a
separate runtime. It is editable with no build step.

| file | role |
|---|---|
| `presetKit.ts` | exports `createGenericPreset({...})` → a core `Preset<CoreRoot>` |
| `presetRegistry.ts` | `resolveTrackerValidation(config)` loads the repo-local `validation.entrypoint` file and returns a `Preset<CoreRoot>`; missing or legacy-only configs fail with init guidance |
| `core/loader.ts` | the impure boundary that builds the typed `Context` from backend + world + git + time |
| `core/bundle.ts` | `buildIssueBundle` — frames issues into the `===ISSUE <id>===` markdown bundle |
| `export.ts` | `exportTrackerRoot()` → runs the pipeline and emits the validated `root` |
| `check.ts` | `checkTracker()` / `checkTrackerRoot()` → run the active preset's rulebook |
| `cliCheck.ts` | the `check` / `export` CLI dispatch |
| `checkRules.ts` | the category/depth **types** for the `--categories` selector |
| `blobStore.ts`, `attest.ts`, `dsse.ts` | evidence blobs + in-toto/DSSE attestation over a validated root |
| `lint.ts` | issue-body lint (structure warnings) — write-side, see §6 |
| `mutate.ts`, `tx.ts` | AC mutation + multi-edit transaction (apply → re-check → revert if worse) — write-side, see §6 |

**Validate flow (what `ztrack check` does):**
```
cli.ts → cliCheck (check)
  → checkTracker()                     (loader builds Context from backend + world + git)
     → preset.parse → ValidationInputSchema.parse → pure rules
  → { ok, findings, export: root }     (the validated root)
  → exit 0/1
```

`ztrack check` validates the live tracker; flags: `--input root.json` (validate a
committed validated root instead of the live store), `--verify-commits`,
`--categories name=N,...`, `--fail-on-warning`, `--errors-only`, `--json`, `--output`,
`--max-findings`. `ztrack export [--out f.json]` writes the validated root. The committed
CI artifact is exactly that validated root JSON (`{ issues: [...] }`), re-validated by
`ztrack check --input root.json`.

A repo selects its rulebook with `validation.entrypoint`. Legacy configs that only set
`organization.validationPreset` are rejected with migration guidance. The public init
presets are `basic`, `simple-sdlc`, `simple-spec`, and `speckit`; all four resolve to
`createGenericPreset({...})` and become editable repo-local presets after installation.

---

## 4. Entry points

| entry | path |
|---|---|
| `ztrack` / `cli.ts` `check` | the validator — runs the pipeline (loader → parse → schema → rules) over the live tracker |
| `ztrack export` | writes the validated `root` (`check().export`) to JSON |
| `mcp.ts` (`tracker_check`, …) | the validator over MCP |
| `sdk.ts` `createTrackerClient` | backend-agnostic CRUD (`local` or `markdown`); writes via the backend; `tx.ts` re-checks |
| `server.ts` / `graphql.ts` | GraphQL over the backend (CRUD) |
| `core/cli.ts` | the core-contract `check` over a single issue file (engine demo / preset dev) |
| `visualizer/` (`ztrack visualizer`) | standalone Bun web app over `check().export`; runs every `tracker/*.md` through its preset and renders issues, ACs, findings, and timestamps (read-only) |

> **Note** — `ztrack snapshot project-manager` is an **unrelated** feature: a PM status
> report generated from the backend. It is not part of validation and shares no code with
> the pipeline above.

---

## 5. World integration (optional)

ztrack can use a **mirrored world** of the SaaS systems your code talks to
(GitHub/Jira/Slack/...) as an evidence substrate, via the optional external
`@volter/twin` peer.

| file | role |
|---|---|
| `worldAnnotations.ts` | tracker annotations over twin events (`source`/`noise`/`duplicate`), quote-resolved into the event; stored at `.volter/world/<svc>/annotations.jsonl` |
| `worldSourceBooks.ts` | adapter: twin events → "source books" the loader feeds into `Context` |

`@volter/twin` is an **optional** peer dependency distributed through GitHub
Packages under `volter-ai`. Without it installed, the validation pipeline works
over the store + git. The world files are source-level adapter code, not default
npm exports; see `docs/WORLD-INTEGRATION.md` for registry setup before building a
world-backed preset.

---

## 6. Do-not-confuse cheat sheet

- **The store is SQLite (`local`) or a markdown folder — never a SaaS.** GitHub/Jira/Slack are world sync spokes, not backends.
- **Validation is one pipeline.** `core/engine.ts` (`check`/`checkRoot`) over the repo-local `createGenericPreset` preset is all there is; the "export" is just `check().export` (the validated `Root`). There is no separate snapshot model.
- **The write-side layer is not validation.** `mutate.ts`, `markdownModel.ts`, `lint.ts`, and `presets.ts`'s `parseRawIssueMarkdown`/`renderPresetCanonicalIssueMarkdown` edit/format issue bodies; the validation pipeline does not import them. Distinct from those, `core/mutate.ts` is the store + audit affordance (the engine's reference mutation path).
- **`markdownModel.ts` re-exports `presets/issueMarkdown.ts`** — the same lenient issue-markdown model under both names.
- **`ztrack snapshot project-manager`** is a backend PM status report, unrelated to validation — the only place "snapshot" appears in ztrack.
