# Changelog

All notable ztrack release changes are recorded here.

## 0.6.1

Fixes from a multi-agent review of the loop / waiver / descope work:

- **Parser:** a `reason:` after `blocked-by:`/`blocks:` on an AC line corrupted the blocker
  — it parsed the dependency as a bogus issue and silently dropped the real one. The
  descope `reason:` keyword collided with the block-field parser; now terminated correctly.
- **Parser:** `descopeReason` was captured on ANY AC containing `reason:` and swallowed
  trailing `[E?]` / `commit:` tokens into the prose; now gated on `status: descoped` and
  bounded.
- **Done-gate:** a done case with EVERY acceptance criterion descoped passed with nothing
  verified — a free bypass cheaper than a waiver. The gate now also requires ≥1 actually
  passed AC.
- **Waiver scope:** a waiver downgraded structural invariants it has no business muting (a
  block cycle, a duplicate id, a self-block, a checkbox/status contradiction). Added a
  `waivable` flag (RuleRecord + Finding); those rules are non-waivable, so a waiver still
  covers readiness failures (missing evidence/commit) but a block cycle stays red.
- **Robustness:** the Stop hook guards a torn iteration-counter write (no `set -u` crash);
  `ztrack loop status` no longer crashes on a truncated breadcrumb; the armed-but-ztrack-
  missing block message now states how to get out.
- **gitignore:** repos `init`'d before the loop existed never received the `.ztrack-loop-*`
  ignore patterns (the block is written once). `ztrack loop start` and re-`init` now
  idempotently append any missing managed lines, so session/exempt files can't be committed.
- **Visualizer:** the "findings" view no longer drops issues whose findings are all
  `acknowledged`.

## 0.6.0

- **Loop escape hardening + state hygiene** (the `ztrack-gate` Stop hook + `ztrack loop`):
  - The per-session self-exempt path is now offered only once the agent is **past the
    half-way point of the iteration budget** (`n*2 > max`), so an early held turn reads as
    "keep working" and the hand-back surfaces only as a last resort — not a turn-1 quit
    button.
  - The **iteration cap holds-and-surfaces** instead of silently vanishing: on cap the loop
    disarms (the agent is never trapped) but drops a gitignored `.ztrack-loop-capped.json`
    breadcrumb, and `ztrack loop status` now reports `loop capped → <issue> after N
    iterations`; `ztrack loop start` clears it.
  - **State hygiene:** any disarm (green / cap / `ztrack loop stop`) now sweeps EVERY
    session's `.ztrack-loop-iter-*` and `.ztrack-loop-exempt-*` files, so no stale runtime
    state lingers in `.volter`.
- **Docs:** the `ztrack-gate` plugin README gains a "Trust boundary — cooperative, not a
  sandbox" section (the loop fixes premature-stop for a well-intentioned agent; it does NOT
  *contain* an agent that wants out — that's the harness's job; sanctioned exits are
  recorded, not silent), and notes descope counts toward "done" only on SDLC-gated presets
  (under `basic`, the waiver is the durable escape).
- **CI:** `demos/loop-gate-ci.sh` now also covers the above (R1/R2/R3, deterministic);
  `actions/setup-node` bumped off the deprecated Node 20 runner.

## 0.5.0

- **New: the ztrack loop — a ralph-pattern autonomy loop whose completion ORACLE is
  `ztrack check` (deterministic), not a trusted phrase or an LLM judging a transcript.**
  `ztrack loop start <issue>` arms a session-scoped Stop-hook gate (via the bundled
  `ztrack-gate` Claude Code plugin): while armed, the agent's turn can't end until that
  issue passes `ztrack check` (then the loop disarms itself), or the per-session iteration
  cap (`--max`, default 8) trips. NOT armed → turns end normally, so interactive use is
  never gated. `ztrack loop stop` / `status`. The gate scopes to the armed issue via
  `check --auto-scope` + `ZTRACK_ACTIVE_ISSUE`, so other red issues don't hold it.
- **New: three honest escapes from the loop**, graded by how durable they are — none fakes
  "done":
  - **Disarm** (`ztrack loop stop`): ends the loop for everyone; the issue stays red.
  - **Per-session self-exempt**: a blocked turn's message prints a session-keyed path
    (`.volter/.ztrack-loop-exempt-<session_id>`); creating that file lets *this* session's
    turn end. Keyed to the live session id and gitignored, so it can't leak to another
    session or outlive the one that made it.
  - **Durable waiver** (`ztrack waiver sign <issue> --reason "…"` / `clear` / `status`):
    records that the failing state is knowingly accepted; the issue's `error` findings
    become the new non-gating `acknowledged` severity so `check` passes. Sign-off is your
    **git identity**, captured automatically (the same identity that authors commits).
    Anchored to a fingerprint of the **acceptance criteria**, so it AUTO-STALES the instant
    those criteria change (an unrelated commit elsewhere does NOT invalidate it); an
    unreasoned waiver is itself an error.
- **New: descope as a first-class "satisfied-with-reason" AC state** (SDLC-gated presets).
  A done case whose AC is `status: descoped reason: …` is green WITHOUT a waiver — the
  honest home for "this criterion is out of scope". An unjustified descope is itself an
  error; `blocked` stays unsettled (a done case can't carry work that's still waiting).
- **New: `acknowledged` finding severity** — a downgraded `error` a fresh waiver has
  accepted: reported everywhere (CLI report, `--auto-scope` report, MCP, visualizer) but
  non-gating, like a warning. Only `error` gates `ok`. The visualizer renders the
  acknowledged count, a waiver banner (who signed it and why), and descoped ACs with their
  reason. (TS consumers that exhaustively switch on `Severity` should add the new arm.)
- CI now covers the Stop hook's full decision table and the `ztrack waiver` CLI round-trip
  deterministically (no live agent), on both the test and publish gates
  (`demos/loop-gate-ci.sh`). The live-agent end-to-end stays a manual demo
  (`demos/loop-e2e.sh`).

## 0.4.0

- **Breaking: validation rules are declarative records, not imperative functions.** A
  rule was `{ name, run: (input) => Finding[] }`; it is now a record
  `{ code, severity?, category?, depth?, phase?, select, when?, message }` evaluated over
  an engine-derived model. The engine derives an analyzed model once per check (per-item
  scopes `issues`/`acs`/`evidence`, id aggregates, and the unified block graph) and rules
  `select` facts off it; a preset's own cross-entity/graph analysis moves to
  `Preset.derive`. The schema carries SHAPE, the rules carry MEANING. **Migrate a custom
  preset** by turning each rule into `rule({ code, select: (m) => …, when, message })` and
  moving aggregate/graph computation into `derive`; a pushed
  `module.exports.rules.push({ name, run })` becomes `…push(rule({ code, select, when, message }))`.
  All four built-in presets (default, spec, generic, speckit) were migrated.
- **New: presets are INSTALLED as editable code, not referred to.** `ztrack init` now
  writes `.volter/tracker/validation/preset.cjs` as real plain-JS records that rent the
  engine + parser + schema from `ztrack/preset-kit` — not a `createGenericPreset({ flags })`
  shim. The rules live in your repo, editable in a PR. New `ztrack/preset-kit` authoring
  exports: `definePreset`, `rule`, `formatRef`, the fact types, and `genericParser` /
  `genericSchema` / `genericScaffold`. `createGenericPreset` stays as the typed reference
  the install vendors from; `presetInstall.test.ts` guards byte-identical behavior.
- **New: `ztrack preset upgrade`.** `init` records a pristine base
  (`.volter/tracker/validation/.preset.base.cjs`, commit it); upgrade 3-way merges new
  upstream rules into your edited preset (via `git merge-file`), preserving edits —
  overlaps become `<<<<<<<` conflict markers to resolve, then `ztrack check`.
- **New: `ztrack check --auto-scope`.** Validates the whole tracker (cross-issue rules
  stay correct) but exits nonzero only on the issue the current git checkout is for
  (resolved from the branch/worktree name); other issues are informational, and
  unresolved/ambiguous scope fails closed. Built for a per-worktree Stop-hook gate so N
  worktrees each scope themselves with no coordination.
- **Fix: the bundled Stop hook runs the locally-installed ztrack** (`node_modules/.bin/ztrack`,
  override `ZTRACK_BIN`), not `npx --yes ztrack` — so the engine running the check is the
  same one the installed preset imports (binary == library), and "done" only moves on a
  reviewed lockfile bump.

## 0.3.0

- **New: universal ids + unified blocking.** Every node has a derived colon-delimited
  universal id (`issue` / `issue:ac` / `issue:ac:evidence` / `issue:ac:proof`).
  Acceptance criteria declare `blocked-by:` / `blocks:` references whose target is
  another AC (bare `dev/02`, or qualified `APP-2:dev/01`) **or a whole issue**
  (`APP-4`) — so blocking crosses levels (AC↔AC, AC↔issue, issue↔issue). All
  directions and levels — including issue-level `relations` — fold into ONE derived
  dependency graph (`core/blocking.ts`), validated cross-tree: `ac_blocker_missing`,
  `ac_self_block`, `ac_block_cycle` (the graph must be acyclic, including cross-level
  deadlocks), and `ac_blocked_by_unpassed` (a done node can't depend on an unfinished
  one). The same graph powers a transitive blocked/actionable view (`blockStatuses`).
  Implemented by the installed presets and the default reference preset. Blocking is
  fully optional — a repo that never writes a `blocked-by:`/`blocks:` line is
  unaffected. Set it with a structured mutation (no hand-editing required):
  `ztrack ac block <issue> <acId> <refs…> [--blocks]` / `ztrack ac unblock …`, and the
  `tracker_ac_block` / `tracker_ac_unblock` MCP tools.
- **Hardening:** the repo-local validation entrypoint is confined to the project
  directory; the markdown backend rejects path-traversal issue ids; `ztrack check
  --input` reports malformed JSON cleanly; the visualizer binds to `127.0.0.1` and
  refuses to serve dotfiles / signing keys / the tracker DB; a missing `python3`
  yields an actionable message.
- **Breaking: removed the `ztrack/work-graph` export** and its `WorkGraph*` /
  `ProjectGraph` / `ValidatedPresetModel` types. It was a dead second/dual model
  (`{ graph, native }`) with no validation-pipeline consumer; the validated root
  is the single export every surface reads.
- **Evidence entries are now GFM list items** (`- [En] type: …` under `## Evidence`)
  so each entry is its own node and the parser discovers one record per node (no
  line-scanning). `ztrack evidence add` / `evidence ingest` write list items; a
  single legacy bare `[En]` paragraph is still read, but multi-entry bare-line
  blocks should be rewritten as list items.
- **Breaking: collapsed onto a single validation pipeline.** Validation now reads
  issues from the tracker and git/world facts into one typed, strict multi-issue
  root; pure deterministic rules validate that root, and the validated root is
  what `export` writes.
- **Breaking: `ztrack snapshot export` is replaced by `ztrack export`**, which
  writes the validated root (shape `{ "issues": [ ... ] }`). The committed CI
  artifact is now the validated root; recommended path `.volter/root.json`
  (previously `.volter/snapshot.json`). Validate it with
  `ztrack check --input .volter/root.json`.
- **Breaking: `ztrack check --json` output shape changed** to
  `{ ok, summary, findings }`, where `summary` is `{ issues, errors, warnings,
  status }`. `valid` is now `ok`; `summary.status` (pass/warn/fail) still exists.
- **Breaking: removed the public `checkTrackerSnapshot` / `exportTrackerSnapshot`
  / `TrackerSnapshot` API and the `./tracker-snapshot` package export.** Use
  `checkTracker` / `exportTrackerRoot` / `createGenericPreset` and the
  `ztrack/preset-kit` export instead.
- The installed validation preset is now `createGenericPreset({...})` from
  `ztrack/preset-kit`, living at `.volter/tracker/validation/preset.cjs`.

## 0.2.0

- Added the `ztrack visualizer` (alias `ztrack viz`) command: a standalone Bun
  web app that renders issues, acceptance-criteria progress, findings, and
  timestamps from the live tracker through the same core as `check`. Ships in the
  package as a self-contained bundle; the first run installs its client deps.

## 0.1.1

- Published the public `ztrack` package.
- Exposed the `ztrack` CLI through `npx ztrack`.
- Added the `basic`, `simple-sdlc`, `simple-spec`, and `speckit` install presets,
  each copied into the target repo as editable validation.
- Added CI coverage for typecheck and tests.
- Added the public README, security policy, contribution guide, issue templates,
  demo GIF, and root GitHub Action surface.

## 0.1.0

- First public package staging release.
