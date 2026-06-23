# Changelog

All notable ztrack release changes are recorded here.

## 0.17.0

- **Unresolved sync conflicts gate `check`.** A same-field collision (under `merge`) is now
  recorded at `.volter/sync/conflicts.json` and `ztrack check` emits an unwaivable
  `sync_conflict` error while it stands — so the gate stays red and the ralph loop keeps going
  until it's resolved, instead of the conflict being a one-line warning you can walk past. This
  is a cross-cutting core concern (like waivers), not a preset rule. Resolving is a natural
  red→green step: pick a side and re-sync (`--policy hub-wins`/`twin-wins`, or edit + re-sync),
  which converges both sides and clears the record. Scoped checks (`--issues`, `--auto-scope`)
  only gate on their own issues' conflicts.

## 0.16.0

- **Configurable reconcile policy.** `config.sync.policy` (`merge` | `hub-wins` | `twin-wins`,
  default `merge`) chooses how a same-field collision resolves: `merge` surfaces it untouched,
  `hub-wins` takes GitHub, `twin-wins` takes the local tracker. Set it with
  `ztrack init --sync github --repo o/n --policy hub-wins`, or override per run with
  `ztrack sync github --policy <p>`. Non-overlapping field edits still always merge.

## 0.15.0

Two-way GitHub sync is now a three-way merge — a concurrent edit no longer silently clobbers.

- **`reconcileSync` (the default `ztrack sync github` + auto-sync).** Drives the twin's pure
  three-way `reconcile(base, fork, real)`: `base` = the last-synced common ancestor (now
  persisted by ztrack at `.volter/sync/github-base.json`, since the fork is the markdown
  tracker), `fork` = the tracker, `real` = a fresh incremental pull. Non-overlapping concurrent
  edits MERGE field-by-field (local edits the title while GitHub edits the body → both survive);
  only a same-field collision is surfaced as a **conflict** (default policy `merge`) and left
  untouched on both sides for a human to resolve, instead of one side winning silently.
- `ztrack sync github --pull` / `--push` stay one-way; the no-flag default is the reconcile.
- Verified with the real twin engine (cursor connector + egress) against a stateful fake GitHub:
  field-merge preserves both edits, a title/title collision surfaces as a conflict with neither
  clobbered, and a settled sync is idempotent.

## 0.14.0

GitHub pull is now a real cursor-based incremental read — and stops dropping closed issues.

- **Cursor connector.** The pull moves off the twin's snapshot fold (`syncGithubFromReal`) onto
  the kernel's `runConnectorPoll` over a new `githubIssueConnector` (`src/sync/github/connector.ts`).
  Each poll asks GitHub only for issues whose `updated_at` advanced past a persisted cursor
  (`GET /issues?since=<cursor>&state=all&sort=updated`, paginated), shadow-diffs them, and saves
  the cursor 1 ms behind the newest update under `.volter/github/cursors/<owner>-<repo>.json`.
- **Bug fixed: closed issues now sync.** The old path defaulted to `state:'open'` and a single
  un-paginated page of 30, so closed issues (and anything past 30) were silently dropped. The
  connector reads `state:'all'` with pagination. Verified live against real GitHub.
- The pull's `OBSERVED_AT` sentinel hack is gone — the connector gets idempotency from the
  shadow-diff on real `updated_at`, so re-observing unchanged content is a genuine no-op.
- This makes ztrack the first consumer of the twin's shared poll framework; the connector is
  written to lift into `@volter-ai-dev/twin-github` unchanged.

## 0.13.0

The two usage models — opportunistic `check` and the `loop` (ralph) — unified onto one target
grammar, plus a permanently-linked tracker mode.

- **One check/loop target grammar.** `ztrack check` and `ztrack loop start` now take the same
  target: `<issue-id>` (one issue), `<file.md>` (a loose file validated as one issue),
  `--issues a,b`, or nothing — which means the whole tracker, or, inside a worktree named for
  an issue, just that issue (auto-scope, opportunistic). `ztrack check ./body.md` brings back
  file-checking (removed in 0.11.0) as one format among several.
- **Footgun fixed.** A positional that is neither a known issue nor a file is now rejected
  instead of being silently dropped — `ztrack check ZT-9` on a missing id errors rather than
  printing a false green.
- **Loop drives the gate by target.** `ztrack loop start <id|file>` records the target; the
  Stop-hook gate (`ztrack check --auto-scope`) holds the turn on THAT target (precedence:
  `ZTRACK_ACTIVE_ISSUE` > the armed loop > the git branch/worktree).
- **Linked-tracker init.** `ztrack init --sync github --repo o/n` records a permanent link in
  `tracker-config.json` and pulls the repo's issues. Afterward `ztrack sync` needs no `--repo`,
  and user-facing `check`/`loop start` best-effort sync the tracker with it (pull the latest,
  push local changes) — the gate never does, so a ralph loop doesn't hammer the API.

## 0.12.0

Two-way GitHub issue sync, through the twin.

- **`ztrack sync github --repo <owner/name>`** — syncs tracker issues with GitHub
  issues in both directions (default pull-then-push; `--pull`/`--push` to limit). A
  synced issue *is* the GitHub issue (an identity binding, stored at
  `.volter/sync/github.json`, not a `linkedIssue` field). Fine local lifecycle states
  (draft/ready/in-progress/in-review) stay local; only title/body/done-ness round-trip.
- **Incremental + idempotent — never a full re-read/re-write.** PULL folds real GitHub
  into the twin (`syncGithubFromReal`, delta-only) and writes only the issues that
  actually changed; PUSH morphs the twin per changed issue and flushes through the twin's
  egress idempotency ledger (`pushPendingGithubActions`), so an unchanged issue is never
  re-PATCHed and a re-push replays zero API calls.
- **Auth is the gh CLI or `GITHUB_TOKEN`** — never a prompted PAT.
- **Standalone provider module** at `src/sync/github/` (transport, mapping, identity
  bindings, pull/push orchestration). ztrack keeps no universal sync engine: the twin is
  the shared event-sourced substrate, and each provider is self-contained (mirroring the
  standalone presets). Future providers get their own `src/sync/<provider>/`.

## 0.11.0

Standalone-preset rearchitecture. This release removes the universal/generic model
entirely: each preset is now a self-contained module, and grammar is owned by the preset
in both directions.

- **Three standalone presets — `default`, `spec`, `speckit`.** Each is its own module
  (`boilerplates/presets/<name>.ts`) with its OWN strict Zod schema, `parse`, `serialize`,
  and `rules`, importing only the mechanism from `ztrack/preset-kit`. The shared
  generic system is gone: no `genericSchema`/`genericParser`/`createGenericPreset`, no
  flag-toggled mega-preset, no "rule library". The only shared spine is the core engine
  (`CoreRoot` contract + rule evaluation). **Removed presets: `basic`, `simple-sdlc`,
  `simple-spec`.** `default` is installed when `--preset` is omitted.
- **Init-first onboarding** (reverses 0.10.0's zero-config direction): `ztrack init
  --team APP --preset default` → `ztrack issue scaffold` → `ztrack check`. Removed the
  zero-config `ztrack check <file.md>` file mode and the `ztrack example` command.
- **Bidirectional grammar.** Every owning preset defines `serialize` (the declared inverse
  of `parse`) on the `Preset` contract. `ztrack fmt` is now `serialize(parse(x))` through
  the active preset — there is no separate canonicalizer. A preset that adapts an external
  source-of-truth (`speckit` over Spec Kit files) is read-only and omits `serialize`.
- **Mutation is `parse → edit the typed model → serialize`.** The universal write-grammar
  (`mutate.ts`) and the structured-mutation DSL are removed — gone are `ztrack ac
  check/uncheck/set-status/block/unblock`, the `tracker_ac_*`/`tracker_evidence_add` MCP
  tools, and the `## Evidence`/`[En]`/`AC-Version` apparatus. They are replaced by one
  grammar-free primitive: `ztrack ac patch <issue> <acId> --json '{...}'` / `ztrack issue
  patch` and the MCP `tracker_patch` tool (the patch is the preset's schema shape; the
  preset re-serializes it). `ztrack evidence add` is now a content-addressed blob-put that
  returns a `sha256:` ref to cite in a patch; DSSE/in-toto attestation is unchanged.
- **Universal, eslint-style waivers.** A per-issue `## Waivers` section (core-parsed,
  preset-agnostic) managed by `ztrack waiver sign/clear/status`; a waived finding is
  downgraded to `acknowledged`, and a waiver that matches nothing emits `waiver_unused`.
  `ztrack export` now carries the waivers in `root.json`, so `ztrack check --input` honors
  them; `fmt`/patch preserve the `## Waivers` section across a model round-trip.
- **No `linkedIssue` in core.** A synced issue *is* the external issue (identity, not
  linking); the `linkedIssues` primitive was removed from the engine.
- **Removed the autonomy-profile subsystem** — `profiles/`, the `ztrack-setup` and
  `ztrack-profile-check` bins, `scripts/setup-ztrack-repo.mjs`, and the `core-sdlc`/
  `speckit` source-only agent-loop examples — all flag-preset-era legacy coupled to the
  deleted generic model.
- Installed preset is `.mts` (ESM, so it loads under Node type-stripping in CommonJS
  consumer repos). **Node floor raised to 24.**

## 0.10.0

- **`ztrack check <file.md>` — zero-config, eslint-style.** Point it at any issue-markdown
  file and it validates with the bundled `basic` preset: no `init`, no backend, no team
  key. Commit citations are verified against the current git repo, so the red→green moment
  works out of the box. The bundled preset is compiled in-process (no on-disk install). With
  no file argument, `check` still validates the live tracker project as before.
- **`ztrack example`** — writes a self-contained `example-issue.md` whose checked AC cites a
  *fabricated* commit, plus the one-liner to run it. `ztrack check example-issue.md` → red;
  replace the fake SHA with a real one → green. The 15-second first-run demo.
- **README quickstart rewritten value-first**: it now opens with the zero-config
  `example` → `check <file>` red→green, and demotes the `init`/team/backend flow to an
  "Adopt it into your repo" section. New `example` command added to help, completions, and
  the e2e gate.

## 0.9.0

- **The Python/SQLite `local` backend is removed.** ztrack is now pure JS end to end —
  the markdown backend (`.volter/tracker/markdown/*.md`) is the only store. Node + git is
  the entire toolchain; no `python3`, no native/Bun SQLite, so Yarn PnP and every package
  manager work with zero extra configuration. This deletes `backend/tracker-local.py`
  (~2,500 lines), `backends/local.ts`, the dead `markdownPort.ts` porter, and the unused
  `bun:sqlite` evidence-blob path (blobs are content-addressed files peer to the issues).
- **`ztrack migrate-local`** — a one-time migration for projects still on `backend:
  "local"`: it reads the old `tracker.sqlite` (a tiny stdlib `python3 -c` dump — needed
  only for this one read) and rewrites every issue as markdown, then flips the config to
  `markdown`. The original `tracker.sqlite` is left in place as a backup. A live client on
  a `local` config now errors with a pointer to this command instead of reading an empty
  store.
- The Python-only Linear-emulation verbs (`sprint`, `user`, `query`, `milestone`, …) that
  never had a markdown implementation are dropped from the CLI help surface.

## 0.8.0

- **The default backend is now pure-JS markdown** — `ztrack init` stores issues as plain
  `.volter/tracker/markdown/*.md` files. **No Python on the happy path:** `npm install
  ztrack` + Node + git is all a new project needs. The Python/SQLite `local` backend (adding
  full-text search) stays available via `backend: "local"`. Existing projects are unchanged
  (their config still names whatever backend they chose).
- Fixed three markdown-backend gaps that flipping the default surfaced (it had never been the
  default, and each gap silently produced a *passing* check on an empty/mis-typed issue):
  - `--body-file` is now read on create/edit (was silently dropping the body → no acceptance
    criteria → vacuous pass).
  - `--state open|closed|all` filter by status **type** (the recovery scripts use `list
    --state open`), not a literal state name.
  - `create`/`edit` derive `stateType` from the state name (`Done`→completed,
    `Canceled`→canceled), so done-gates and canceled-exemptions apply.
- CI now exercises the full surface under the markdown default (it would have caught the
  above), and the package-manager compatibility matrix tests it for real.

## 0.7.2

- **Fix: `ztrack/package.json` was not importable** — `require('ztrack/package.json')` (and
  `import`) threw `ERR_PACKAGE_PATH_NOT_EXPORTED` because the `exports` map didn't list it.
  An `exports` field restricts subpath access to exactly what it lists, and tooling commonly
  reads a dependency's `package.json` (version checks, resolvers). Added
  `"./package.json": "./package.json"` (Node's recommended practice). Guarded in CI.

## 0.7.1

- **Fix: `ztrack check` failed on Node < 22.12 and under Yarn PnP** with `require() of ES
  Module … not supported`. ztrack is ESM (`"type": "module"`), and the installed
  `preset.cjs` does `require('ztrack/preset-kit')` — a `require()` of an ES module, which
  only Node ≥ 22.12 supports natively and Yarn PnP never does. ztrack promises Node ≥ 20, so
  this was broken on its own minimum. The `./preset-kit` export now has a `require` condition
  pointing at a self-contained CommonJS bundle (`dist/preset-kit.cjs`), so `require()` gets
  real CJS. Verified under pnpm, Yarn PnP, and with native `require(esm)` disabled (Node-20
  behavior); guarded in CI (`fresh-project-dry-run.sh` runs a check with
  `--no-experimental-require-module`).
- **Docs:** note that under Yarn PnP you should use `backend: "markdown"` (the default Python
  backend's helper script isn't reachable from inside PnP's zip store) or `nodeLinker:
  node-modules`.

## 0.7.0

- **New: `ztrack completions <bash|zsh>`** — prints a shell completion script for the CLI
  (top-level commands, subcommands, and the most-used flags). Tracker-independent. Install by
  sourcing the output: `source <(ztrack completions bash)` (or `zsh`). Listed in `ztrack
  help`; covered by real-CLI E2E in `demos/check-e2e.sh`.

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
