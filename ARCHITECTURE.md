# ztrack Architecture

ztrack is a local task tracker whose tickets close on **evidence, not prose**: an
agent files claims, and `ztrack check` runs the rulebook — tickets that violate their
gates fail. This doc maps the pieces of the single validation pipeline and how data flows.

> **TL;DR**
> - **One typed pipeline.** Validation is a single pass: a loader reads issue markdown and, through the active preset's `loadContext`, gathers that preset's observed facts into a typed `Context`; the preset parses markdown to an mdast-backed `root`; `ValidationInputSchema.parse({ context, root })` types the whole input; pure rules run; the validated `root` **is** the export. There is no separate snapshot model assembled after validation.
> - **One impure boundary — of the validation pipeline.** Within `check`/`checkRoot` (§2), `src/core/loader.ts` is the only place that does I/O (tracker backend, git, time); everything downstream — schema, rules, export — is pure and operates over the typed `Context` and `root`. This is a pipeline-scoped guarantee, not a whole-codebase one: real I/O also lives outside the pipeline, in `core/gitWorld.ts` (git via `execFileSync`, called BY a preset's `loadContext`, not by rules), and in the world adapters `worldAnnotations.ts`/`worldSourceBooks.ts` (read/write `.volter/world/**` via `node:fs`, §5) — all upstream of the pure schema/rules stage they feed.
> - **Presets are standalone — there is NO universal model.** Each preset (`simple-sdlc`/`simple-gh-sdlc`/`spec`/`speckit`) brings its OWN strict schema, its OWN markdown parser, and its OWN rules. They share **no schema, no parser, and no rule set** with each other. The only shared layer is the engine *mechanism* (`core/engine.ts`: the minimal `CoreRoot` contract + the `Rule`-record evaluation / derived model) plus generic dev utilities (mdast, zod) and types. `ztrack init` installs the chosen preset's real, editable source. There is **no generic/universal preset factory, no shared parser or schema, no flag-toggled mega-preset, and no shared "rule library" presets compose from** — those are the legacy this architecture exists to forbid (see the invariant in §3).

---

## 1. Data sources

Issues live in one or more declared **sources** — `.volter/tracker-config.json`'s
`sources: [{ path, format?, readonly? }]` (shape validated by `TrackerConfigSchema` in
`src/configSchema.ts`; resolved to absolute entries by `resolveSources` in
`src/sources.ts`). `sources` absent (the common case, and every project before this)
is byte-identical to the old implicit single store: one `issue-per-file` source at
`.volter/tracker/markdown/`.

| format | shape | where | what |
|---|---|---|---|
| `issue-per-file` (default) | a DIRECTORY | `.volter/tracker/markdown/<id>.md`, or any declared `path` | one `.md` per issue: frontmatter metadata + body + `<!--tracker:comments-->` |
| `document` | a single markdown FILE | any declared `path` ending in `.md` | many issues decomposed from one file's heading tree (`documentParser.ts`): an id-bearing heading becomes an issue, heading nesting becomes parent/children links, a leading `Title:`/`Status:`/`Assignee:` preamble becomes an umbrella issue owning the top-level items |

`backends/markdownBackend.ts`'s `MarkdownBackend` dispatches each resolved source by
`format` — `issue-per-file` to its `MarkdownSource`, `document` to
`backends/documentSource.ts`'s `DocumentSource` — and unions every source's issues by
id; both classes implement the same `IssueSource` contract (`backends/issueSource.ts`),
so everything above them (`issue list`/`view`, GraphQL, the loader) is format-agnostic.
The same id defined in two *different* sources is a data error, never silent
precedence: `ztrack check` reports an `issue_id_conflict` finding
(`core/engine.ts`'s `crossSourceConflicts`) naming every conflicting path. A source
declared `readonly: true` accepts reads but fails closed on every write — a `document`
source additionally fails closed on any write outside its own body/title (state,
assignee, labels, parent, children, comments, the umbrella record itself — see
`documentWriteBack.ts`).

Every issue record carries its **origin** — the file it was read from, plus (for a
`document` source) the line span of its section within that file
(`core/engine.ts`'s `IssueRecord.origin { path, lineStart?, lineEnd? }`) — so findings
can cite exactly where on disk they came from (see §2's Validate flow).

The default source is gitignored local runtime state, pure JS
(`backends/markdownBackend.ts`, with `markdown.ts` as the (de)serializer for
`issue-per-file`; `documentParser.ts` + `backends/documentSource.ts` +
`documentWriteBack.ts` for `document`). A declared source can point anywhere in the
repo — e.g. a `document` source is typically a checked-in spec file, not gitignored
runtime state. The former Python/SQLite `local` backend was removed; projects still on
it run `ztrack migrate-local` once (reads the old `tracker.sqlite` and rewrites each
issue as markdown). A source is **not** a SaaS — external systems sync through the
worlds pipeline (see §5), never as live backends. See `docs/SOURCES.md` for the full
declared-sources reference.

---

## 2. Core contract

**Contract:** `loadValidationInput → preset.parse (mdast → root) → ValidationInputSchema.parse({ context, root }) → pure rules → { ok, findings, export: root }`. There is ONE top-level strict schema, `ValidationInputSchema = z.object({ context: CoreContextSchema, root: RootSchema }).strict()` (built by `makeValidationInputSchema`), that types the entire validation input. The validated `root` **is** the export — validation and "export" are one pass; there is no separate snapshot/assembly step. That export is what the CLI, visualizer, SDK, and audit/attestation all consume.

The `root` is **multi-issue** — `Root { issues: Issue[] }` — so cross-issue rules (duplicate issue ids, relation/dependency consistency) run over the whole tracker in the same pass.

| file | role |
|---|---|
| `core/loader.ts` | the **only impure boundary of the validation pipeline itself** (schema/rules/export stay pure downstream of it): reads issue markdown from the backend, frames issues into one bundle, then calls the active preset's `loadContext` to gather its observed facts and overlays the universal run selectors (`now`/`phase`/`categories`) into the typed `Context`. Real I/O also happens upstream of this stage in `core/gitWorld.ts` and the world adapters (see their rows below and §5) — `loader.ts` is the boundary FOR the pipeline, not the only I/O in the codebase |
| `core/bundle.ts` | `buildIssueBundle` — frames every issue into ONE markdown bundle (`===ISSUE <id>===` envelope) the preset parses |
| `core/engine.ts` | the contract: `Preset { name, schema, parse, serialize?, rules, loadContext?, contextSchema?, derive?, isIssueDone?, primitives?, scaffold? }`, `check(preset, records, ctx)` and `checkRoot(preset, root, ctx)`, the strict `ValidationInputSchema`/`makeValidationInputSchema`, `Rule.run = (input: ValidationInput) => Finding[]` (pure — no I/O, git, time, raw markdown; optional `category`/`depth`), returning `{ ok, findings, export: root }` |
| `modelEdit.ts` | the one mutation: parse → overlay a typed fragment → re-validate → the preset's `serialize` (`ac patch`/`issue patch`/`tracker_patch`). No universal write-grammar. |
| `core/audit.ts` | append-only audit log (`.volter/tracker/.audit.jsonl`, gitignored/per-clone); timestamps derived; `observeChanges` diffs a preset-validated snapshot against a baseline and logs each change. Driven from every write surface: one-shot CLI mutations (after the command, via `cliAudit.ts` — ztrack #19), the `mcp serve` and `api serve` servers (per write / per request — a single server process can't wait for exit), and the visualizer (per request, also catching edits made outside ztrack's affordances). Diff-based, so one central pass per caller suffices; concurrent observers serialize on a short advisory lock (`.audit.lock`, skip-on-contention) so a raced change is recorded once by the next observer, never duplicated |
| `core/gitWorld.ts` | preset-agnostic git facts (commits, PR/branch heads) a preset's `loadContext` calls — it knows nothing about any preset's schema. Does real I/O (`execFileSync('git', ...)`, `gitWorld.ts:10`) — one of the impure surfaces outside `core/loader.ts` noted above |
| `core/ref.ts` | universal node addressing: the derived colon-delimited id (`issue`/`issue:ac`/`issue:ac:evidence`/`issue:ac:proof`) used by cross-tree references like blocking |
| `core/blocking.ts` | the unified blocking graph — a derived projection over the root that folds AC `blocked-by`/`blocks` and issue `relations` (every direction and level) into one dependency DAG; powers cycle detection, the out-of-order completion gate, and the transitive blocked/actionable view (`blockStatuses`) |
| `boilerplates/presets/{simple-sdlc,simple-gh-sdlc,spec,speckit}.ts` | the standalone reference presets — each its OWN strict schema + mdast parser + serialize + pure rules per SDLC; installed verbatim as `preset.mts` |
| `backends/markdown.ts` | canonical-issue ⇄ markdown (de)serializer |
| `backends/markdownBackend.ts` | the `markdown` peer `TrackerBackend` (issue verbs over the `.md` store) |
| `markdownDocument.ts` | the lenient issue-markdown parser/model (mdast tree-walk) — read model for `lint`/`fmt` |
| `acVersion.ts` | content-hash of an acceptance criterion (`AC-Version`) for freshness/anchoring |
| `sources.ts` | `resolveSources(projectRoot, config)` — the source-resolution module: resolves the config's declared `sources` (or the implicit default) into absolute, format-checked `ResolvedSource` entries; `MarkdownBackend` uses these to pick `MarkdownSource` vs `DocumentSource` per entry (§1) |
| `backends/documentSource.ts` | `DocumentSource` — the `IssueSource` (`backends/issueSource.ts`) for a `document` source: parses the file into issues at construction, splices `body`/`title` writes back into each issue's recorded span, fails closed on every other field |
| `documentParser.ts` | the `document`-format parser: turns one markdown file's heading tree into many issues (id-bearing headings, parent/children nesting, a `Title:`/`Status:`/`Assignee:` preamble → umbrella issue) |
| `documentWriteBack.ts` | the splice primitives `DocumentSource.write` uses — `shiftHeadings` (renumber ATX headings inside a spliced section) and `decomposeSection`/`spliceSectionText` (byte-preserving section rewrite) |
| `testkit/presetConformance.ts` | shared preset-conformance test harness (`assertSdlcGrammarConformance`, `assertRoundTripFidelity`, …) each boilerplate preset's test file wires in: pins that an unmodified parse→serialize round trip is byte-identical and that an edit touches only the bytes its element owns |

**Validate flow:**
```
loader.loadValidationInput(preset, opts)     (impure: reads the tracker client)
  → config → resolveSources(config)           (declared sources, or the implicit default)
     → format dispatch per source: issue-per-file → MarkdownSource, document → DocumentSource
     → union every source's issues by id       (issue_id_conflict finding on a same-id collision)
  → records: IssueRecord[]                    (each carries origin: { path, lineStart?, lineEnd? })
  → buildIssueBundle(records)                  (===ISSUE <id>=== envelope)
  → ctx = preset.loadContext({ projectRoot, bundle })  (preset-owned: git/world/services)
          + universal { now, phase, categories }
  → check(preset, records, ctx)
     → preset.parse  (mdast → root)
     → ValidationInputSchema.parse({ context, root })   (one strict top-level schema)
     → rules.run(input)                       (pure; read git/world from input.context)
  → { findings, export: root }                ← findings carry origin; the validated root IS the export; no snapshot
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

See [docs/PRESETS.md § Building or extending a preset](docs/PRESETS.md#building-or-extending-a-preset-maintainers) for how to build or review a core preset.

---

## 3. The installed preset — what `ztrack check` runs

`ztrack check` and `ztrack init` run **the** pipeline from §2 against the live tracker.
The active rulebook is the repo-local preset that init installs — the chosen preset's own
real, editable source.

> **INVARIANT — presets are standalone; there is NO universal model.**
> A preset is a self-contained `Preset { name, schema, parse, rules, ... }`: its OWN strict
> Zod schema, its OWN mdast parser, its OWN rules. `simple-sdlc`, `simple-gh-sdlc`, `spec`, and
> `speckit` share NONE of these with each other — only the engine *mechanism* (`core/engine.ts`: the minimal
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
| `core/loader.ts` | the pipeline's impure boundary: builds the typed `Context` from backend + world + git + time — the schema/rules stage downstream of it stays pure. (The I/O itself is done by the modules it calls into, e.g. `core/gitWorld.ts`, `worldAnnotations.ts`, `worldSourceBooks.ts` — real impure surfaces of their own, upstream of the pure pipeline; see §2's TL;DR and §5.) |
| `core/bundle.ts` | `buildIssueBundle` — frames issues into the `===ISSUE <id>===` markdown bundle |
| `export.ts` | `exportTrackerRoot()` → runs the pipeline and emits the validated `root` |
| `check.ts` | `checkTracker()` / `checkTrackerRoot()` → run the active preset's rulebook |
| `cliCheck.ts` | the `check` / `export` CLI dispatch |
| `cliAudit.ts` | after a mutating CLI command, runs one `observeChanges` pass over the validated export → audit log (best-effort; `isMutatingCommand` classifies one-shot commands from argv, `isMutatingMcpTool` classifies MCP tool calls) |
| `cliWaiver.ts` | `waiver sign\|clear\|status\|migrate` — the eslint-`disable` escape. A `## Waivers` row (`code`, optional `ac:`, optional `ref:`, `reason`, `by:`) downgrades a matching `error` finding to `acknowledged`. `ref:` pins to ONE occurrence by its `Finding.subject`/`evidenceId` — the `// eslint-disable-next-line` form — so it can suppress only that occurrence and self-expires when the subject changes; an unpinned waiver that could pin is `waiver_overbroad`, one that matches nothing is `waiver_unused` (parse + apply live in `core/engine.ts`; `sign` auto-captures the ref, `migrate` rewrites legacy unpinned rows into per-occurrence pinned ones) |
| `checkRules.ts` | the category/depth **types** for the `--categories` selector |
| `attest.ts`, `dsse.ts` | in-toto/DSSE attestation over a validated root (`evidence export`/`keygen`/`verify`) — signs the validated `root`, not per-file blobs |
| `lint.ts` | issue-body lint (structure warnings) — write-side, see §6 |
| `modelEdit.ts`, `tx.ts` | AC mutation + multi-edit transaction (apply → re-check → revert if worse) — write-side, see §6 |

**Validate flow (what `ztrack check` does):**
```
cli.ts → cliCheck (check)
  → checkTracker()                     (loader resolves sources, unions issues by id,
                                         builds Context from world + git — see §2)
     → preset.parse → ValidationInputSchema.parse → pure rules
  → { ok, findings, export: root }     (the validated root; findings carry origin)
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
presets are `simple-sdlc`, `simple-gh-sdlc`, `spec`, and `speckit` (`default` is an alias for `simple-sdlc`); each is a standalone preset (its own schema,
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
| `ztrack import <path-or-glob>...` | materializes a freeform/mixed-markdown backlog into the strict document-source grammar in place, idempotently — see the import subsystem table below |
| `ztrack loop start\|stop\|status` | arms/disarms a loop-scoped Stop-hook gate that holds the agent's turn until a target passes `check --auto-scope` — see the loop / Stop-hook gate table below |

**Import subsystem** (`ztrack import`):

| file | role |
|---|---|
| `importDriver.ts` (285 LOC) | pure orchestration: expands files/directories/quoted globs into concrete `.md` files (default excludes: `node_modules`, `.volter`, any configured issue-per-file source dir), runs ONE batch-wide, single-pass id allocation across all inputs plus every already-configured tracker source, reports a per-file outcome. `--register` (opt-in) is the only thing that ever appends `sources` entries to `tracker-config.json` |
| `importBacklog.ts` (649 LOC) | the strict document-source materializer: plans + writes a freeform/mixed-markdown file into the document-source grammar (headings, parent/children nesting, checkbox ACs) idempotently; owns `IdAllocator`, the id-minting rule shared with `backends/markdownBackend.ts`'s mint path (one shared helper — see §2's id-minting note) |
| `cliImport.ts` (175 LOC) | CLI wiring only — flag parsing (`--dry-run`, `--prefix`, `--register`) + terminal rendering; all planning/materializing logic lives in `importBacklog.ts`/`importDriver.ts` |

**Loop / Stop-hook gate** (`ztrack loop`, `ztrack check --auto-scope`):

| file | role |
|---|---|
| `cliTarget.ts` | the unified check/loop TARGET grammar (`resolveTarget`): the same four shapes (`<issue-id>` / `<file.md>` / auto-resolve from branch-worktree / the whole tracker) drive both `ztrack check` and `ztrack loop start`; backs `check --auto-scope`'s fail-closed-when-unresolved mode |
| `loopState.ts` | the loop marker (`.ztrack-loop.json`) — the IPC between `ztrack loop start <target>` and the Stop-hook gate (`ztrack check --auto-scope`, run later in a separate process): records the resolved target, the iteration cap, and (optionally) the status the loop is driving toward |
| `cliLoop.ts` | `ztrack loop start\|stop\|status` — arms/disarms the loop-scoped gate (a ralph loop); while armed, the Stop hook holds the turn until the target passes `check --auto-scope` or the iteration cap trips |

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

`@volter-ai-dev/twin` (+ `@volter-ai-dev/twin-github`) is an **optional peer
dependency** on the public npm registry (since 0.38.0) — absent unless a consumer
installs it explicitly, and `@volter-ai-dev/twin-github` specifically only loads
under bun (its TS-only source can't type-strip from `node_modules` under plain
node/npx). Sync and world-backed validation need the explicit install plus the
bun-only invocation; see the canonical recipe at
[docs/GUIDE.md § GitHub sync since 0.38](docs/GUIDE.md#github-sync-since-038-install-the-peers-run-under-bun).
World integration is still opt-in by *policy* on top of that: a baseline tracker
validates over the store + git and never consults the world. The adapters are
reachable from the `ztrack/world-annotations` / `ztrack/world-source-books`
subpaths; see
[docs/EVIDENCE.md § Advanced: validating against a mirrored world](docs/EVIDENCE.md#advanced-validating-against-a-mirrored-world).

---

## 6. Do-not-confuse cheat sheet

- **Sources are local markdown — never a SaaS.** One or more declared sources (§1), always markdown; GitHub/Jira/Slack are world sync spokes, not backends.
- **Validation is one pipeline.** `core/engine.ts` (`check`/`checkRoot`) over the repo-local standalone `preset.mts` is all there is; the "export" is just `check().export` (the validated `Root`). There is no separate snapshot model.
- **The write-side layer is not validation.** `modelEdit.ts` (parse → edit the typed model → the preset's `serialize` — the one mutation path), `markdownDocument.ts`, `rawIssueMarkdown.ts`, and `lint.ts` edit/format issue bodies; the validation pipeline does not import them.
- **"preset" means a validation preset only.** The markdown read-model lives in `markdownDocument.ts` (lenient mdast) and the raw structured model in `rawIssueMarkdown.ts` — neither is under a `presets/` path anymore.
- **Sources are independent of presets.** `sources` (§1 — a `tracker-config.json` property saying WHERE issues live: one or more markdown directories/files) and a preset (§3 — HOW issues are validated: schema, parser, rules) are orthogonal; any preset can run over any source layout.
