# ztrack Architecture

ztrack is a local task tracker whose tickets close on **evidence, not prose**: an
agent files claims, and `ztrack check` runs the rulebook — tickets that violate their
gates fail. This doc maps the pieces of the single validation pipeline and how data flows.

> **TL;DR**
> - **One typed pipeline.** Validation is a single pass: a loader reads issue markdown and, through the active preset's `loadContext`, gathers that preset's observed facts into a typed `Context`; the preset parses markdown to an mdast-backed `root`; `ValidationInputSchema.parse({ context, root })` types the whole input; pure rules run; the validated `root` **is** the export. There is no separate snapshot model assembled after validation.
> - **One impure boundary.** `src/core/loader.ts` is the only place that does I/O (tracker backend, git, time). Everything downstream — schema, rules, export — is pure and operates over the typed `Context` and `root`.
> - **Presets are standalone — there is NO universal model.** Each preset (`default`/`spec`/`speckit`) brings its OWN strict schema, its OWN markdown parser, and its OWN rules. They share **no schema, no parser, and no rule set** with each other. The only shared layer is the engine *mechanism* (`core/engine.ts`: the minimal `CoreRoot` contract + the `Rule`-record evaluation / derived model) plus generic dev utilities (mdast, zod) and types. `ztrack init` installs the chosen preset's real, editable source. There is **no generic/universal preset factory, no shared parser or schema, no flag-toggled mega-preset, and no shared "rule library" presets compose from** — those are the legacy this architecture exists to forbid (see the invariant in §3).

---

## 1. The data store

Issues live in a **local markdown store** — one `.md` per issue:

| backend | where | what |
|---|---|---|
| `markdown` (only) | `.volter/tracker/markdown/<id>.md` | one `.md` per issue: frontmatter metadata + body + `<!--tracker:comments-->` |

It is gitignored local runtime state, pure JS (`backends/markdownBackend.ts`, with
`markdown.ts` as the (de)serializer). The former Python/SQLite `local` backend was
removed; projects still on it run `ztrack migrate-local` once (reads the old
`tracker.sqlite` and rewrites each issue as markdown). The store is **not** a SaaS —
external systems sync through the worlds pipeline (see §5), never as live backends.

---

## 2. Core contract

**Contract:** `loadValidationInput → preset.parse (mdast → root) → ValidationInputSchema.parse({ context, root }) → pure rules → { ok, findings, export: root }`. There is ONE top-level strict schema, `ValidationInputSchema = z.object({ context: CoreContextSchema, root: RootSchema }).strict()` (built by `makeValidationInputSchema`), that types the entire validation input. The validated `root` **is** the export — validation and "export" are one pass; there is no separate snapshot/assembly step. That export is what the CLI, visualizer, SDK, and audit/attestation all consume.

The `root` is **multi-issue** — `Root { issues: Issue[] }` — so cross-issue rules (duplicate issue ids, relation/dependency consistency) run over the whole tracker in the same pass.

| file | role |
|---|---|
| `core/loader.ts` | the **only impure boundary**: reads issue markdown from the backend, frames issues into one bundle, then calls the active preset's `loadContext` to gather its observed facts and overlays the universal run selectors (`now`/`phase`/`categories`) into the typed `Context` |
| `core/bundle.ts` | `buildIssueBundle` — frames every issue into ONE markdown bundle (`===ISSUE <id>===` envelope) the preset parses |
| `core/engine.ts` | the contract: `Preset { name, schema, parse, serialize?, rules, loadContext?, contextSchema?, derive?, isIssueDone?, primitives?, scaffold? }`, `check(preset, markdown, ctx)` and `checkRoot(preset, root, ctx)`, the strict `ValidationInputSchema`/`makeValidationInputSchema`, `Rule.run = (input: ValidationInput) => Finding[]` (pure — no I/O, git, time, raw markdown; optional `category`/`depth`), returning `{ ok, findings, export: root }` |
| `modelEdit.ts` | the one mutation: parse → overlay a typed fragment → re-validate → the preset's `serialize` (`ac patch`/`issue patch`/`tracker_patch`). No universal write-grammar. |
| `core/audit.ts` | append-only audit log (`.audit.jsonl`); timestamps derived; `observeChanges` catches external edits |
| `core/gitWorld.ts` | preset-agnostic git facts (commits, PR/branch heads) a preset's `loadContext` calls — it knows nothing about any preset's schema |
| `core/ref.ts` | universal node addressing: the derived colon-delimited id (`issue`/`issue:ac`/`issue:ac:evidence`/`issue:ac:proof`) used by cross-tree references like blocking |
| `core/blocking.ts` | the unified blocking graph — a derived projection over the root that folds AC `blocked-by`/`blocks` and issue `relations` (every direction and level) into one dependency DAG; powers cycle detection, the out-of-order completion gate, and the transitive blocked/actionable view (`blockStatuses`) |
| `boilerplates/presets/{simple-sdlc,simple-gh-sdlc,spec,speckit}.ts` | the standalone reference presets — each its OWN strict schema + mdast parser + serialize + pure rules per SDLC; installed verbatim as `preset.mts` |
| `backends/markdown.ts` | canonical-issue ⇄ markdown (de)serializer |
| `backends/markdownBackend.ts` | the `markdown` peer `TrackerBackend` (issue verbs over the `.md` store) |
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
The active rulebook is the repo-local preset that init installs — the chosen preset's own
real, editable source.

> **INVARIANT — presets are standalone; there is NO universal model.**
> A preset is a self-contained `Preset { name, schema, parse, rules, ... }`: its OWN strict
> Zod schema, its OWN mdast parser, its OWN rules. `default`, `spec`, and `speckit` share
> NONE of these with each other — only the engine *mechanism* (`core/engine.ts`: the minimal
> `CoreRoot` contract + `Rule`-record evaluation).
>
> **The `CoreRoot` contract is the SPINE.** It's the minimal shared shape (`issues >
> acceptanceCriteria > evidence` + a `status` string) that every preset plugs into and the
> engine evaluates over — the one thing that *must* be shared for the system to cohere. The
> spine is thin on purpose. The test for "does this belong in core?": it belongs ONLY if it's
> structural spine the engine needs to link presets together. A full schema, a parser, or a
> rule set is per-preset flesh that hangs off the spine — putting any of it in the shared
> layer is "thickening the spine," which is exactly the universal-model anti-pattern.
> **Forbidden** (this is the legacy that keeps getting reintroduced): a shared
> universal schema or parser, a generic preset factory that emits N presets from flags, a
> shared "rule library" a preset picks records from (`rules: [...sharedGroup]`), or any
> "universal model" presets extend. A shared rule menu or a shared parser is the same
> anti-pattern in new syntax. If you reach for one, stop and author the preset's own.

```ts
// A standalone preset imports ONLY the engine mechanism + dev utilities — never a shared model.
import { z, rule, gitWorld, type Preset } from 'ztrack/preset-kit';
const MyRootSchema = z.object({ issues: z.array(MyIssueSchema) }).strict(); // this preset's OWN schema
function parseMine(bundle: string): unknown { /* this preset's OWN mdast parser → MyRootSchema shape */ }
function serializeMine(root): string { /* the declared inverse of parseMine */ }
const MyPreset: Preset<MyRoot> = {
  name: 'default', schema: MyRootSchema, parse: parseMine, serialize: serializeMine,
  rules: [ rule({ code, select, when, message }) /* this preset's OWN rules */ ],
};
export default MyPreset;
```

It is editable with no build step (installed as `.mts`). The reference standalone presets
(the bar) are `boilerplates/presets/{simple-sdlc,simple-gh-sdlc,spec,speckit}.ts` — each with its own schema,
parser, serialize, and rules.

| file | role |
|---|---|
| `presetKit.ts` | the public `ztrack/preset-kit` mechanism a standalone preset imports (engine `check`/`rule`, mdast helpers, `gitWorld`, root-schema constructor, types) — no shared model |
| `presetRegistry.ts` | `resolveTrackerValidation(config)` loads the repo-local `validation.entrypoint` file (the installed `preset.mts`) and returns its `Preset`; missing or legacy-only configs fail with init guidance |
| `core/loader.ts` | the impure boundary that builds the typed `Context` from backend + world + git + time |
| `core/bundle.ts` | `buildIssueBundle` — frames issues into the `===ISSUE <id>===` markdown bundle |
| `export.ts` | `exportTrackerRoot()` → runs the pipeline and emits the validated `root` |
| `check.ts` | `checkTracker()` / `checkTrackerRoot()` → run the active preset's rulebook |
| `cliCheck.ts` | the `check` / `export` CLI dispatch |
| `checkRules.ts` | the category/depth **types** for the `--categories` selector |
| `blobStore.ts`, `attest.ts`, `dsse.ts` | evidence blobs + in-toto/DSSE attestation over a validated root |
| `lint.ts` | issue-body lint (structure warnings) — write-side, see §6 |
| `modelEdit.ts`, `tx.ts` | AC mutation + multi-edit transaction (apply → re-check → revert if worse) — write-side, see §6 |

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
presets are `default`, `spec`, and `speckit`; each is a standalone preset (its own schema,
parser, serialize, rules) installed as an editable repo-local `preset.mts`.

---

## 4. Entry points

| entry | path |
|---|---|
| `ztrack` / `cli.ts` `check` | the validator — runs the pipeline (loader → parse → schema → rules) over the live tracker |
| `ztrack export` | writes the validated `root` (`check().export`) to JSON |
| `mcp.ts` (`tracker_check`, …) | the validator over MCP |
| `sdk.ts` `createTrackerClient` | issue CRUD over the markdown backend; writes via the backend; `tx.ts` re-checks |
| `server.ts` / `graphql.ts` | GraphQL over the backend (CRUD) |
| `visualizer/` (`ztrack visualizer`) | standalone Bun web app over `check().export`; runs every `tracker/*.md` through its preset and renders issues, ACs, findings, and timestamps (read-only) |

### Module format (ESM-first)

ztrack is published as **ESM** (`"type": "module"`); every library subpath
(`ztrack/check`, `ztrack/sdk`, `ztrack/export`, `ztrack/mcp`, …) is an ES
module. Consume it with `import`, or — from a CommonJS file — with **dynamic
`await import('ztrack/check')`**, which works on every Node ≥ 12 (including under Yarn PnP).
We deliberately do **not** ship a CommonJS build of the whole library: ztrack's parser deps
(`mdast-*`) are ESM-only, so a CJS build would have to *bundle* each subpath self-contained
(~17× the package), and `import()` already covers CJS callers correctly.

The installed preset is `.volter/tracker/validation/preset.mts` — an ES module that imports
`ztrack/preset-kit`. The `.mts` extension means it loads under Node's type-stripping even
inside a CommonJS consumer repo, so it works on Node ≥ 24 across npm, pnpm, yarn (classic +
Berry + PnP), and bun with no build step.


---

## 5. World integration (optional)

ztrack can use a **mirrored world** of the SaaS systems your code talks to
(GitHub/Jira/Slack/...) as an evidence substrate, via the
`@volter-ai-dev/twin` runtime (the same engine behind `ztrack sync github`).

| file | role |
|---|---|
| `worldAnnotations.ts` | tracker annotations over twin events (`source`/`noise`/`duplicate`), quote-resolved into the event; stored at `.volter/world/<svc>/annotations.jsonl` |
| `worldSourceBooks.ts` | adapter: twin events → "source books" the loader feeds into `Context` |
| `sync/<provider>/` | two-way issue sync (e.g. `sync/github/`: `execute`/`map`/`bindings`/`sync`). A **standalone provider module** — ztrack has no universal sync engine; the twin is the shared event-sourced substrate that makes pull/push incremental + idempotent. `ztrack sync github` is the user surface; identity bindings live at `.volter/sync/<provider>.json` |

`@volter-ai-dev/twin` (+ `@volter-ai-dev/twin-github`) is a regular dependency on
the public npm registry — bundled into the CLI and installed with the package, so
sync and world-backed validation work with no extra step. World integration is
still opt-in by *policy*: a baseline tracker validates over the store + git and
never consults the world. The adapters are reachable from the
`ztrack/world-annotations` / `ztrack/world-source-books` subpaths; see
`docs/WORLD-INTEGRATION.md`.

---

## 6. Do-not-confuse cheat sheet

- **The store is a local markdown folder — never a SaaS.** GitHub/Jira/Slack are world sync spokes, not backends.
- **Validation is one pipeline.** `core/engine.ts` (`check`/`checkRoot`) over the repo-local standalone `preset.mts` is all there is; the "export" is just `check().export` (the validated `Root`). There is no separate snapshot model.
- **The write-side layer is not validation.** `modelEdit.ts` (parse → edit the typed model → the preset's `serialize` — the one mutation path), `markdownModel.ts`, and `lint.ts` edit/format issue bodies; the validation pipeline does not import them.
- **`markdownModel.ts` re-exports `presets/issueMarkdown.ts`** — the same lenient issue-markdown model under both names.
