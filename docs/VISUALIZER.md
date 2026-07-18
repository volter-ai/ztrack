# Visualizer Reference

`ztrack visualizer` (alias `ztrack viz`) is a local, preset-agnostic dashboard over the same
validated model `ztrack check`/`export` produce — a repo-local web view of your tracker, not a
hosted product. It is a Bun app that binds only to `127.0.0.1` (never exposes your repo to a
network) and reads the SAME pipeline as the CLI: the active preset resolves from your
`tracker-config.json`, issues load via the configured backend, and the validated root ships to the
browser as one JSON payload (`/api/board`).

This doc is the dashboard's analog of [PRESETS.md](PRESETS.md) — the SAME four-depth story, one
level deeper each time. **Skim to the depth you need; deeper is rarer and reaches further:**

| Depth | What you change | Who does it |
|---|---|---|
| (i) Theme the board | Colors only — a CSS override | anyone, no code |
| (ii) Teach the board your vocabulary | The preset's `visualizer` block (data: columns, field mappings) | preset editors |
| (iii) Mod the board with code | A repo-owned `extension.tsx` (bounded render slots + operational-block policy) | dashboard authors |
| (iv) Build your own dashboard | The raw `/api/board` payload / GraphQL API | integrators, a whole new client |

## See it: stock vs. modded (VIZ-11)

Real, DOM-rendered screenshots of the SAME repo, before and after applying the exact mod recipe
`demos/visualizer-mod.sh` (VIZ-10) proves out end to end — the new status enum/column, the
depth-(ii) vocabulary change, the depth-(i) theme override, and the depth-(iii) custom code panel,
together, with an issue's detail drawer open (panels only render there,
`visualizer/client/main.tsx:346`):

| Stock | Modded |
|---|---|
| ![Stock board: default `in-progress` column, "Dev ACs" AC-unit label, default purple accent theme, no custom panel — only the core "Acceptance Criteria" panel in the open detail drawer.](assets/visualizer-stock.png) | ![Modded board: an extra "mod-review" board column, "Mod ACs" AC-unit label, an orange `--accent` theme override on the new column/badge/selection highlight, and the VIZ-16 boilerplate's custom "Proof coverage" panel rendered below Acceptance Criteria in the open detail drawer.](assets/visualizer-modded.png) |

The modded shot carries all four mod-stack elements at once: a **new `mod-review` board column**
(depth ii, schema enum + `statusOrder`), the **`Mod ACs` AC-unit label** (depth ii,
`acUnitLabel`), a **theme override** (depth i, `--accent: #ff6600` — visible on the new column
header, the `mod-review` status badge, and the selected-card highlight, versus the stock default
purple/blue), and the **"Proof coverage" custom panel** (depth iii, the VIZ-16 boilerplate's
`issuePanels`) — the artifact that proves the unbounded code seam, not just vocabulary. Both PNGs
live at `docs/assets/visualizer-stock.png` and `docs/assets/visualizer-modded.png`, captured at a
fixed 1400x900 viewport with the same issue (`MOD-1`) open in both.

## (i) Theme the board

The board's entire palette is a small set of CSS custom properties declared once, on `:root`
(`visualizer/client/styles.css:1-17`):

| Token | Default | Meaning |
|---|---|---|
| `--bg` | `#f7f8fa` | page background, behind the sidebar/topbar |
| `--sidebar` | `#fbfbfc` | the issue-list sidebar's own background |
| `--panel` | `#ffffff` | card/panel/detail-drawer background |
| `--panel-soft` | `#fafafb` | a slightly recessed panel surface (nested sections) |
| `--line` | `#e1e3e8` | the primary border/divider color |
| `--line-soft` | `#eef0f3` | a lighter divider (inside panels, between rows) |
| `--text` | `#1f2328` | primary text color |
| `--muted` | `#68707d` | secondary text (labels, metadata) |
| `--subtle` | `#8b929f` | tertiary text (timestamps, placeholders) |
| `--accent` | `#5f55ee` | the one brand color — active tab, links, focus rings |
| `--green` | `#1f7a4d` | passed / done semantics |
| `--amber` | `#996f00` | pending / warning semantics |
| `--red` | `#c73434` | failed / error semantics |
| `--shadow` | `0 24px 80px rgba(31, 35, 40, 0.18)` | the detail drawer's drop shadow |

Nothing else in the client reaches outside this token set for color — every component references
one of these fourteen, so overriding them re-themes the whole board.

**The override seam (VIZ-6).** Same convention as the preset: no config key, file-presence is the
opt-in. Drop a `theme.css` at the fixed conventional path beside the preset,

```text
<stateDir>/tracker/visualizer/theme.css      # e.g. .volter/tracker/visualizer/theme.css
```

and the server serves it, per request (no restart, no build step — it's plain CSS), at
`/assets/theme.css`, loaded by the shell right after the stock stylesheet
(`visualizer/server.ts:453` is the visualizer's own `127.0.0.1`-only bind; the dedicated
`/assets/theme.css` route sits at `visualizer/server.ts:464-471`, reading `THEME_CSS_PATH`
— a fixed constant derived via `stateDirName()`, never a hardcoded `.volter/`, so a non-default
state dir still resolves). A missing file is a plain 404 with an empty body; the stock stylesheet
still applies.

**One worked override** — a dark board, overriding just the tokens that need to change:

```css
/* .volter/tracker/visualizer/theme.css */
:root {
  color-scheme: dark;
  --bg: #14151a;
  --sidebar: #17181d;
  --panel: #1c1d23;
  --panel-soft: #202127;
  --line: #2c2e36;
  --line-soft: #24252b;
  --text: #e7e9ee;
  --muted: #9aa1ad;
  --subtle: #6b7280;
  --accent: #8b7cf6;
  --green: #34c27a;
  --amber: #e0a940;
  --red: #ef5a5a;
}
```

Save that file, reload the board — no other tokens need restating; anything you omit keeps the
stock value via normal CSS cascade (your `theme.css` loads AFTER `styles.css`).

## (ii) Teach the board your vocabulary

The board's DATA vocabulary — status columns, what an acceptance criterion is called, and which
fields on your OWN schema hold the assignee/PR/AC text/proof/evidence — lives in your installed
preset's own `visualizer` block, the exact same file `ztrack init` wrote at
`.volter/tracker/validation/preset.mts` (see [PRESETS.md § Installed Contract](PRESETS.md#installed-contract)).
There is no separate visualizer config: the block is a field of the `Preset` object your preset
already exports.

`boilerplates/presets/simple-sdlc.ts` (what `ztrack init --preset simple-sdlc`/`default` installs
verbatim) declares:

```ts
// boilerplates/presets/simple-sdlc.ts:720-728
const DEFAULT_VISUALIZER: VisualizerSpec = {
  statusOrder: ['draft', 'ready', 'in-progress', 'in-review', 'done'], // must equal DefaultIssueStatusSchema above
  acUnitLabel: 'Dev ACs',
  assignee: 'assignee',                                                // DefaultIssueSchema.assignee
  acText: { id: 'id', text: 'text', version: 'version' },              // DefaultAcSchema.{id,text,version}
  acProof: { field: 'proof', explanation: 'explanation', evidenceRefs: 'evidenceRefs' }, // DefaultAcSchema.proof
  acEvidence: { field: 'evidence', image: 'image', commit: 'commit', acVersion: 'acVersion' }, // DefaultAcSchema.evidence[]
  // no `pr`: this preset is PR-free by design — DefaultIssueSchema has no `pr` field.
};
```

`statusOrder` drives the board's COLUMNS, in order — it must equal your schema's own issue-status
enum (`DefaultIssueStatusSchema`, `boilerplates/presets/simple-sdlc.ts:69`), never a second,
drift-prone list. Every other member is a **field reference**, not a function: `acText`/`acProof`/
`acEvidence` name which keys on your OWN `AcceptanceCriteria`/`Evidence`/`Proof` schema hold what —
literal data only, matching `VisualizerSpec`'s hard boundary (`ztrack/preset-kit`, re-exported from
`src/core/engine.ts`): no functions, no markup, ever, in this block.

### Worked example: add a status to the enum AND the block

Starting from a fresh `ztrack init --preset simple-sdlc` (or `--preset default`, its alias), open
`.volter/tracker/validation/preset.mts` — it is your project's own editable copy, installed
verbatim from `boilerplates/presets/simple-sdlc.ts`, so these line numbers match exactly. Add a
`blocked` status BOTH to the schema's enum and to the visualizer block's `statusOrder`, in the same
position in both:

```diff
- export const DefaultIssueStatusSchema = z.enum(['draft', 'ready', 'in-progress', 'in-review', 'done']);
+ export const DefaultIssueStatusSchema = z.enum(['draft', 'ready', 'in-progress', 'in-review', 'blocked', 'done']);
```

```diff
  const DEFAULT_VISUALIZER: VisualizerSpec = {
-   statusOrder: ['draft', 'ready', 'in-progress', 'in-review', 'done'],
+   statusOrder: ['draft', 'ready', 'in-progress', 'in-review', 'blocked', 'done'],
    acUnitLabel: 'Dev ACs',
    ...
```

Then create an issue in the new state and start the board:

```bash
ztrack issue scaffold --title "Blocked case" > blocked.body.md
ztrack issue create --title "Blocked case" --state blocked --assignee me --body-file blocked.body.md
ztrack visualizer --project .
```

**Verified (VIZ-8 dev/02):** run verbatim against a fresh `ztrack init --team APP --preset
simple-sdlc` repo, `GET /api/board` returned `"visualizer":{"statusOrder":["draft","ready",
"in-progress","in-review","blocked","done"], ...}` with the created issue reported as
`{"id":"APP-1","status":"blocked", ...}` — a new **blocked** column, with the issue in it, on the
very next board load. No restart needed beyond the one already required to pick up the edited
`preset.mts` (the visualizer re-resolves the preset per request, same as `ztrack check`).

Two invariants keep the vocabulary honest, both enforced as tests you already have (not something
to hand-write per preset):

- **The conformance helper (VIZ-7).** `assertVisualizerSpecConformance` (a `bun:test`-registering
  wrapper, `src/testkit/presetConformance.ts:392-396`, built on the pure, non-throwing
  `visualizerSpecConformanceProblems`, `src/testkit/presetConformance.ts:326-386`) checks, entirely
  by duck-typing your preset's OWN zod schema — never a second, forked copy of the vocabulary:
  1. `preset.visualizer` validates against `VisualizerSpecSchema` (a function/markup-valued member,
     or a stray field, fails structurally).
  2. `visualizer.statusOrder` equals `issueStatusEnumOf(preset)` (`src/presetRegistry.ts:179-191`,
     the SAME write-time status-enum introspection `ztrack issue edit --state <typo>` uses — VIZ-2
     exported it for exactly this reuse) — a status renamed on one side and not the other fails,
     naming the specific offending status.
  3. Every field name a mapping carries (`assignee`, `pr.field`/`urlField`, `acText.id`/`text`/
     `version`, `acProof.field`/`explanation`/`evidenceRefs`, `acEvidence.field`/`image`/`commit`/
     `acVersion`) actually exists on your issue/AC schema, where introspectable.

  Every shipped preset's own test file calls it (e.g. `simple-sdlc.test.ts`); wire the same one
  call into your edited preset's tests (or `bun test` against `ztrack check` if you have no local
  test harness — the conformance check also runs implicitly any time the visualizer boots, via
  `resolveVisualizerBlock`'s validate-or-null-plus-error path, VIZ-3).

- **The upgrade story.** Because your preset is an edited copy, `ztrack preset upgrade` 3-way
  merges new upstream rules — including a shipped `visualizer` block improvement — into your
  edited `preset.mts`, preserving your local edits (`docs/PRESETS.md:469-477`). The block rides
  the SAME merge as everything else in the file; there is no separate visualizer-upgrade path.

## (iii) Mod the board with code

Depth (ii) is DATA — field references and literal labels. When you need actual render logic (a
custom panel, a bespoke evidence renderer), the board has a second, narrower extension point: a
repo-owned `extension.tsx`, compiled into the served bundle by the SAME process that builds the
rest of the board — no separate build step, no restart on edit.

### The contract (`ztrack/visualizer-kit`)

`VisualizerExtension` exposes bounded render slots plus one bounded board policy: a repo may add
an operational-block predicate/reason and rename the built-in operationally-blocked view. It
cannot replace the view, filter, rows, cards, or navigation skeleton:

```ts
export interface VisualizerExtension {
  isOperationallyBlocked?(issue: CoreIssue): boolean;
  operationalBlockLabel?(issue: CoreIssue): string | undefined;
  blockedViewLabel?: string;
  /** -> css `state-<x>` for the status pill. */
  statusClass?(status: string): string;
  /** The AC label, rendered in the detail AC list. */
  acText?(ac: CoreAC): ReactNode;
  /** AC evidence thumbnails/links, rendered in the detail AC list. */
  acEvidence?(ac: CoreAC, projectUrl: (path: string) => string): ReactNode;
  /** AC proof (explanation + refs), rendered in the detail AC list. */
  acProof?(ac: CoreAC): ReactNode;
  /** Preset-specific issue-level panels, rendered inside the issue detail drawer. */
  issuePanels?(issue: CoreIssue, projectUrl: (path: string) => string): ReactNode;
}
```

Construct one with the blessed identity helper, mirroring `definePreset`'s convention
(`src/visualizerKit.ts:122-124`):

```ts
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';

export default defineVisualizerExtension({ /* … */ });
```

### The EXPLICIT list of extension-reachable surfaces

This is the whole reach — nothing else is addressable from `extension.tsx`:

| Member | Reaches | Slot |
|---|---|---|
| `isOperationallyBlocked` / `operationalBlockLabel` / `blockedViewLabel` | adds repo-specific issues/reasons to the core operationally-blocked view | built-in view, filter, list/card/detail reason badge |
| `issuePanels` | a new panel inside the issue detail drawer | `visualizer/client/main.tsx:346` |
| `acText` / `acProof` / `acEvidence` | the per-AC rendering inside the detail AC list | `visualizer/client/main.tsx:337-340` |
| `statusClass` | the CSS class on the status pill | `visualizer/client/main.tsx:114` |

**Data reach, stated:** your render functions receive the issue/AC objects INCLUDING preset
ride-along fields — the arbitrary extra keys your own schema adds
(`[k: string]: unknown` on `CoreEvidence`/`CoreAC`/`CoreIssue`, `visualizer/client/model.ts:1-9`).
Findings, audit entries, and timestamps stay core-rendered; an extension never sees them.

**Precedence** (`visualizer/client/extensions.tsx:28-38`, `buildEffectiveExtension`,
`visualizer/client/extensions.tsx:153-170`): a code member wins where present, else the depth-(ii) DATA-derived
render (built purely from your `visualizer` block's field mappings), else core's own bare
fallback. Merging is PER MEMBER, not per object — an extension defining only `issuePanels` keeps
every other data-derived renderer.

**The engine analogy, stated plainly.** The preset-agnostic SKELETON — columns, list rows, card
faces, sidebar, topbar — is core-owned, exactly as `src/core/engine.ts` is the core-owned bound
for presets: a preset supplies data/rules, never the engine that runs them; an extension supplies
render logic for named slots and may classify an issue into the core-owned operational-blocked
view, never replace the skeleton around them. Whole-board replacement — your own
client entirely — is a wider, different seam: depth (iv) below, an honest bound, stated not
hidden.

**Why the interface EXCLUDES vocabulary.** `VisualizerExtension` deliberately has no
`statusOrder`, no `acUnitLabel`, and no field-mapping members (`assignee`, `pr`, or the field names
inside `acText`/`acProof`/`acEvidence`) — that vocabulary is depth-(ii) DATA, authored once in your
`preset.mts` and validated against `VisualizerSpecSchema`. Reintroducing it here would recreate
exactly the two-file vocabulary drift a hardcoded extension map caused before this design: one
place says the AC label field is `text`, a second, code-level place quietly disagrees. A pinning
test (`src/visualizerKit.test.ts`) fails the build if this regresses.

### Worked walkthrough: a custom issue panel

Every fresh `ztrack init` already scaffolds the seam — a no-op starter at
`<stateDir>/tracker/visualizer/extension.tsx` plus its pristine `.extension.base.tsx`
(`src/presetCatalog.ts:116-146`) — so there is nothing to create, only to fill in. The shipped,
fully worked example lives at `boilerplates/visualizer/extension.tsx`; copy it over the starter
verbatim:

```bash
ztrack init --team APP                                    # scaffolds the no-op starter
cp node_modules/ztrack/boilerplates/visualizer/extension.tsx \
   .volter/tracker/visualizer/extension.tsx
```

It demonstrates two independent members against `simple-sdlc`'s own AC fields — `ac.proof` and
`ac.evidence` are CORE fields (`src/core/engine.ts`'s `CoreAC`), present on every preset that turns
on the `proof` primitive, so this same file works unedited against `speckit` or a custom preset
too:

- **`issuePanels`** (`boilerplates/visualizer/extension.tsx:79-120`) — a "Proof coverage" panel:
  for every AC on the open issue, does it have both a `proof` and evidence the proof actually
  cites? Rendered beside the core "Acceptance Criteria" panel.
- **`acEvidence`** (`boilerplates/visualizer/extension.tsx:122-142`) — a compact per-evidence line
  (short commit sha, AC version, and a real project-relative link when an artifact is attached).

Give the board a passed, proof-backed AC to see it:

```bash
ztrack issue scaffold --title "Panel demo" > panel.body.md
ztrack issue create --title "Panel demo" --state in-progress --assignee me --body-file panel.body.md
ztrack ac patch APP-1 dev/01 --json '{"status":"passed","checked":true,"evidence":[{"id":"ev1","commit":"<a-real-git-sha>","acVersion":1}],"proof":{"explanation":"demo proof","evidenceRefs":["ev1"]}}'
ztrack visualizer --project .
```

Open the issue in the board; the drawer now shows "Proof coverage" beside "Acceptance Criteria".

**Verified (VIZ-8 dev/03):** run verbatim (fresh `ztrack init --team APP`, the copy above, the
commands above) and DOM-rendered via the real served `/assets/app.js` bundle, the detail drawer's
own text read `Proof coverage1/1✓dev/01 — 1 evidence entry, 1 cited by its proof` — the panel
genuinely rendered, with no `extensionError` and no error notice.

### The scaffold, the pristine base, and `preset upgrade`

Exactly like the preset (`docs/PRESETS.md:469-477`), the extension is an installed, edited-by-you
artifact with its own merge base — `ztrack preset upgrade` upgrades BOTH in lockstep
(`src/presetCatalog.ts:202-220`, reusing the identical `threeWayMerge` the preset uses, never a
forked second implementation): a clean 3-way merge (base → new starter vs. base → your edits)
preserves your panel; a genuine conflict on the same line is written as `<<<<<<<` markers to
resolve by hand. One-of-file cases are never silent: extension present but the base file missing
reports `no-base` (mirroring the preset's own status); the extension deleted on purpose while the
base remains reports `skipped`, never silently reinstalled; a repo that predates this feature
(neither file present) gets both seeded, reported `seeded`.

### The trust boundary — same as `preset.mts`

The extension compiles and runs under the SAME boundary as your preset: `ztrack` executes repo
code, and running it against a repo you don't trust is the same trust decision as running that
repo's `npm install`/build scripts (`SECURITY.md`). The concrete guard is the identical
containment check the preset's own loader uses — resolve, realpath, and require the resolved path
stay inside the project root (`src/presetRegistry.ts:124-131`; the extension's own resolver mirrors
this same confinement). The blast radius is bounded the same way the preset's already is: the
visualizer binds ONLY to `127.0.0.1` and serves only to your own browser, on your own machine
(`SECURITY.md:45-46`; `visualizer/server.ts:453`). A malformed or unresolvable extension never
takes the board down — failure isolation rebuilds the served bundle WITHOUT it and ships the
compile error as a payload field the client renders as a notice instead of a crash.

## (iv) Build your own dashboard

Depths (i)–(iii) extend the SHIPPED board. If you want your own client entirely — a different
framework, an internal tool, a Slack digest — the board's data is a plain, documented wire
contract you can consume directly, with no dependency on the React client at all.

### The `/api/board` payload

```ts
// visualizer/client/model.ts:79-97
export interface Payload {
  title: string; preset: string; projectDir: string; fetchedAt: string;
  trackerChangedAt: string | null; ok: boolean;
  primitives: Partial<Record<PrimitiveName, boolean>>;
  visualizer: VisualizerSpec | null;     // the preset's own vocabulary (depth ii), or null
  visualizerError?: string;              // set when a declared block fails validation
  extensionError?: string;               // set when a repo extension.tsx failed to compile
  issues: CoreIssue[]; findings: Finding[];
  audit: Record<string, AuditEntry[]>;
  timestamps: Record<string, Timestamps>;
  error?: string;
}
```

`CoreIssue`/`CoreAC`/`CoreEvidence` (`visualizer/client/model.ts:1-9`) name the CORE fields every
preset guarantees (`id`, `title`, `summary`, `status`, `acceptanceCriteria`, and per-AC `id`/
`status`/`evidence`) plus `[k: string]: unknown` — arbitrary preset ride-along fields
(`assignee`, `proof`, whatever your own schema adds) ARE present on the wire, at the field names
your OWN schema uses; they simply aren't part of the CORE shape's stability promise.

### The stability promise, scoped honestly

**Core keys are semver-covered** — the fields named in `Payload`/`CoreIssue`/`CoreAC`/`Finding`
above break only at a major version, same promise as everything else in
[docs/API.md](API.md). **Ride-along fields are preset-owned, not covered** — an extra key your OWN
`preset.mts` schema adds (or removes, or renames) is under YOUR control, not ztrack's; a fresh
consumer of `/api/board` should read core fields by name and treat everything else as
preset-specific, opaque-until-you-say-otherwise data.

### A minimal working client

No framework, no build step — `fetch` plus a `for` loop, run with `node` or `bun`:

```js
// board-by-status.mjs
const base = process.argv[2] || 'http://localhost:3300';
const board = await (await fetch(`${base}/api/board`)).json();

const byStatus = new Map();
for (const issue of board.issues) {
  if (!byStatus.has(issue.status)) byStatus.set(issue.status, []);
  byStatus.get(issue.status).push(issue.id);
}
const order = board.visualizer?.statusOrder ?? [...byStatus.keys()];
console.log(`${board.title} (preset: ${board.preset}, ok: ${board.ok})`);
for (const status of order) {
  const ids = byStatus.get(status) ?? [];
  console.log(`  ${status}: ${ids.join(', ') || '(none)'}`);
}
```

```bash
ztrack visualizer --project . --port 3300 &     # start the board once
node board-by-status.mjs http://localhost:3300
```

**Verified (VIZ-8 dev/05):** run against a real board (the depth-(ii) worked example's repo, with
its `blocked` issue) it printed:

```text
tracker (preset: simple-sdlc, ok: true)
  draft: (none)
  ready: (none)
  in-progress: (none)
  in-review: (none)
  blocked: APP-1
  done: (none)
```

### The GraphQL alternative

For a real dashboard backend (not a one-off script), `serveTrackerApi` (and `ztrack api serve` /
`ztrack api query` on the CLI) exposes the SAME validated tracker over GraphQL instead of the
board's REST-shaped JSON (`docs/API.md:129-132`; see [Architecture](../ARCHITECTURE.md) for the
schema, and the exports-map row at `docs/API.md:113` for the package surface).

### The data-only boundary, restated

Depth (iv) is the WIDEST seam and the least guided — you own the whole client, so you also own
keeping it in sync with core-key changes across major versions and with your own preset's
ride-along fields. There is no partial step between depth (iii)'s named render slots and depth
(iv)'s raw payload; that gap is deliberate, not an oversight — a wider, ad hoc "reach into more of
the client" surface would be the same drift risk depth (iii)'s excluded vocabulary avoids, at
dashboard scale instead of field scale.

## Maintainer note: the first-party code-panel convention

The two examples above — a repo's OWN `extension.tsx` (depth iii) and a from-scratch depth-(iv)
client — are for USERS of ztrack. Maintainers adding a first-party preset-specific panel (e.g.
speckit's own issue panel, shipped WITH ztrack rather than copied into a user's repo) use a third,
internal convention: one `visualizer/client/presets/<name>.tsx` module per preset, filename-keyed
to the preset's canonical name (mirroring the `boilerplates/presets/<name>.{ts,json}` two-file
convention), self-registering via `registerExtension` when the generated bundle entry imports it —
`visualizer/client/extensions.tsx`'s own header documents this DATA+CODE two-layer merge in full.
There is intentionally **no central name → extension map** anywhere in the client: first-party
panels are discovered by scanning `visualizer/client/presets/` for `.tsx` files, the SAME
no-hardcoded-list discipline [PRESETS.md's own "Never" section](PRESETS.md#never-anti-patterns-that-caused-real-bugs)
holds presets to (a hardcoded `EXTENSIONS` map keyed by preset name was the exact bug this
convention replaced) — never reintroduce one here either.
