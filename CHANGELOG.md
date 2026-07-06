# Changelog

All notable ztrack release changes are recorded here.

## Unreleased

- **`ztrack check <file.md>` now recognizes document grammar** instead of lumping the file into
  one filename-keyed loose issue: a file with id-bearing headings (`## APP-1 — title`) is checked
  as the multi-issue document it is — every issue, intra-file relations included, identical to
  what registering it would validate. A stderr note says whether the file is a **registered
  source**; when it is not, the note offers `ztrack import <file> --register` (never runs it) —
  closing the silent gap where a hand-authored backlog file checked "green" while its issues
  never loaded into the tracker. Genuinely loose files (no id-bearing headings) are checked
  exactly as before.
- **The Claude Code plugin is renamed `ztrack-gate` → `ztrack`** (plugin 0.3.0): it now ships
  the `ztrack` skill alongside the gate hooks, so the old name undersold it — install is
  `/plugin install ztrack@ztrack`. Existing installs keep working: their hooks still fire from
  the installed copy, and gate-wiring detection (`loop start`'s arm-time heads-up) recognizes
  the legacy `ztrack-gate@…` plugin key alongside the new one, so a pre-rename install never
  false-warns. Re-install under the new name at your leisure.
- **The plugin ships the `ztrack` skill** (`plugins/ztrack/skills/ztrack/`): progressive-
  disclosure knowledge — findings → fix commands, resolution verbs, evidence rules,
  document-source authoring, loop etiquette, honest escapes — loaded the moment an agent
  meets a tracker or an armed gate. The repo-local `.claude/skills/ztrack` copy is pinned
  byte-identical in CI.
- **`ztrack init` now ends with real onboarding**: adaptive next steps (linked vs local), a
  "wire a coding agent" step naming the plugin + MCP alternative, and read-next pointers
  (GUIDE, AGENT-PLAYBOOK). It also warns at init time when `ztrack` isn't resolvable as a
  project dependency.
- **A dead validation oracle is surfaced, not silent**: commands that succeed without the
  preset (issue list/view, import, loop status, …) print a one-line stderr warning naming
  exactly what's broken and the fix (missing entrypoint, a Node that can't type-strip —
  diagnosed as too-old vs built-without-TypeScript — or ztrack not installed as a
  dependency). The probe never executes preset code.
- **Windows/CRLF document sources are supported end to end**: `import`, document-source
  write-back, and `fmt` parse in LF space and restore the file's own line endings on write;
  the old hard CRLF rejection is gone.
- **`import` no longer mints issues from document *structure* headings**: a bare heading
  with id-bearing issues nested under it is kept as structure (reported in the plan), while
  a bare leaf heading still becomes a new issue — matching how `issue list` reads the same
  file, now pinned by a cross-parser parity test.

## 1.0.0

- **First stable major.** Code-identical to 0.51.0 — no behavior changes. What 1.0.0 declares
  is the contract: from here ztrack follows semver proper, so the CLI flag surface (the
  declarative registry — every path validated at dispatch, no hidden flags), the package-root
  programmatic API, and the bundled preset contracts break only at a major version; minor and
  patch releases are safe to take. The release closes the 0.44→0.50 integrated whole-product
  review: every finding was either fixed in 0.50.1/0.51.0 or explicitly decided (nothing was
  frozen in by default).
- **GitHub Action: the moving major pin is now `volter-ai/ztrack@v1`.** `@v0` stays frozen at
  v0.51.0 forever, so existing `@v0` consumers keep working unchanged on the last 0.x; move to
  `@v1` to track 1.x. Exact-version pins (`@vX.Y.Z`) are unaffected. Docs and demo recipes now
  reference `@v1`, and the pre-1.0 stability warnings in README/API.md are replaced by the
  semver contract above.

## 0.51.0

- **Pre-1.0 flag-surface cleanup: three removals/tightenings, decided rather than frozen
  into 1.0.** (1) `--case` — the hidden accepted alias of `--issues` on `check` — is
  removed; `--issues` is the one spelling, and a stray `--case` now rejects loud as an
  unknown flag. (2) The two inert hidden flags are removed outright: `--verify-commits`
  (a no-op alias of `check`'s default-on commit verification) and `--blob` (the stray
  flag left from the long-removed content-addressed evidence store). Both now reject
  loud; `--no-verify-commits` — the real escape hatch for shallow/CI checkouts — is
  unchanged. The bundled GitHub Action no longer passes `--verify-commits` (it runs the
  CLI from its own checkout, so the action and CLI always move together per tag);
  SECURITY.md's fork-PR recipe and all demos drop the no-op flag. No hidden flags remain
  in the registry. (3) A non-repeatable value-taking flag given more than once — space
  form, `=` form, or a mix — now rejects loud on every command (`--issues given 2 times;
  it may be given only once`). Before, the handlers' first-wins parse silently dropped
  the later occurrences: `check --issues ZT-1 --issues ZT-2` checked only ZT-1 and
  exited 0. Registry-declared repeatables (`--source`, `--label`, `--add-label`,
  `--remove-label`) keep their union grammar byte-identically, and repeated bool flags
  stay accepted (idempotent). 23 new tests plus 6 flipped pins (960 → 983), the new
  rejection pins proven failing on the previous release.

## 0.50.1

- **A typo'd flag can no longer hide behind an omitted flag value.** The 0.49.0 dispatch
  validator's shared token walk unconditionally consumed the token after a known
  value-taking flag as its value — even one starting with `--` — while `optionValue` (the
  parser most handlers use) has always guarded against exactly that. So `issue list
  --state --stat done` exited 0 printing `[]` (the typo silently absorbed by the walk,
  the omitted-value flag silently dropped by the handler), `evidence add --name --typo
  file --commit` stored the file with the typo swallowed, and `waiver sign --code
  --typoflag id` gave a misleading missing-id error; only `check`/`export`/`import` were
  shielded, by their own legacy scans. The walk now applies `optionValue`'s `--`-guard,
  making the registry deliberately stricter than the backend parsers at the one shape
  where they diverged — the mismatch can only turn a silent wrong result into a loud
  pre-handler rejection. Deliberate consequence: a space-form value literally starting
  with `--` now rejects (use the `=` form); nothing shipped relied on the old shape. On
  `check`/`export`/`import` the registry's "Accepted flags:" error now fires before the
  legacy scan's wording for this shape. 15 new tests (945 → 960), swallowed-typo pins
  proven failing on 0.50.0.

## 0.50.0

- **One `--source` grammar everywhere — repeatable AND comma-separated, union, per-selector
  loud failure.** `check` used to read only the FIRST `--source` occurrence (a second was
  silently ignored) while `issue list` was repeatable-only (a comma-separated occurrence
  became one unknown selector) — two different grammars for the same flag. Both commands now
  share `splitSelectors`: every occurrence may be comma-separated, occurrences and parts
  union, order-preserving, deduped, on `check`/`export` and `issue list` alike. And the
  matcher now validates each selector individually: `--source real,typo` used to silently
  drop `typo` as long as `real` matched — a scoping tool narrowing to less than you asked
  for. It now fails loud naming every selector that matched nothing plus the available
  names, even when other selectors matched. The `--source=name,...` `=` form now works on
  `check`/`export` (its allow-list scan strips `=value` before checking, as `import`'s
  always did). Frontier (`--actionable`/`--blocked`) and source-less check paths still
  refuse `--source` unchanged; single-selector invocations are pinned byte-identical.
  21 new tests (924 → 945), including a partial-miss pin proven to fail on 0.49.x.

## 0.49.1

- **`evidence add` can no longer ingest a flag's value as the file.** The positional-file
  fallback took the first non-flag token, so `evidence add --name custom.png real.png`
  ingested **custom.png** (the name you chose!) instead of real.png — silently storing the
  wrong bytes when a file by that name existed — and `evidence add --name custom.png` with
  no file at all "succeeded" the same way. The fallback now uses `positionalArgs`, a new
  export of the 0.49.0 flag registry that shares its exact token walk with the dispatch
  validator (same `=` handling, same value consumption), so the two can never disagree
  about which token is a value. The no-file form now fails loud with the usage text. All
  working argument orders (`<file> --name <n>`, `--file`, `--name=<n>`) are pinned
  byte-identical. 12 new tests (912 → 924).

## 0.49.0

The flag surface becomes a grammar: a typo'd flag on ANY command now errors loud with a
did-you-mean, and the help text can no longer drift from what the parser actually reads.

- **Unknown flags reject at dispatch, everywhere.** `src/cliRegistry.ts` declares every real
  command path and the flags its parser actually accepts (42 paths, 115 flags); `main()`
  validates against it before any handler runs. `issue list --stat open` — a typo of
  `--state` — used to silently return the whole unfiltered list at exit 0; it now exits 1
  with `unknown flag(s) --stat (did you mean --state?)`. Previously only `check`/`export`/
  `import` had allow-lists (now derived from the same registry instead of hand-kept copies).
  A recognized value-taking flag still consumes its following token exactly as the parsers
  do, so every invocation that worked before keeps working byte-identically.
- **Help is now truthful.** Six documented `issue` verbs that never existed (`relate`,
  `relations`, `unrelate`, `history`, `comments`, plus a prose-only `get`) and dead flags
  (`--jq`, `--comments`) are gone from help; the three trivially-true ones are now REAL:
  `issue get` is a full alias of `view`, and `issue comment --body-file` / `issue close
  --comment-file` actually read the file. `issue edit`'s `--body` and the optimistic-
  concurrency preconditions `--expect-state`/`--expect-body-sha` are documented; `issue
  patch`/`delete` gained help entries whose flags render straight from the registry.
- **`ztrack help <x>` routes for real.** `help issue`, `help issue patch`, `help check` all
  land on the focused help (not the generic top-level dump); an unknown resource errors
  config-free with the resource list instead of printing generic help. `check <target>
  --help` prints usage instead of erroring on `--help` as an unknown flag.
- **`--flag=value` works in the backend.** `issue list --state=open` used to be silently
  ignored (full list back); `flagVal`/`flagAll` now accept the `=` form alongside the space
  form, mirroring `optionValue`.
- **Drift is pinned impossible.** A bidirectional registry↔help test per command group plus
  a source meta-scan (every parse-site flag literal in `src/` must be registered) mean a
  future flag can't be parsed undocumented or documented unparsed. 88 new tests (824 → 912).

## 0.48.3

`check --input` never crashes on malformed roots — it reports honest shape findings.

- **A malformed `--input` root under default flags reports `root_shape_invalid`, not a raw
  TypeError.** Feeding `check --input` a shape-broken root (say `{"issues": 42}`, or entries
  missing `acceptanceCriteria`) with commit verification on — the default — crashed with the
  preset's internal error (`input.root.issues.flatMap is not a function`) before shape
  validation ever ran, because the raw unvalidated root reached the preset's `loadContext`
  first. Now two layers guard the surface: `checkTrackerRoot` skips `loadContext` entirely
  when the root is too top-level-broken to have a usable `issues` array (validation is
  guaranteed to fail on shape, so no observed facts are needed — this also protects projects
  whose installed preset copies predate this release), and the two bundled presets that read
  `input.root` (`simple-sdlc`, `simple-gh-sdlc`) extract facts best-effort over garbage so
  deeper malformations (non-object entries, missing arrays) can't throw either. Well-formed
  roots behave byte-identically; the live `ztrack check` path was never affected. Run
  `ztrack preset upgrade` to pick up the hardened preset copies.

## 0.48.2

`check --issues` now actually works with `--input` — it used to be silently ignored.

- **`check --issues a,b --input root.json` scopes and errors loud.** The combination was
  silently inert: no scoping (the whole root was validated regardless of `--issues`) and no
  missing-id detection — a typo'd or stale id in a CI invocation validating a committed root
  passed with `ok: true`/exit 0, while the same ids on a live-tracker check error loud. Now the
  combination works like the live path: validation is scoped to the requested ids *within* the
  root (issue ids, unlike source provenance, are present in a materialized root — `--source` +
  `--input` stays refused), and a requested id absent from the root errors loud naming the
  `--input` file. The `--case` alias behaves identically. Unscoped `--input` output is
  byte-identical to 0.48.1. Programmatic callers: `checkTrackerRoot` honors `options.issues`
  and now sets `result.loadedIssueIds` from the root's `issues` array, same contract as
  `checkTracker` — waiver directives in the root apply regardless of scope, and a root too
  shape-broken to carry ids skips both scoping and the not-found report so the shape finding
  wins.

## 0.48.1

`ztrack import` no longer corrupts document sources that carry waivers.

- **A bare `Waivers` heading is recognized document-source structure, same as
  `Acceptance Criteria`.** Import used to treat `### Waivers` as a freeform heading and mint an
  issue id into it (`### Waivers` → `### ZT-2 Waivers`), creating a junk child issue titled
  "Waivers" and excising the waiver rows from the parent issue's body — so the parent's waiver
  died and the finding it acknowledged resurfaced as an error on the next `check`. Every
  document-source user who had ever waived was corrupted on their next import over that file.
  Now a bare `Waivers` heading (any level, any case) is reserved: never planned as an issue,
  never id-minted, and its waiver rows are never scanned or edited — importing a materialized
  file with waivers is a byte-identical no-op. An id-bearing heading like `## ZT-9 Waivers`
  still parses as an issue (already-corrupted files are not silently rewritten). A minted
  `Acceptance Criteria` block for loose checkboxes lands before an existing `Waivers` section,
  inside the issue's own content span.
- **Docs.** SOURCES.md's grammar-mapping table, the README, and the Guide state that
  `Acceptance Criteria` and `Waivers` sections are recognized structure that import never turns
  into issues.

## 0.48.0

Honest `check` output: one verdict per invocation, and scoped checks name the real cause.

- **`--fail-on-warning` no longer contradicts itself.** The exit code used to count EVERY
  finding — including `acknowledged` (waived) ones — while the pass/fail banner, the trailing
  exit-hint line, and `--json`'s `ok`/`summary.status` all ignored the flag, so an ack-only check
  printed "✓ passed / ✓ exit 0 / ok: true" and then exited 1. Now acknowledged findings never
  trip the flag (a signed waiver is the sanctioned escape; only real `warning`-severity findings
  count), and one computed verdict drives all four surfaces on both the plain and scoped/auto
  paths. Behavior changes to note: ack-only + `--fail-on-warning` now exits **0** (was 1); real
  warnings + `--fail-on-warning` now honestly reports **fail** on the banner and in JSON (was
  "passed"/`ok: true` with exit 1). Without the flag every surface is byte-identical to 0.47.1.
- **A scoped check on a schema-invalid issue surfaces the schema finding, never "not found".**
  `check <id>` on an issue that exists but fails preset shape validation used to error
  "issue(s) not found in the tracker" — actively misdirecting the agent that just wrote the bad
  value — because the id-presence check read the validated export, which is unset whenever shape
  validation fails. `checkTracker` now also returns `loadedIssueIds` (the ids the loader actually
  found, pre-validation), so the scoped check falls through and renders the real
  `wellformed_shape` finding with the exact path and enum (exit 1). Truly-missing ids still get
  the not-found error, and shape findings remain unwaivable.
- **`--auto-scope` active-issue resolution survives an unrelated shape-invalid issue.** The same
  export-unset fragility made the Stop-hook oracle misreport a perfectly valid active issue as
  "not in the tracker" whenever ANY other issue in a shared tracker was schema-invalid. It now
  resolves the active issue from `loadedIssueIds` and attributes the failure to the real
  `wellformed_shape` cause (still failing closed).
- **Docs.** ARCHITECTURE, the Guide, `check --help`, and API.md state the ack-exclusion rule and
  the all-surfaces-agree guarantee; API.md documents `loadedIssueIds` and that
  `TrackerCheckOptions.failOnWarning` is a CLI-only concern.

## 0.47.1

Doc truth pass — no behavior changes. Every agent-facing document now teaches the current
system with no legacy: the 0.46 per-occurrence waiver philosophy (`ref:` pins, `--ref`,
`waiver_overbroad`, `waiver migrate`) is in every teaching doc; the phantom `status: descoped`
escape (removed in 0.11.0) is gone from all guidance — the honest narrow-scope path is amending
the AC through the sanctioned write path; `--source` scoping (0.47.0) is discoverable from the
Guide, skill, and help text.

- **Situation routing.** README, Guide, agent playbook, the ztrack skill, bare `ztrack` help, and
  `init --help` now open by routing the reader's actual situation: issues already on GitHub →
  `init --sync github`; a pile of tasks and no tracker → `init` + `import --register`; then drive
  ONE issue (`loop start <id> --until done`) or burn the WHOLE backlog (PM dispatching one
  loop-armed subagent per `issue list --actionable` row).
- **Cold-start fixes** from a fresh-eyes agent run: the playbook's "Prove the gate" step names the
  actual write command (`issue edit --body-file`); `check --fail-on-warning` is documented; waiver
  row examples match real `sign` output; SOURCES.md states where `issue create` mints (first
  writable declared source) and how to place an issue elsewhere.
- **Guard tests.** `docsConsistency.test.ts` now pins the waiver-philosophy phrases per doc, bans
  `status: descoped` across all teaching docs (including ROADMAP.md/TESTING.md), and pins the
  frontier's `--parent`/`--source` rejection clause plus the `TrackerCheckOptions.sources?` API
  line — each proven failing on the pre-fix tree.

## 0.47.0

`--source` scoping: address one declared source by name across `issue list` and `check`.

- **`--source <name>` scopes `issue list` and `ztrack check`.** With 2+ declared `sources` you can
  now say "show me just the backlog" or "check only the issue-per-file directory" instead of always
  reading the whole union. Repeatable — multiple `--source` union; `check` also accepts a
  comma-separated `--source a,b`. A selector matches a source by its `name` (below) or the basename
  of its path (`--source tracker` reaches `.volter/tracker`). An unknown selector is a hard error
  listing the available names — never a silent empty result.
- **`name` on a source config entry.** A `sources[]` entry may carry an optional `name` — a stable,
  user-typeable `--source` selector. Omit it and the source stays addressable by exactly its `path`
  string (and that path's basename); add one (`"name": "backlog"`) to decouple the selector from the
  on-disk path or make it read nicely. Fully back-compatible: an unnamed source and every absent
  `--source` behave byte-identically to 0.46.0.
- **`source` is a selectable `issue list --json` field.** `ztrack issue list --json identifier,source`
  reports which declared source each row came from (by name), complementing the existing `path` field.
- **The dispatch frontier stays whole-graph.** `--source` is rejected on `issue list
  --actionable|--blocked` (like `--parent` already is): that view is computed over the whole
  cross-source dependency graph, and scoping it to one source would misreport blockers that live in
  another. Use plain `issue list --source` for a scoped listing.

## 0.46.0

Waivers become `// eslint-disable-next-line`: pinned to one finding, self-expiring.

- **`ref:` — pin a waiver to a single occurrence.** A `## Waivers` row may now carry
  `ref: <subject>` (`- code: X ac: Y ref: <sha> reason: … by: …`). It matches only the finding
  whose specific offending token (`Finding.subject`, e.g. the missing commit sha for
  `evidence_commit_not_found`) — or its `evidenceId` — equals `ref`, so it targets one occurrence and
  self-expires the instant the token changes: re-cite the evidence to a real commit and the waiver
  reports `waiver_unused`; cite a *different* bad sha and the new finding still fires. Previously a
  waiver matched by `(issue, code, ac)` alone — the coarse `/* eslint-disable rule */` form that also
  silenced *future/other* findings of the same code.
- **`waiver_overbroad` (warning) — one directive, more than one occurrence.** Fires whenever a single
  waiver silences more than the one finding it should: an *unpinned* waiver that hit a subject-bearing
  finding (it would also mask future/other occurrences → pin it with `ref:`), **or** a `ref:` whose
  subject recurs across ACs so the one pin matched several findings (→ scope it with `ac:`). The
  finding still downgrades (full back-compat); the warning names the exact subjects/ACs to pin. A
  `ref:` that lands on exactly one occurrence is never flagged. Alongside the existing `waiver_unused`,
  this keeps every waiver honest — a `ref:` is not a blanket licence for a value that appears twice.
- **`ztrack waiver sign` auto-captures the ref.** When the accepted `(issue, code, ac)` resolves to
  exactly one subject-bearing finding, `sign` pins it automatically; when several, it refuses and
  lists them so you pin one per occurrence. `waiver status` shows each row's pin and state.
- **`ztrack waiver migrate <issue> | --all`.** Rewrites legacy unpinned waivers into fingerprinted
  per-occurrence rows (one per suppressed finding, reason + signer preserved), idempotently — the
  migration path for pre-existing broad waivers.
- Rule authors opt in by adding `subject: (item) => …` to a rule; the four bundled presets set it on
  their `evidence_commit_not_found` rule. Structural invariants (`waivable === false`) remain
  unwaivable; sign-off + reason are still required.

## 0.45.0

The audit log is now wired into CLI writes (finishes ztrack #19's deferred item).

- **Every write surface now populates `.audit.jsonl`.** Previously the audit log — the append-only
  record the visualizer's created/updated/state-since timestamps derive from — was written *only*
  while the visualizer server was running; CLI-only and agent-driven usage produced nothing. Now
  ztrack runs one `observeChanges` pass over the preset-validated export and appends an entry per
  change after **every** mutation path: one-shot CLI commands (`issue create/edit/patch/close/…`,
  `ac patch`, `tx`, `waiver` grant/revoke, `import`, `sync`, and a GraphQL `api query` mutation),
  the **MCP server** (`mcp serve` — after each write tool, the agent-facing surface #19 most cares
  about) and the **GraphQL HTTP server** (`api serve` — per request), which each observe internally
  because a long-running server never reaches the CLI's after-command hook. It's **best-effort**:
  auditing never changes a command's exit code or output, and `ztrack check` remains the source of
  truth. Because it's diff-based, all callers share one log + baseline, serialized by a short
  advisory lock (`.audit.lock`, skip-on-contention) so two concurrent observers record each change
  once — the skipper leaves it pending for the next observe rather than writing a duplicate.
- **The log lives next to the store and is never committed.** It moved to
  `.volter/tracker/.audit.jsonl` (from a legacy `<root>/tracker/` sibling), and both it and its
  `.audit-state.json` baseline are gitignored on first write — it's per-clone, regenerable
  observability, not history-of-record, so a wired CLI never sprays untracked files into a repo.
  `ztrack init` (and MCP `tracker_init`) seeds an empty baseline for a fresh local tracker so the
  very first `issue create` is logged (a linked init, which pulls pre-existing issues, seeds
  silently instead).
- **Removed the never-called `setBaselineIssue`.** With the single `observeChanges` path now wired,
  the alternate rich-entry affordance had zero callers and is deleted.

## 0.44.0

Dead-code removal from the 0.43 review: the content-addressed evidence blob store is gone.

- **`blobStore.ts` and `evidence add --blob` removed (write-only dead code).** The blob store
  (`putBlob`/`hasBlob`/`getBlob`, keyed by sha256) was write-only in practice: `hasBlob`/`getBlob`
  had **no production caller**, no shipped preset rule ever read a blob back, and `putBlob` was
  reachable only through `evidence add --blob` — a flag whose own warning admitted the stored blob
  did nothing for verification. Storing bytes nothing ever reads is not a feature, so both the
  module and the flag are deleted. Attestation (`evidence keygen`/`export`/`verify`, via
  `attest.ts`/`dsse.ts`) is unaffected — it signs the validated `root`, never per-file blobs.
  **Migration:** `evidence add <file>` (the default) is the one honest form — it copies the file
  in and cites the path the gate verifies at the cited commit. A stray `--blob` is now inert
  (ignored), so existing `evidence add … --blob` invocations keep working and store by path.
- **Screenshot attestation drops its dead `blob` media branch.** `attest.ts` no longer reads a
  `blob` field into the in-toto screenshot predicate's `media` — the field could only ever have
  held a blob ref, which nothing produces now. Real screenshot evidence (committed `path` or a
  digest-pinned `url`) attests byte-identically.

## 0.43.0

One authored copy of the config shape (ZTB-26): `TrackerConfigSchema` is now the single source
of truth that the TypeScript type, the known-key table, and every config read derive from.
Plus the periphery brought inside the gate (ZTB-27): the world subpaths now honor the
optional-peer contract, and the #13 missing-peer behavior has a real CI gate. And the
code-health follow-ups from the 0.38 review (ZTB-28): docs that tell the truth about purity,
one implementation of the id-minting rule, and a dispatch-only cli.ts. Rounded out by the
review tails (ZTB-31): the missing-peer gate now covers the world-twin seam and pins what it
installs, and the last inline cli.ts command moved out.

- **`ztrack/world-annotations` and `ztrack/world-source-books` no longer crash without the
  peer.** Both public subpaths statically value-imported `@volter-ai-dev/twin`, so importing
  them in a project without the optional peer died with a raw `ERR_MODULE_NOT_FOUND`. The twin
  surface now loads lazily at call time through a `worldTwinRuntime` seam (same pattern as
  `sync/github/twinRuntime`), and calls without the peer reject with a clear
  install-instruction message instead. **Breaking for subpath consumers:** the exported
  functions (`listAnnotations`, `addAnnotation`, `validateServiceAnnotations`,
  `loadWorldSourceBooks`) are now async — `await` them. The dead, never-referenced
  `validateWorldAnnotations` export is removed.
- **New CI/Publish gate `demos/missing-peer-gate.sh`** packs the local tree, installs the
  tarball in throwaway projects with and without the peers, and asserts the real (non-mocked)
  #13 behavior under node: friendly `MISSING_TWIN_MESSAGE` without peers, the bun-hint
  (`NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE`) with peers under node, and a CLI that never crashes
  at startup.
- **Dead periphery removed**: `action.yml`'s unused setup-python step, the orphaned
  `types/volter-twin.d.ts` ambient shim (declared a package name that no longer exists),
  and the empty `demos/agents/` directory. `visualizer/bun.lock` (regenerated by the
  visualizer's auto-install) is now gitignored, and the CLI's world-store error message
  points at the real docs section (`docs/EVIDENCE.md`) instead of the long-gone
  `docs/WORLD-INTEGRATION.md`.

- **`TrackerConfig` is derived from the schema**, not hand-maintained beside it.
  `RawTrackerConfig = z.infer<typeof TrackerConfigSchema>` is what parsing yields;
  `TrackerConfig` narrows `backend` to the loaded backend name. The two hand-written mirrors
  in `types.ts` are gone, so a schema edit can no longer silently disagree with the type.
- **`KNOWN_KEYS` is generated** by walking the schema (optionals unwrapped, nested objects
  recursed, arrays as `[]` paths, records stopped at — their keys are data, not vocabulary).
  A test pins today's 11 entries byte-for-byte so vocabulary changes stay deliberate.
- **Both untyped-cast hatches are closed**: `JSON.parse(...) as TrackerConfig`
  (importDriver.ts) and `as Partial<TrackerConfig>` (config.ts) now go through
  `parseTrackerConfig`, so nothing claims the type without passing the schema.
- **Unknown category names fail closed** (`z.partialRecord` over `RULE_CATEGORIES`) — a typo'd
  weight was previously accepted and silently ignored; now it's a config error with the same
  did-you-mean help as any other unknown key, candidates sourced from the zod issue itself.
- **An AST-based guard test bans reintroducing the casts.** Review round 1 proved a regex
  guard evadable four ways (parenthesized types, `import()` qualifiers, multi-line casts,
  strings containing `//`); the shipped guard parses every non-test source file with the
  TypeScript compiler and flags any cast whose asserted type mentions
  `TrackerConfig`/`RawTrackerConfig` in any syntactic position. Name-aliasing evades by
  design — the target is accidental reintroduction, not deliberate laundering.

- **One id-minting rule, one implementation.** The issue-id rule (max numeric suffix across
  every configured source, any prefix, +1) lived twice — inline in `markdownBackend`'s
  issue-create path and again in the importer's `IdAllocator`, kept in sync only by a comment.
  Both now call one shared `IdAllocator` (`src/idAllocator.ts`), and a pin test asserts both
  paths mint the identical next id for the same mixed-prefix tracker state. Behavior is
  unchanged (verified old-vs-new against identical tracker states through both the create and
  import paths). Likewise `identifierFromCreateOutput` now has a single cycle-free home
  (`src/createOutputId.ts`); `ztrack/sdk` re-exports it unchanged — no public API change.
- **ARCHITECTURE.md tells the truth again.** The "one impure boundary" claim is scoped to the
  validation pipeline with the real I/O surfaces named (`core/gitWorld.ts`,
  `worldAnnotations.ts`, `worldSourceBooks.ts`), the import subsystem and the loop/Stop-hook
  gate mechanism now have module-table rows, and blobStore's write-only reality
  (`hasBlob`/`getBlob` have no production caller) is stated in the doc.
- **CLI polish, zero behavior change**: `cliEvidence`'s human-facing stderr lines render
  through `cliStyle` like the rest of the CLI (stdout JSON byte-identical); the inline
  `fmt`/`tx`/`lint`/`sync`/`ac|issue patch` handlers moved out of `cli.ts` into their own
  modules following the established pattern (`cli.ts` is dispatch-only for them, help output
  byte-identical); the board-scope doc-comment now states the real `'shared'` default; and
  the stability language is "pre-1.0" everywhere (docs/API.md previously said "pre-beta").

- **The missing-peer gate now proves the world-twin seam through the packed artifact.** A
  consumer-side node probe imports the installed `ztrack/world-annotations` subpath and calls
  an adapter: without the peers it must fail closed with `MISSING_WORLD_TWIN_MESSAGE`'s
  install hint (never a raw `MODULE_NOT_FOUND`); with the peers the same import must load
  cleanly under plain node (no bun-hint case exists here — `@volter-ai-dev/twin` ships
  compiled JS). The gate was mutation-tested: breaking the seam makes it fail.
- **The gate installs the peers pinned to the declared range.** The with-peers consumer now
  reads `peerDependencies` from `package.json` at runtime instead of installing `latest`, so
  a future twin `0.2.x` publish can't silently change what the gate tests.
- **More CLI polish, zero behavior change**: the `api query`/`api serve` command — the last
  inline multi-branch handler — moved out of `cli.ts` into `cliApi.ts` (dispatch-only, help
  and output byte-identical); `cliLint.ts` folds a redundant dynamic `import('./config.ts')`
  into its static import; `docs/PRESETS.md`'s impure-boundary phrasing is scoped to the
  validation pipeline, matching ARCHITECTURE.md.

## 0.42.0

The #13 docs finally ship (ZTB-25): the docs now tell the truth about optional peers, and CI
enforces that they keep telling it.

- **Stale "regular dependency" claims corrected everywhere.** README, GUIDE, EVIDENCE,
  ARCHITECTURE, and a `presetKit.ts` comment all still described the pre-0.38 world where
  `@volter-ai-dev/twin`/`twin-github` shipped inside ztrack. They now describe reality: optional
  peer dependencies you install explicitly, with `sync github` run under bun.
- **One canonical GitHub-sync recipe** (GUIDE § "GitHub sync since 0.38"): install the peers,
  run `bunx --bun ztrack sync github` (plain `bunx` honors the CLI's node shebang and hands off
  to real node — reproducing the exact TS-loading error the recipe exists to avoid), plus a
  working CI yaml on `oven-sh/setup-bun`. README/EVIDENCE/ARCHITECTURE link to it instead of
  carrying their own variants.
- **Semantic docsConsistency guards**: stale dependency phrasings are asserted dead across all
  docs; `demos/README.md` must inventory every `demos/*.sh` on disk (five previously undocumented
  scripts — including three actual CI gates — now have honest entries); every `package.json`
  `files` entry must resolve (killed the phantom `PRESET-GUIDE.md`).
- **Releaser + API docs corrected**: RELEASING.md's pre-release checklist now names the demos
  that ARE the CI/Publish gates (it named two that aren't and omitted the five that are);
  API.md documents `examinedIssues` in the check result shape; GUIDE documents
  `issue edit --project`/`--remove-project` with the real `project: { id }` shape.

## 0.41.0

The dispatch frontier (ZTB-30): `issue list` learns to answer "what can I work on right now?"

- **`issue list --actionable`** lists the dispatch frontier — issues that are not yet done and
  whose transitive blockers are all satisfied. An orchestrator can map `--json` rows (default
  fields `identifier,title,state`) straight to subagent dispatches. In-progress/in-review issues
  stay on the frontier with their status visible, so callers can distinguish claimed work.
- **`issue list --blocked`** names, per blocked issue, the *nearest* unmet upstream node(s) with
  their status — the first unmet hop along each dependency edge, not the full transitive closure.
  Satisfied intermediates are transparent (the walk continues through them), and cross-level
  blockers surface as AC refs (e.g. `ZT-1:dev/01`). A stalled wave is diagnosable from one command.
- Both views share one computation (`issueFrontier` over the unified dependency graph), are
  read-only/deterministic/offline, compose with `--state`/`--label`/`--search`/`--limit`/`--json`,
  and degrade honestly: with no relations anywhere, `--actionable` lists all non-done issues and
  `--blocked` lists none. Nonsensical combos (`--actionable --blocked`, `--parent`) fail loud.
- **Docs**: GUIDE and AGENT-PLAYBOOK now teach the full single-session orchestrator lifecycle —
  intake (backlog file / folder of mds / github import) → groom (`loop start <id> --until ready`)
  → order (blocked-by/blocks; `check` proves the DAG) → dispatch (query the frontier, one
  `--until done` loop-armed subagent per actionable issue, merge sequentially, re-query) — with
  the single-issue loop as the degenerate form.

## 0.40.0

Drive-to-stage loops (ZTB-29): `ztrack loop start` learns what "done" means.

- **`loop start <issue> --until <stage>`** records a target stage in the loop marker; the
  Stop/SubagentStop oracle (`check --auto-scope`) now holds the turn until the issue's status
  is at-or-beyond `<stage>` in the active preset's status-enum order AND check is green. A
  synthetic blocking `loop_until_not_reached` finding (explicitly non-waivable) carries the
  "not there yet" signal. Flipping the status early doesn't help — the target stage's own
  lifecycle gates keep check red until the work is real. Bare `loop start` keeps today's
  validate-current-stage semantics byte-for-byte; the hook script is untouched, so mixed
  plugin/CLI versions keep working.
- **Arm-time honesty.** Unknown `--until` stages fail loud at arm time with the preset's full
  vocabulary and a did-you-mean ("Nothing was armed."); no loadable status vocabulary refuses
  the arm rather than silently degrading; `--until` with a file or multi-issue target refuses.
  `loop start` also detects whether the ztrack-gate hooks are actually wired (plugin manifest +
  Claude settings heuristic) and warns — never refuses — when the gate can't fire, and warns
  when a bare arm targets something already green (the loop would disarm having held nothing).
- **`loop status` shows the target** (e.g. `loop armed → ZTB-24 until done`), and legacy
  markers (no `until`, or the old flat `issue` field) keep working everywhere.
- **Docs**: README, GUIDE, and AGENT-PLAYBOOK loop sections now teach both modes, including
  the authoring pattern — `loop start ZTB-x --until ready` holds a drafting agent until the
  issue has real ACs and passes ready's gates.

## 0.39.0

Schema-aware lifecycle writes (ZTB-23): the basic CLI write path now speaks the active
preset's vocabulary at write time instead of letting `ztrack check` discover the damage later.

- **`issue create --state` / `issue edit --state` validate against the active preset's status
  enum at write time.** An unknown value (e.g. `in_progress` instead of `in-progress`) now fails
  with exit 1, the preset's full status vocabulary, and a did-you-mean suggestion — nothing is
  written. Validation only engages when a preset with a status enum is loadable; repos without a
  validation entrypoint keep the previous permissive behavior.
- **`issue close --reason <unrecognized>` fails loud.** Unknown reasons used to fall through to
  the completed path silently; now they exit 1 listing the accepted values (`completed`,
  `canceled`) with no store mutation.
- **`issue_missing_assignee` fix hints are source-aware** (simple-sdlc and simple-gh-sdlc
  presets). For document-sourced issues the hint now points at the `assignee:` header line in
  the source file instead of suggesting `issue edit --assignee`, which does not work on document
  sources. Installed preset copies pick this up via `ztrack preset upgrade`.
- **Silently discarded header blocks now get a diagnostic on multi-issue documents.** A header
  line (e.g. `assignee: me`) glued to prose with no blank-line terminator used to be dropped
  without a trace, leaving only a puzzling `issue_missing_assignee`; the multi-issue document
  scan now emits `loose_header_ignored` naming the file and the offending line, matching the
  single-file path. Warning-only: it never flips a green `check` red.

## 0.38.1

A fast patch for two shipped features that failed ztrack's own validation, found by a
post-0.38.0 fresh-eyes review (ZTB-22).

- **`ztrack issue close` no longer poisons the store against `ztrack check`.** It used to write
  Title-case `Done`/`Canceled` into the state field while every shipped preset's status enum is
  lowercase — so the documented happy path (create → work → close) ended in `wellformed_shape`
  failures. `close` (and `--reason completed`) now writes `done`; stores already containing the
  legacy `Done`/`Canceled` values heal automatically on read (exactly those two strings — custom
  preset vocabularies pass through untouched, and Title-case `Done` left by old local-store
  migrations heals the same way). `close --reason canceled` now fails closed with an honest
  error: no shipped preset has a `canceled` status, so recording a cancellation as `done` would
  falsely claim completion — delete the issue or set a real status (plus a label) instead. The
  `issue close` help line reflects this.
- **`organization.lint.rules` (per-rule lint severity, `"warn"|"error"|"off"`) is now actually
  usable.** `ztrack lint` documented and read the knob, but the strict config schema didn't know
  the key, so any config that set it was rejected outright ("unknown key"). The schema, the
  `TrackerConfig` type, and the did-you-mean key table now all know `organization.lint.rules`,
  and the untyped cast that hid the gap is gone.

## 0.38.0

A trust-and-polish release, built from launch-week dogfooding: `ztrack` now installs lean by
default (the GitHub sync packages become optional peers, #13), and the surfaces that lied or
went silent under pressure now tell the truth — honesty fixes across check/sync/backend,
first-touch CLI traps (ZTB-18), a `ztrack lint` that reports its clean runs, dogfooding
friction fixes (ZTB-21), document-source/import robustness (ZTB-16), and the trust-boundary
fixes from upstream #12 and #19.

`ztrack` now installs lean by default — the GitHub sync packages are optional (#13).

- **`@volter-ai-dev/twin` and `@volter-ai-dev/twin-github` moved from `dependencies` to optional
  peer dependencies.** A plain `npm i -D ztrack` drops from ~25M/65 packages (with stray
  `volter-twin`/`world-github` bins and a react/react-dom tree) to ~15M/60 packages with only the
  `ztrack` bin. `ztrack sync github` now lazy-loads the peers and fails fast with an install hint
  (`npm install -D @volter-ai-dev/twin @volter-ai-dev/twin-github`) when they're missing; every
  other command is unaffected. When the peers ARE installed but the CLI runs under plain
  Node/npx, a distinct message explains that `@volter-ai-dev/twin-github` ships TypeScript-only
  source Node can't load from `node_modules`, and to run under bun instead — re-running
  `npm install` wouldn't fix that one. The `ztrack/world-annotations` and
  `ztrack/world-source-books` subpaths still require the `@volter-ai-dev/twin` peer, as their
  docs already stated.

Five honesty fixes to ztrack's own error/summary surfaces (check/sync/backend), so what ztrack
tells you never contradicts what it actually did.

- **GitHub sync errors now name the repo, the operation, and the likely fix.** `github connector:
  list issues failed (HTTP 404)` gave no repo name, no operation beyond the verb, and no hint —
  every failing repo in a multi-repo sync looked identical in the log. Each 4xx/5xx now reads
  `github connector: list issues (page N) for <owner>/<repo> failed (HTTP <status>)`, plus a
  targeted hint: 404 suggests the repo doesn't exist / is private / the token can't see it (check
  spelling and access); 401/403 suggests the token is missing, expired, or lacks scope.
- **The markdown backend's unsupported-command error now ends in a newline and points at `ztrack
  --help`.** The old stderr (`markdown backend: unsupported command "…"`) had no trailing newline
  (it could run into the next line of terminal output) and left the operator nowhere to go for the
  real command list.
- **`ztrack check`'s summary line can no longer contradict its own findings.** A malformed issue
  that fails shape validation (e.g. an empty title or an invalid status) has no `export` — the
  validated root never gets that far — so the old summary read `issues 0 • errors 2` while both
  errors cited `root.issues.0`, the one issue that supposedly didn't exist. `CheckResult` now
  carries `examinedIssues`, an honest fallback count of issues actually seen when validation
  failed before `export` could be populated; the summary prefers `export.issues.length` and falls
  back to it, never printing 0 while a finding cites that very issue.
- **`loose_header_ignored` now also fires when the header scan never starts at all.** The warning
  previously only fired once a header block was already in progress (`Assignee: me` then a bad
  line aborts it) — but when the FIRST line isn't header-shaped at all (e.g. `Summary: x` before
  `Assignee: me`), the scan never started, and the assignee silently vanished into the body with
  no diagnostic whatsoever. A later Title:/Status:/Assignee:-shaped line in that same first
  paragraph now emits the same warning. The already-fixed aborted-mid-block case is unregressed.
- **`ztrack init` no longer writes the dead `organization.check.categories` block, and `check
  --categories` now validates category names.** No shipped preset assigns any rule a category (all
  three declare `category: false`), so the block init wrote at every fresh project was inert —
  and `check --categories bogus=1` used to accept any name silently, filtering nothing. Unknown
  category names in `--categories` now exit 1, naming the valid options (`wellformed`, `sourced`,
  `code`, `visual`, `behavioral`); real category names are unaffected, and the engine's per-rule
  category/depth machinery is untouched for preset authors who do declare categories.

First-touch CLI polish (ZTB-18): five traps re-verified against the published ztrack@0.37.0 are
fixed, all pinned by tests.

- **`<verb> --help` is now a total function for every verb, including `api` and `migrate-local`.**
  Both used to fall through the hoisted `--help` check (cliHelp.ts had no branch for either), so
  `ztrack api --help` in an uninitialized repo hit `createTrackerClient()` and exited 1 with "No
  tracker config found", and `ztrack migrate-local --help` with a legacy `tracker.sqlite` present
  PERFORMED THE REAL MIGRATION. Both now print usage and exit 0 without touching config, creating a
  client, or running any migration.
- **Two "tracker"-branded strings now say "ztrack"**, and MCP's `serverInfo.version` now reads
  `package.json` (same source `--version` reads) instead of a hardcoded stale `"0.4.0"`.
- **`issue create` never mints a record the installed preset immediately rejects for a blank
  title.** An omitted `--title` now derives the title from the body's first `# Heading` line
  (mirroring `check.ts`'s loose-file fallback); with neither a flag nor a heading, create refuses
  at create time instead of minting a record `ztrack check` would reject. An explicit `--title`
  (including `''`) is unchanged.
- **`--project`/`--remove-project` are now documented** in `issue create --help` / `issue edit
  --help` (mirroring already-documented `--parent`) — verified against the backend: create honors
  `--project`, edit honors both; `issue list` has no `--project` filter, so it isn't claimed.
- **`ztrack init` now warns when `'ztrack'` isn't resolvable from the project** (the bare-`npx`
  case), naming the exact fix (`npm install -D ztrack`), instead of leaving that discovery to a
  later `ztrack check` failure with no forward pointer from init.

`ztrack lint` becomes real: it used to print NOTHING on a clean run (0 findings, silent, exit 0
— indistinguishable from a broken command) and shipped only three mechanical rules despite its
own help text promising weak/unverifiable-claim detection.

- **Plain-text `ztrack lint` always ends with a summary line.** `✓ ztrack lint: 0 findings across
  N issues` on a clean run, `✗ ztrack lint: M findings across N issues` when something fires —
  audible either way, never silent. Exit codes are unchanged (still 0 unless an `error`-severity
  finding fires or `--fail-on-warn` is passed with any finding); `--json` is unchanged, still
  exactly `{"findings": [...]}`.
- **New `weak_claim` warning rule**: a curated, case-insensitive, word-boundary lexicon of
  assertive-verification phrases ("all tests pass(ed)", "works perfectly", "fully verified",
  "fully tested", "100% working", "should work", "verified end to end") flags prose that reads
  like a verification claim. It skips fenced code blocks and inline code spans, and does not fire
  when the same item (the claim's own line plus its own nested evidence/proof lines) already
  cites evidence — a commit (`commit:`/`commit=` + hash), an `[E#]`/`[P#]`/`[source #]` ref, or an
  `uploads/*.png` path. The rule is honest about scope: it reads prose, not truth — its message
  says the claim "is not backed by cited evidence here," never that the claim is false.
- `lint --help` (`src/cliHelp.ts`) now names all four rules and the summary line, instead of the
  stale "flags weak or unverifiable claims" one-liner the three original mechanical rules never
  actually implemented.

Four CLI friction fixes (ZTB-21), all hit live while dogfooding 0.37.0 during launch prep.

- **`ac patch --json` proof errors now show the full expected shape immediately.** A malformed
  `proof` used to take two failed attempts to learn the real shape (first "expected object", then
  "Unrecognized key" only after guessing wrong again); the first error now states
  `{explanation: string, evidenceRefs: string[]}` — introspected from the preset's own zod schema,
  so the hint can never drift from what validation actually enforces. Flattened proof fields also
  get a `did you mean to nest these under "proof"?` hint, and both preset scaffold comments now
  show the real JSON shape instead of prose-only.
- **`sync github --pull` no longer misreports a first-ever pull as empty.** GitHub's issue-list
  API can lag a just-created issue; a first pull that observes zero issues now retries once
  (bounded, 2s), and if the lag outlives the retry it says so honestly on stderr instead of
  printing a clean 0/0. Safe because the connector never advances its cursor on a zero-observation
  poll.
- **The removed `ingest` verb now points at `import`.** `ztrack ingest <file>` used to die with a
  generic backend error; it's now caught at dispatch time with `did you mean 'ztrack import …'?`
  (plus a pointer to `evidence add` in case the old signed-evidence importer was meant).
- **`sync github --push --json`'s `total` can no longer contradict `created`/`updated`.** `total`
  used to count every local tracker issue regardless of whether the push touched it; it is now
  `created + updated + skipped`, with `skipped` reported as its own explicit field.

Document-source and import robustness (ZTB-16).

- **`issue edit <ID> --state <state>` now works on document-source issues.** Previously any state
  change failed closed with "splicing a status change is not implemented", forcing operators to
  hand-edit `status:` lines. It now splices just the `status:` header line's value in place —
  byte-identical everywhere else, composing with body edits in a single write — the same way
  `ac patch` already splices AC blocks. An item with no `status:` header line still fails closed
  with a clear message naming the file, never inventing a line. Assignee splicing remains
  unimplemented and still fails closed.
- **`ztrack import` no longer splits a multi-line `TODO:` item.** A `TODO:` line with indented
  prose continuation used to relocate only its first line into the Acceptance Criteria section,
  orphaning the continuation where it stood. The freeze guard that already protects multi-line
  checkbox items now covers `TODO:` paragraphs too — the whole item is either relocated together
  or left in place and named in the unmapped report, never split.
- **`src/modelEdit.ts` is plain text again.** A literal NUL byte used as an internal label-list
  comparison separator made git treat the whole file as binary (no rendered diffs, no 3-way
  merges). Rewritten as a `\x00` escape sequence — byte-identical at runtime, and a test now pins
  the source file as NUL-free.

Trust-boundary and honest-surface fixes from upstream issues #12 and #19.

- **`ztrack init` now tells you the installed preset executes as code.** A one-line notice at init
  (both the fresh-scaffold and already-initialized paths) points at SECURITY.md's trust model, and
  `check --help` carries the same clause — instead of leaving the trust boundary undiscoverable
  until you go looking (#12).
- **GraphQL queries now honor their selection set.** `executeTrackerGraphql` used to return every
  fetched field regardless of what a query asked for; it now filters recursively (including
  through connections and aliases) and returns an explicit error on fragments/directives instead
  of guessing. Routing no longer requires parentheses on root fields.
- **`client.snapshot()` no longer silently returns `null`.** The markdown backend's snapshot
  report is a stub; the SDK now surfaces the backend's "not yet implemented" stderr as a thrown
  error instead of an indistinguishable empty result.
- **`evidence add --blob` now warns it's write-only.** Stored blobs aren't consulted by any
  `ztrack check` rule today; the CLI says so on stderr and points at the path-based
  `evidence add <file>` instead.
- Removed the dead `acVersionForItemBody`/`acVersionFor` module (`src/acVersion.ts`, zero callers
  anywhere in src/visualizer/boilerplates/demos).
- Doc/comment corrections: `core/audit.ts`, `tx.ts`, and ARCHITECTURE.md no longer claim CLI
  writes are audited — today the audit log is populated only by the visualizer server.

## 0.37.0

Freeform backlogs become first-class: `ztrack import` rewrites mixed markdown (headings,
prose, checkboxes, `TODO:` lines) in place into the strict document-source grammar, so a
planning doc that previously parsed to zero issues becomes a fully gated source. Paired
with it, a round-trip integrity fix: prose inside an `Acceptance Criteria` section is now
diagnosed instead of silently dropped, and writes that would destroy it fail closed.

- **New: `ztrack import <path-or-glob>...` materializes a freeform backlog into a native document
  source, in place, idempotently.** Today, a plan/backlog file written as mixed markdown (headings,
  prose, checkboxes, no id tokens) parses to ZERO issues, silently — there's no minting anywhere,
  and write-back needs an id-bearing heading's span to splice into. `ztrack import` is a separate
  front door that materializes such a file (or a directory/quoted-glob batch of them, each its own
  document source) into the strict grammar: a heading without an id gets one minted; `- [ ]`/`* [ ]`
  checkboxes and `TODO:` lines outside a recognized `Acceptance Criteria` section are promoted into
  one with minted `dev/NN v1` ids; a headingless pure-checklist file promotes its top-level items to
  issues and their nested checkboxes to ACs. Id numbering is collision-safe across every configured
  source (and, for a multi-file batch, a single pass across the whole batch). A pre-checked `[x]`
  item ALWAYS imports unchecked, with the original claim preserved by an
  `(imported: previously marked done — needs evidence)` marker and a printed report — ztrack never
  mints `checked: true` or fabricates evidence. The writer is insert-only and idempotent: import
  twice is byte-identical to import once, importing after freeform edits touches only the new
  content, and existing ids are never altered or renumbered. `--dry-run` previews the plan/diff and
  writes nothing; `--prefix` overrides id inference; `--register` (opt-in) appends the resulting
  `sources` entries to `tracker-config.json` — never mutates config unasked, and never duplicates an
  already-declared source. CRLF input is rejected with a clear error, matching document-source
  write-back's own LF-only constraint. See
  [Sources → Importing a freeform backlog](docs/SOURCES.md#importing-a-freeform-backlog).
- **`simple-sdlc`/`simple-gh-sdlc`: prose inside a recognized `## Acceptance Criteria` section is
  no longer silently invisible.** ZTB-1 made a checkbox item OUTSIDE the section loud
  (`ac_outside_section`); the section's own interior had no matching guard — a bare paragraph, a
  blockquote, or a plain (non-checkbox) list item sitting between/around real AC lines had no
  branch in the mdast walk and no model field, so it vanished with zero trace (and a plain list
  item was silently mangled into a bogus AC entry). Both presets now emit a new warning diagnostic,
  `ac_prose_in_section`, for any such node — naming the issue id, an excerpt (first ~60 chars) of
  the content, and its source line — and no longer mint a spurious AC from a non-checkbox list
  item. Severity `warning`: it never gates a previously-green workspace, and every fixture that
  parsed clean before this change still emits zero diagnostics.
  **The round-trip guarantee:** this content sits inside the AC section, which `serializeIssue`
  rebuilds purely from the model — so writing an issue back would silently drop it on the very
  next `ac patch`/`issue patch`/`fmt`, the same defect class ZTB-10 fixed for bare leading prose.
  Because AC-interior prose can sit anywhere among the AC list items (not just once, before the
  first `## ` heading), preserving it byte-for-byte would need a much larger, position-tracking
  model change; instead, `ac patch`/`issue patch`/`fmt` now FAIL CLOSED whenever `ac_prose_in_section`
  fires for the target issue — the write is refused (nothing is written) with a clear error naming
  the prose, before any splice is attempted, matching every other document-source write guard's
  "nothing written on refusal" contract. Pinned by a real-CLI round-trip test against a
  document-source fixture: the file stays byte-identical after the refused patch.

## 0.36.0

Security and correctness fixes to the CI/fork-PR story and the markdown parser, plus a
loop-gate gap closed for subagents. The headline is a corrected security claim: the
GitHub Action's "safe path" never actually avoided executing an untrusted repo's preset —
now it can, via the new `ztrack check --preset` operator override.

- **Security fix: the GitHub Action's "safe path" claim was false — `--input`/`root` never
  avoided executing a preset.** The action.yml header comment, its `::warning`, and SECURITY.md
  all claimed that `ztrack check --input root.json --verify-commits` (the Action's `root`
  input) does NOT execute the repository's `preset.mts`, and recommended it specifically for
  untrusted fork PRs. That was wrong: `--input` skips reading the *live tracker store*, but
  `checkTrackerRoot` still calls `resolveTrackerValidation`, which always loads and executes a
  preset — there was no no-code fallback. A fork PR that edited `preset.mts` ran arbitrary code
  on the runner even when a workflow followed our own guidance exactly.
  **The honest contract now:** `--input`/`root` avoids reading the live tracker store; it does
  NOT avoid executing a preset — validation always executes one. `ztrack check --preset <path>`
  is new: it loads an operator-supplied preset module in place of the repo's configured
  entrypoint (unconfined to the project — the flag is the operator's own trust decision, like
  `eslint -c`), in every check mode (`--input`, live tracker, loose file). The GitHub Action
  gains a matching `preset` input. For fork PRs / `pull_request_target`, the safe combination is
  `root` (the PR head's committed data) **+** `preset` pointed at a preset from a checkout you
  trust (e.g. the base ref) — see SECURITY.md for the full recipe.
- **Fix: aborted header blocks no longer leak partially-parsed metadata.** `fileToRecord`
  (loose `ztrack check <file.md>` mode) and `parseHeaderBlock` (document sources' preamble
  `Title:`/`Status:`/`Assignee:` block) kept the title/status/assignee lines matched before a
  header block was aborted by a non-header-shaped line, even though the `loose_header_ignored`
  diagnostic already claimed those lines were discarded. Both scanners are now atomic, like
  `decomposeSection`'s per-item header blocks already were: an abort discards every line matched
  so far, not just the ones after it. For a loose file, an aborted block now falls back to the
  same defaults a headerless file gets — title from the first `# heading` else the filename id,
  status `draft`, no assignee. For a document source, an aborted **preamble** header block now
  mints **no umbrella issue** at all (same as a document with no `Title:` line) instead of an
  umbrella titled from the rejected block — its top-level id-bearing items get `parent: null`.
  Well-formed header blocks and headerless files are unaffected.
- **The loop gate also holds `SubagentStop`.** `plugins/ztrack-gate/hooks/hooks.json` now
  registers the identical hook command under `SubagentStop` as well as `Stop`, closing a gap
  where a subagent's turn — which ends via `SubagentStop`, never `Stop` — was never gated: a
  subagent that armed a loop for its own issue was never held by it, and an armed main agent
  could bypass its own gate by delegating to a subagent that returned "done" while the target
  stayed red. The gate is now root-scoped: while a root is armed, no turn ending in it — main
  agent or subagent — ends until the target is green. Isolation between unrelated loops comes
  from running them in separate worktrees, not from per-agent scoping within one root.
  `stop-loop.sh` derives a per-turn actor id (a subagent's `agent_id` when present, else the
  main-agent `session_id`) and keys the iteration cap and the self-exempt escape hatch to it,
  so a subagent's held turns don't advance its parent session's counter (or vice versa), and
  one actor's exemption doesn't leak to another. A bare `Stop` payload with no `agent_id`
  behaves byte-for-byte as before. `ztrack loop start` now also refuses to arm a *different*
  target while one is already armed in the same root (nonzero exit, marker unchanged) — so
  delegating to a subagent that arms an easier target can't route around an armed gate;
  re-arming the *same* target still succeeds as a refresh. A new `ZTRACK_TRACKER_ROOT` env var
  pins the gate to an explicit tracker root (skipping the upward directory walk) for a subagent
  whose cwd isn't under the tracker; an override that names a directory with no tracker fails
  open (a one-line stderr warning, exit 0) rather than trapping the turn.

## 0.35.2

The first published release of the 0.35 line — v0.35.0 and v0.35.1 were tagged but their
publish runs were blocked by two CI-only test-harness failures (no product code was
affected): a fixture depending on the runner's global git identity, and the check-e2e
script's "no assignee" case predating `issue create`'s assignee default (it must now pass
an explicit empty `--assignee` to mint an unassigned record). All 0.35.0 changes below
ship in this version.

## 0.35.1

Tagged, never published (see 0.35.2): fixed the create-defaults e2e fixture to pin its own
repo-local git identity instead of depending on the runner's global config.

## 0.35.0

Declared sources — a tracker can now span more than one markdown store, including a single file
that holds many issues — plus provenance on every finding and a round-trip fidelity contract for
preset authors.

- **Declared `sources`.** `.volter/tracker-config.json` accepts a `sources` array —
  `[{path, format?: "issue-per-file"|"document", readonly?}]` — so a tracker can union more than
  one markdown store. Omitting `sources` is byte-identical to today: one implicit `issue-per-file`
  store at the usual location. `issue list`/`issue view` union ids across every declared source,
  undeduped across sources on purpose — the same id backed by two different files is now a
  reported `issue_id_conflict` finding (error, unwaivable, names both paths) instead of silent
  precedence. A `readonly: true` source rejects every write (edit/comment/close/delete/`ac patch`)
  with an error naming the source, and `issue create` mints into the first writable
  `issue-per-file` source (a document source is never a mint target) while still counting ids
  across all of them so a new id never collides with a readonly one. Unrecognized
  config keys (top level or nested — e.g. a `source:` typo) now throw a config error naming the key
  and, via edit distance, its nearest valid sibling; this used to be silently spread through and
  ignored.
- **Document sources: one markdown file, many issues.** A source with `format: "document"` (or a
  bare `.md` path) treats a single file as a whole sub-tree of issues: any heading that starts with
  an id token (`## APP-1 — Title`) becomes an issue, heading nesting between id-bearing sections
  becomes parent/children, an optional leading `Title:`/`Status:`/`Assignee:` block makes the file
  itself an umbrella issue, and a per-item `status:`/`assignee:` header line inside its own section
  sets that issue's state/assignee. `ac patch` and an `issue edit` that only changes `title`/`body`
  splice the change back into the file byte-locally, touching only that issue's own span — every
  other issue is re-verified unchanged before anything is written (a non-ancestor's section
  byte-for-byte, an ancestor's own content instead of its raw bytes, since an ancestor's raw
  necessarily embeds a nested target's span). This lands splices on **leaf items at any nesting
  depth**: an item with an id-bearing child, or the umbrella, still fails closed like the rest.
  Everything else
  (state, assignee, labels, parent/children, comments, delete) is not stored in the document's
  grammar and fails closed, naming the file and the field, rather than silently dropping the edit;
  edit those fields, or delete, in the file directly.
- **Round-trip fidelity contract + conformance testkit.** For a writable preset, an unmodified
  `parse → serialize` is now required to be byte-identical for an already-canonical body, and
  editing one model element (an AC, a field) must change only the bytes that element owns —
  position, not just content, so a patch never relocates a human's untouched prose. Every shipped
  preset proves this through the shared kit (`src/testkit/presetConformance.ts`); see
  `docs/PRESETS.md`'s "Round-Trip Fidelity" section for the full contract.
- **`ac patch`/`fmt` no longer drop bare leading prose.** In the default-family SDLC presets
  (`simple-sdlc`, `simple-gh-sdlc`), content before an issue body's first `## ` heading that isn't
  a recognized metadata line (`Summary:`/`Children:`/`Blocks:`/`Blocked by:`/`Relates:`, plus
  `PR:` in `simple-gh-sdlc`) — a bare paragraph, a stray checkbox, a `###` sub-heading, a fenced
  code block — used to vanish silently on a patch/fmt round trip. It's now carried verbatim (a new
  `prose` model field), the same round-trip-fidelity choice this preset family already makes for
  unknown `## X` sections (`notes`/`notesBefore`). **Known remaining gap:** prose sitting INSIDE
  the `## Acceptance Criteria` section itself (between the heading and the checkbox list, or after
  the list) is still dropped — only the pre-first-heading preamble is carried by this fix.
- **Provenance on records and findings.** Every `IssueRecord` now carries an `origin: {path,
  lineStart?, lineEnd?}` and every `Finding` an `origin: {path, line?}`, populated from the
  markdown backend's already-resolved file path (and, for a document source, the issue's line
  span within the file). `ztrack check`'s report prints a dim, project-root-relative `path:line`
  suffix on findings that have one.
- **New fail-closed parsing diagnostics.** Four silent-failure shapes now surface as findings
  instead of quietly mis-parsing: `loose_header_ignored` (a loose file's `Title:`/`Status:`/
  `Assignee:` header block was aborted, or a header-shaped line survives in the body after the
  scan stopped), `ac_sections_multiple` (two `## Acceptance Criteria` sections — they still merge,
  but now warn instead of merging silently), `ac_outside_section` (a checkbox item outside any
  recognized AC section), and `ac_id_malformed` (an AC line that only parsed via the whole-line
  fallback).
- **`loop start`/`check` accept every id the backend mints.** The CLI's id-detection grammar used
  to demand an all-numeric suffix and rejected letter-suffixed ids (e.g. `ZL-A9`) that `issue
  view`/`issue edit`/every other verb already worked on. One shared predicate (`src/issueId.ts`)
  now backs it everywhere.
- **Bare `issue create` mints preset-conforming defaults.** With no `--state`/`--assignee`, a new
  issue used to default to state `Backlog` and no assignee — invalid against every shipped SDLC
  preset, so a fresh `ztrack init && ztrack issue create --title x && ztrack check` failed its own
  workspace's validation. Defaults are now `draft` (valid in every shipped preset) and the git
  `user.name` identity waivers already use; explicit flags override exactly as before. A create is
  never silently invalid: the new record is run through the installed preset immediately, and any
  findings print as warnings.

## 0.34.1

Reliability fixes for the visualizer and GitHub sync.

- **Visualizer no longer leaks immortal server processes.** The `ztrack visualizer` wrapper now kills its
  Bun server child on its own exit/SIGINT/SIGTERM/SIGHUP, and the server self-reaps when it sees its parent
  gone (it polls the wrapper pid passed via `ZTRACK_VIZ_PARENT_PID`, immune to bun cold-start reparenting).
  Previously a programmatic/agent teardown that SIGKILLed the wrapper orphaned the server to PID 1 forever;
  they accumulated across a busy fleet.
- **GitHub sync no longer crashes on a stale binding.** `pull` and `reconcileSync` now skip a bound issue
  whose local ztrack issue was deleted (the `issue view` returns null) instead of throwing.

## 0.34.0

Shared cross-worktree board (now the default) + a loop-gate scoping fix.

- **Shared local board across worktrees, now the DEFAULT.** A local tracker is no longer
  branch-scoped: issues are visible and globally-numbered across every git worktree of a repo via
  a central symlink index under the common git dir, regenerable from the committed markdown
  (fresh-clone safe). This lets a substrate-agnostic coordinator (e.g. a PM dispatching one
  worktree per issue) read every issue's live state without a remote tracker. Opt back into the
  old per-branch behavior with `ztrack init --branch`. **Breaking:** new local inits default to
  the shared board.
- **Fixed the `ztrack loop` Stop-hook gate scoping.** `stop-loop.sh` parsed a flat `"issue"`
  field the loop marker no longer writes, so the gate fell back to validating the whole tracker —
  on a multi-issue board it held the agent's turn on *any* red issue, not the armed one. It now
  reads the marker's canonical `target.ids[0]`; bare/auto/file targets stay unscoped so
  `check --auto-scope` resolves from the branch.

## 0.33.1

Documentation only — no code or behavior change (refreshes the npm package page).

- **Reframed the docs around the two usage patterns.** The README is now a two-step front door —
  **Setup** (install, local-vs-linked, preset, the loop gate) then **Usage**, presenting `ztrack
  check` (verify on demand — CI, pre-merge) and `ztrack loop` (the ralph loop — *recommended for
  development*) as two co-equal patterns over the same targets. The Guide mirrors the spine and the
  agent playbook leads with driving work under the loop.
- **Consolidated doc sprawl.** Merged `PRESET-GUIDE.md` into `docs/PRESETS.md`, folded
  `docs/WORLD-INTEGRATION.md` into `docs/EVIDENCE.md`, and removed a shipped design note and the
  redundant docs index — the learn path is now README → Guide → Presets → Evidence → API/Architecture.
- **Accuracy fixes verified against the live CLI:** completed the `simple-sdlc` rule-code list,
  documented `evidence_commit_unrelated` (opt-in `paths:` relevance), corrected `ztrack waiver
  status|clear <issue>` to show the required issue arg, added `--assignee` to `issue create|edit`
  help, fixed stale preset names in `ARCHITECTURE.md`, and signposted that there is no programmatic
  loop primitive (be the loop yourself via `checkTracker`).

## 0.33.0

Internal refactor sweep from the OSS-posture review — code organization and naming, no behavior
change. Five structural cleanups, each behavior-preserving and guard-backed:

- **Naming: markdown models out of the `presets` namespace.** `src/presets.ts` → `src/rawIssueMarkdown.ts`
  (the raw structured model: `parseRawIssueMarkdown`/`renderPresetCanonicalIssueMarkdown`),
  `src/presets/issueMarkdown.ts` → `src/markdownDocument.ts` (the lenient mdast read-model). The
  one-line `markdownModel.ts` alias is gone. They are document grammars, not presets — the old names
  conflated them with the validation presets.
- **Command-surface guard.** `docsConsistency` now fails CI if docs reference a `ztrack <command>`
  that no longer exists in the dispatch (the check that would have caught the phantom
  `snapshot project-manager`), and the linked-sync deep-dive moved from the README to `docs/GUIDE.md`.
- **Shared SDLC-grammar conformance kit.** `src/testkit/presetConformance.ts` exports
  `assertSdlcGrammarConformance(...)`; `simple-sdlc` and `simple-gh-sdlc` both call it instead of
  duplicating the relevance-gap / passed-AC / anti-tamper blocks. Preset-specific PR tests stay
  inline. Zero coverage lost (50/52 preset tests still pass).
- **Preset catalog split out of `config.ts`.** Manifest discovery + resolve + install + 3-way
  upgrade + `initTrackerProject` now live in `src/presetCatalog.ts` (a one-way dependency on
  `config.ts`); `config.ts` is back to path/config primitives (367 → 180 lines).
- **`cli.ts` decomposed (674 → 447 lines).** `init`, `loop`, and `waiver` extracted into
  `cliInit.ts`/`cliLoop.ts`/`cliWaiver.ts` as `handleXCommand(args): Promise<boolean>` handlers,
  matching the existing check/evidence/completions split.

## 0.32.1

Doc-truth fixes from an OSS-posture review (4 reviewers: adopter, contributor, two architects), plus
closing a hole in the drift guard that let them through.

- **Closed the `docsConsistency` guard's blind spots.** It now expands brace-lists
  (`boilerplates/presets/{a,b,c}.ts`) before checking existence, and validates every backtick-cited
  `src/**/*.ts` path — the exact gaps that let `ARCHITECTURE.md`/`TESTING.md` cite renamed files.
- **Fixed `ARCHITECTURE.md` drift** the guard now catches: the reference presets are
  `simple-sdlc`/`simple-gh-sdlc`/`spec`/`speckit` (not the renamed `default.ts`); `mutate.ts` →
  `modelEdit.ts`; `createTrackerClient` is markdown-only (the `local` backend is removed); and
  removed the phantom `ztrack snapshot project-manager` command (it doesn't exist).
- **Fixed `TESTING.md`** stale test-file references (`mutate.test.ts` → `modelEdit.test.ts`,
  `presetKit.test.ts` → `presets/issueMarkdown.test.ts`, `presetInstall.test.ts` →
  `presetUpgrade.test.ts`, preset names).
- **`CONTRIBUTING.md`**: added the required `bun run build` before `bun test` — the e2e suite
  resolves `ztrack/preset-kit` from `dist/`, so a fresh-clone `bun test` failed without it (the #1
  contributor bounce).
- **README**: added a "Stability & dependencies" note — pin a version pre-1.0; the local core is
  dependency-light, GitHub sync / world evidence route through `@volter-ai-dev/twin`.

## 0.32.0

Docs consolidation — one home per topic, plus a guard so they can't silently drift again.

- **Merged `docs/ADOPTING.md` + `docs/EXAMPLES.md` + `docs/COOKBOOKS.md` into one
  [`docs/GUIDE.md`](docs/GUIDE.md)** — a task-oriented guide (adopt → local check → CI gate → agent
  enforcement → visualize), one recipe per task, no duplication. The three docs taught the same
  flows three times, which is how preset names and recipes kept drifting out of sync.
- **Trimmed the README** to a front door: it keeps the quickstart, the honesty box, and the preset
  table, and now *links* to the Guide for the deep how-to (agent setup, CI) instead of duplicating
  it. The agent Stop-hook setup detail now lives once, in the Guide.
- **New doc-drift guard** (`src/docsConsistency.test.ts`, CI-only) fails the build if any doc has a
  broken relative link, cites a `boilerplates/presets/<name>.ts` that doesn't exist, or names a
  `--preset` that isn't a real preset/alias — the exact drift classes (renamed `default.ts`, deleted
  pages, stale preset names) that required repeated manual sweeps.
- Each fact now has a single source of truth: preset choice → `PRESETS.md` + `ztrack init --list`,
  evidence → `EVIDENCE.md`, programmatic use → `API.md`, the how-to flows → `GUIDE.md`. No
  user-facing behavior change.

## 0.31.1

Doc consistency + small UX fixes (from a second 6-persona new-user review of the published package).

- **Preset naming made consistent.** After the `default→simple-sdlc/simple-gh-sdlc` split, the docs
  mixed `default` (the alias) and `simple-sdlc` (the real name): the README "Install presets" table
  still listed `default` and omitted `simple-gh-sdlc` while the quickstart used `simple-sdlc`. The
  README table now lists all four presets (marking `simple-sdlc` recommended + `default` its alias)
  and points to `ztrack init --list`; README/ADOPTING/EXAMPLES/EVIDENCE/PRESETS prose now name the
  preset `simple-sdlc` consistently. `--preset default` still works everywhere (it's the alias).
- **Fixed dead `boilerplates/presets/default.ts` path references** (renamed to `simple-sdlc.ts`) in
  `PRESET-GUIDE.md` and `docs/PRESETS.md` — a contributor told to "copy the bar" hit a 404.
- `ztrack init` now **echoes the installed preset** (`Initialized ztrack team … • preset <name>`).
- `docs/ADOPTING.md` now surfaces `simple-gh-sdlc` for GitHub PR teams and routes through `ztrack
  init --list` instead of an outdated `default|spec|speckit` list.
- Documented the loose-file caveat (a `check ./file.md` runs structure+evidence but treats status as
  draft — lifecycle gates need a stored issue), fixed the `PR:` grammar example to a real PR URL
  (the merged-PR gate keys on the URL), and added a copy-paste `Stop`-hook `settings.json` snippet
  for non-plugin agent harnesses.

## 0.31.0

Manifest-driven preset discovery — so the preset catalog scales without a hand-maintained list.

- Presets are now **discovered by scanning** `boilerplates/presets/`. Each preset is two
  co-located files: `<name>.ts` (the standalone preset) + a new **`<name>.json`** manifest sidecar
  (`{ description, aliases?, recommended? }`). Adding a preset = drop those two files; nothing else
  to register.
- New **`ztrack init --list`** prints the catalog with each preset's description, the recommended
  baseline, and its aliases — generated from the sidecars, never hardcoded.
- Removed every hardcoded preset list: the `CanonicalTrackerPreset` union and `INIT_TRACKER_PRESETS`
  array in `config.ts`, the visualizer's static `STANDALONE_PRESETS` map (it now resolves
  `--preset <name>` via the manifest + a dynamic import), and the enumerated `--preset a|b|c` in CLI
  help/errors (now `--preset <name>` + a pointer to `--list`). An unknown `--preset` points to
  `--list`. `default` remains an alias for the recommended `simple-sdlc`.
- A guard test (`boilerplates/presets/presetManifest.test.ts`) fails CI if a preset lacks its
  sidecar, if there isn't exactly one `recommended`, if aliases collide, or if a preset's exported
  `name` doesn't match its filename — the class of drift that broke the visualizer in 0.30.0.
- Documented the workflow in `boilerplates/README.md` and `PRESET-GUIDE.md` (§4 build order + a "no
  central preset list" entry in the Never list).

## 0.30.1

Ships the 0.30.0 preset split (0.30.0's publish was blocked by a build break). Fix: the visualizer
(`visualizer/serverCore.ts`) and CLI help now reference the renamed presets (`simple-sdlc` /
`simple-gh-sdlc`) instead of the removed `default.ts`.

## 0.30.0

Split the dev-lifecycle preset along the one axis that varies — the acceptance proof — and make
the lean, PR-free process the baseline.

- **`simple-sdlc`** (new): the dev SDLC without the PR coupling. `done` = every AC
  passed-with-evidence (commit + proof; image optional) — no pull request, so it runs on a private
  repo with **no remote**. Keeps the full evidence integrity, relevance, and the opt-in dependency
  (block) graph. Drops `review_requires_pr` / `done_requires_merged_pr` / `evidence_sha_stale` /
  `current_head_unknown` and the `pr` field.
- **`simple-gh-sdlc`** (was `default`): the PR-based process (review on a PR, merged PR for `done`),
  renamed. The seed for richer GitHub validation (world annotations + sources) to come.
- **`default` is now an alias for `simple-sdlc`.** `ztrack init` (no flag) and `--preset default`
  install the lean preset; a repo previously recorded as `default` upgrades against `simple-gh-sdlc`
  so its PR process is preserved.

## 0.29.0

Make the `@volter-ai-dev/twin` dependency honest — it's a real, bundled dependency, not an
"optional peer."

- `@volter-ai-dev/twin` + `@volter-ai-dev/twin-github` are now regular **dependencies** (were
  declared as *optional peer* dependencies). They power `ztrack sync github` and world-backed
  validation, and were already being bundled into the CLI — so the "optional" declaration was a
  fiction left over from when twin was a private `@volter/twin` GitHub-Packages package. It's now
  public on npm, so it's a normal dependency.
- This **fixes** the `ztrack/world-annotations` and `ztrack/world-source-books` subpaths, which
  previously failed with `ERR_MODULE_NOT_FOUND` in a plain install (they import twin at runtime, and
  nothing guaranteed it was installed). They now resolve in any install.
- Removed a no-op `--external=@volter/twin` build flag (wrong scope name — it never matched the real
  `@volter-ai-dev/twin`, so twin was silently bundled anyway). The bundling is now intentional:
  `ztrack sync github` works from a plain `npm i ztrack` with no extra install step.
- Docs reconciled: `WORLD-INTEGRATION.md` and `ARCHITECTURE.md` described twin as a private
  GitHub-Packages optional peer requiring registry setup — all stale. Now: a public-npm regular
  dependency; world integration is opt-in by *policy* (your preset), not by installing anything.

## 0.28.0

Trim the published API surface to what's actually used.

- The `exports` map shipped **16 subpaths**, but ten of them (`ztrack/mcp`, `ztrack/lint`,
  `ztrack/tx`, `ztrack/attest`, `ztrack/dsse`, `ztrack/export`, `ztrack/config`,
  `ztrack/markdown-model`, `ztrack/ac-version`, `ztrack/presets`) were **internal CLI-command
  modules with no consumer** — nothing imported them, and their useful symbols are already
  re-exported from the package root. They are no longer published entry points (the modules remain
  internal; the bundled CLI is unaffected).
- **Supported surface is now**: `ztrack` (the root — the curated public API), `ztrack/preset-kit`
  (preset authoring), `ztrack/check` + `ztrack/sdk` (narrow imports the SDK demo uses), and
  `ztrack/world-annotations` + `ztrack/world-source-books` (the documented world-integration
  extension). See [docs/API.md](docs/API.md).
- Potentially breaking only if you imported one of the removed subpaths directly; switch to the
  package root (`import { … } from 'ztrack'`), which exposes the same functions. The CI export-smoke
  guard now enforces this minimal surface (and fails if a speculative subpath is re-added).

## 0.27.0

Documentation + discoverability pass (from a 6-persona new-user review) plus two small fixes. No
breaking changes.

- **Docs — new pages:** [`docs/EVIDENCE.md`](docs/EVIDENCE.md) (cite/store/verify evidence, commit
  vs attach, in-toto + DSSE signing — the evidence surface was previously CLI/`--help`-only) and
  [`docs/API.md`](docs/API.md) (run a check from code with `checkTracker`, issue CRUD with
  `createTrackerClient`, and the full exports map). Both linked from the README and docs index.
- **Docs — fixes:** the `docs/PRESETS.md` worked preset example was stale (old
  `parse(markdown)`/`serialize(root): string` signatures) — rewritten to the real
  `parse(records: IssueRecord[])` / `serialize(issue) => { body, columns }` contract, plus an "add
  one rule" recipe and a `ztrack preset upgrade` (3-way merge) section. Documented `--phase
  all|gate` and a **GitHub-linked CI gate** recipe in `docs/EXAMPLES.md`, plus the seven MCP
  `tracker_*` tools. Reconciled the storage design doc (Phase 3 shipped in 0.23–0.24, not "next").
- **Packaging:** `demos/` (incl. the SDK example) and `plugins/` (the `ztrack-gate` loop Stop hook)
  now ship in the npm package, so the README's hook reference and the SDK demo are reachable from an
  install. README hook path corrected (`plugins/ztrack-gate/hooks/stop-loop.sh`) and the two hooks
  (always-on `stop-check` vs armed-loop `stop-loop`) disambiguated.
- **Fix:** `ztrack ac/issue patch <unknown-id>` now fails with a clean `issue <id> not found`
  instead of leaking `Cannot read properties of null (reading 'assignee')`.
- **Fix:** `ztrack evidence export --format in-toto --sign` (a bare `--sign`) is now rejected with a
  hint to use `--sign-key <private.pem>`, instead of silently emitting an *unsigned* statement that
  could read as attested. Real DSSE signing via `--sign-key` is unchanged.

## 0.26.1

Security fix — a fabricated screenshot could pass the gate when the evidence fields were written in
a documented order.

- The default preset parsed an evidence line with an **order-sensitive** regex (`image=` had to
  precede `commit=`). The docs and `issue scaffold` show `commit=<sha> acv=1 image=<file>` (image
  **last**) — in that order the `image=` field was silently dropped, so the cited screenshot was
  never resolved or verified and a **fabricated image path passed `check` (exit 0)**. This
  contradicted the core "a fabricated screenshot fails" guarantee.
- Fix: evidence fields now parse in **any order** (`parseEvidenceLine` tokenizes `key=value`), in
  lockstep with the offline file-resolution scan. A cited `image=` is always captured and therefore
  always verified at its commit (`evidence_file_not_found`), regardless of field order. Regression
  tests added (fabricated image written after `commit` → caught; real image in that order → passes).
  Only the `default` preset was affected.

## 0.26.0

Relevance **enforcement** — make the opt-in `paths` anchor mandatory so every passed AC is checked.

- New **`config.relevance`** dial (default **`optional`**, fully non-breaking). Set it to
  **`required`** and the new **`passed_ac_missing_paths`** rule fails any passed AC that declares no
  `paths:` — turning 0.25.0's opt-in relevance check into full coverage: every passed AC's commit
  must now be anchored to (and verified against) the repo paths it claims to touch.
- The default preset's `loadContext` resolves the dial from disk (`relevanceMode`, re-exported on
  `ztrack/preset-kit`) and surfaces it on the validation context (`context.relevance`); the rule is
  pure and offline. Repos that don't set `relevance` see no change.
- The finding is self-documenting: it points you to declare the AC's `paths` (after which its cited
  commit must change one of them, via `evidence_commit_unrelated`).

## 0.25.0

Relevance check — a passed AC's cited commit must actually touch the work it claims.

- The default preset's AC now accepts an optional **`paths:`** line (comma/space-separated globs:
  `*` within a path segment, `**` across segments, else exact/dir-prefix). When a passed AC declares
  `paths`, its cited commit(s) must change at least one matching file, or the new
  **`evidence_commit_unrelated`** rule fails it — a deterministic, offline partial close of the
  relevance gap (an unrelated real commit that compiles + exists no longer satisfies the AC). It is
  strictly **opt-in**: an AC with no `paths` is unaffected, and the rule never fires when the cited
  commit's file list can't be resolved (a missing commit is reported once, by
  `evidence_commit_not_found`).
- `loadContext` resolves each cited commit's changed files offline via `git show --name-only`
  (exposed as `gitCommitFiles` on `ztrack/preset-kit`); the gate makes no network call.
- The finding is self-documenting: it points you to cite the commit that really changed the declared
  paths, or to correct the `paths:` line.

## 0.24.0

GitHub attachment evidence — store evidence on the linked repo instead of committing it.

- **`ztrack evidence add <file> --attach`** uploads the file to the linked GitHub repo as a release
  asset (the `ztrack-evidence` release) and prints `image=<url> sha256=<digest>` to cite. Auth is
  the gh CLI.
- The default preset's evidence now accepts a **URL `image=` pinned by `sha256=`**. `check` accepts
  it **offline** — the digest is a tamper-evident commitment, so the gate never makes a network
  call. (A repo-path image is still verified at its commit; a `sha256:` blob ref is untouched.)
- **`ztrack evidence verify [--issues a,b]`** is the network step the gate skips: it fetches every
  URL-pinned evidence and checks the bytes match the pinned digest — a swapped or rotted asset
  fails loudly. Private repos are fetched via the gh CLI; public over plain HTTP. Live-verified
  end-to-end against throwaway public and private repos (attach → check → verify, plus a tamper
  case that fails).
- `evidence.store` stays `commit` by default (offline, commit-verified, code-adjacent — the
  strongest model); `attach` is opt-in via the config or `--attach`.

(Linear/Jira attachment upload is not built — it needs accounts to develop and live-test against.)

## 0.23.0

Completes the evidence storage UX (the commit-based path; provider attachment upload is next).

- **`ztrack evidence add <file> [--name]`** copies a screenshot/artifact into the evidence dir
  (default `.volter/evidence`, committed), stamps its sha256, and prints the path to cite
  (`image=<path>`). Commit it → the `evidence_file_not_found` rule (0.22.0) verifies it exists at
  the cited commit. So the loop is: capture → `evidence add` → cite → commit → verified. `--blob`
  keeps the content-addressed form.
- **`config.evidence`** = `{ store?: "auto"|"commit"|"attach"|"external", dir? }`. `auto` resolves
  to `commit` today (committed evidence verifies at the cited commit, in both local and linked
  trackers); it will resolve to `attach` for linked trackers once provider upload lands.

## 0.22.0

Evidence is now real, and linked trackers work across git worktrees. **Breaking** (the evidence
grammar changed; see below).

- **Evidence is `commit + proof` at its core; the image is optional and verified when present.**
  Before, a passed AC required an `image=` token that was never checked — so `image=health.png`
  (a label pointing at nothing) passed. Now:
  - `image` is **optional** — author evidence as `evidence ev1: commit=<sha> acv=1` + a `proof`.
  - If you *do* cite an image as a repo path, a new rule **`evidence_file_not_found`** verifies it
    is actually committed at that commit (`git cat-file -e <sha>:<path>`, checkout-independent). A
    fabricated screenshot path now fails the gate. `--no-verify-commits` skips it (shallow/CI), and
    `sha256:` blob refs are left to the blob store.
  - **Breaking:** existing evidence citing a non-committed `image=` label will now fail — drop the
    image (keep commit+proof) or commit the file. Examples/docs updated accordingly.
- **Linked tracker cache is shared per-clone, not per-worktree.** The issue markdown cache + sync
  bookkeeping (reconcile base, identity bindings, conflicts) now resolve to
  `<git-common-dir>/ztrack/…` — one cache shared by every worktree of a clone, never committed or
  pushed (it's inside `.git`). Fixes the bug where a fresh linked worktree saw the link but 0
  issues. Local trackers are unchanged (issues stay committed and branch-scoped). Resolved at
  runtime via `git rev-parse --git-common-dir`; no symlink. See
  `docs/DESIGN-storage-scope-and-evidence.md`.

## 0.21.7

Fixes the actual first-time experience for external users on LTS Node:

- **`engines.node` lowered `>=24` → `>=22.18.0`** (the real minimum — native `.mts` type stripping
  is on by default from Node 22.18 / 23.6 / 24). The `>=24` floor was wrong: 0.21.x runs fine on
  Node 22 LTS, but because npm does **engine-aware version selection**, every user on Node < 24 was
  silently served the year-old **0.10.0** (different presets, no `--version`, none of this work) with
  no error or warning. Now Node 22.18+ installs the current version.
- **Clear Node-version error** when the preset can't load: instead of the cryptic
  `Unknown file extension ".mts"`, ztrack now says it needs Node >= 22.18 and to upgrade — for
  anyone who lands on an unsupported Node (e.g. via a lockfile or `--engine-strict=false`).
- README/docs prerequisites corrected to Node ≥ 22.18.

(0.10.0 is deprecated on npm so the remaining fallback path on Node < 22.18 shows an upgrade hint.)

## 0.21.6

Final panel pass — came back clean except one real hint bug:

- The `issue_missing_assignee` fix hint suggested `ztrack issue edit <id> --assignee`, which is
  correct for a stored issue but fails on a loose file (`check ./file.md`) where the id isn't
  stored. The hint now also gives the loose-file fix (add an `Assignee: <you>` line to the body).

The panel otherwise found no defects: red→green works on both init modes, every resource `--help`
and `--version` are config-free and side-effect-free, bad verbs fail loudly, `issue delete` works,
no warning noise, the gate fails fabricated commits on loose files / stored issues / exported
roots, and the docs honestly disclose what is not verified (commit relevance, image existence).

## 0.21.5

Third panel pass — confirmed 0.21.4 and caught the rest of the `--help` inconsistency:

- **`--help` now works on every resource.** `lint --help` used to silently RUN lint (exit 0, no
  output); `fmt`/`tx`/`mcp --help` errored instead of helping. All now print usage and exit 0 with
  no side effects, like the rest. Regression test sweeps `--help` across all resources.
- **Quickstart no longer commits `node_modules`.** The README's `git add -A && git commit` step now
  writes `node_modules/` to `.gitignore` first, so a verbatim follower doesn't commit dependencies.

(A panel report of "`--help` is config-gated before init" was investigated and is FALSE — `init
--help` and all resource `--help` print correctly in a fresh repo; verified against the tarball.)

## 0.21.4

A re-run of the multi-perspective panel against 0.21.3 confirmed the earlier fixes and found a
few more CLI footguns:

- **`--help` no longer executes the command.** `ztrack init --help` used to *provision a tracker*
  and `ztrack loop start --help` used to *arm the loop*, because no resource-help case matched and
  they fell through. Both now print usage with no side effects (added `init` and `loop` help, plus
  a regression test asserting `init --help` creates no `.volter`).
- **`ztrack --version` works.** It used to return "unsupported command" / "no tracker config" with
  an inconsistent exit code; now `--version` / `-v` print `ztrack <version>` standalone, never
  touching config.
- **`--policy` is now in `sync github --help`** (it was documented in the README and accepted by
  the CLI, but invisible in help).
- **`issue delete`** is supported on the markdown backend — a fat-fingered issue can be removed
  (previously only `issue close --reason canceled` existed; deletion failed as "unsupported").
- **`issue create` output** terminates with a newline so the JSON and the `✓ created <id>`
  confirmation no longer run together on one line.
- README prerequisite notes *why* Node ≥ 24 (the `.mts` preset needs native type stripping).

## 0.21.3

Second pass on the multi-perspective onboarding review — the remaining friction the panel found:

- **No more `ExperimentalWarning: Type Stripping` on every command.** The installed `preset.mts`
  loads via Node type-stripping, which printed that experimental notice before every command's
  output and read like a fault. The CLI now drops exactly that one warning (every other warning,
  including other experimental ones, still passes through).
- **`--verify-commits` was a documented no-op.** Commit existence is verified by DEFAULT (it's the
  core guarantee); the flag did nothing and there was no way to turn verification OFF. Now
  `--no-verify-commits` is a real escape hatch for shallow/CI checkouts that lack the cited commits
  (and would otherwise fail closed); `--verify-commits` stays accepted as a no-op alias. Docs no
  longer teach the redundant flag.
- **`issue create` now confirms.** It still prints the new issue as JSON on stdout (pipeable), but
  adds a `✓ created <id>` line on stderr so a human can tell it worked instead of reading a wall of
  JSON as a possible error.
- **`loop start` stops overpromising.** Arming the loop wires no Stop hook by itself, so the message
  no longer claims the gate "now holds the turn" — it says it does so *once the ztrack-gate Stop
  hook is wired*.
- **Linked-sync model is documented in the README** (was CHANGELOG-only): GitHub is the source of
  truth and the local issue store is gitignored in linked mode; pull-then-push field-level
  reconcile; same-field collisions raise an unwaivable `sync_conflict` that gates `check`; and the
  `--policy merge|hub-wins|twin-wins` resolution lever.

## 0.21.2

New-user onboarding fixes surfaced by a multi-perspective review of the published npm artifact
(impatient first-runner, skeptical adopter, AI agent, GitHub-linked team):

- **Quickstart red→green actually works now.** The README's flagship example told you to "replace
  the fabricated SHA and re-run — it passes," but a fresh `git init` has no commit to cite and
  editing `body.md` doesn't touch the already-stored issue, so the headline demo dead-ended. It now
  shows the working sequence: commit, cite the real SHA, `ztrack issue edit --body-file` to
  re-import, re-check. Also fixed the example's issue id (`LOCAL-1`, the default team — was `ZT-1`).
- **Unknown verbs no longer exit 0.** A fat-fingered backend verb (e.g. `issue update`, whose verb
  is `edit`) printed `unsupported command` but exited 0 — a silent no-op a script or agent reads as
  success. A backend error (stderr, no stdout) now exits nonzero. Regression-guarded.
- **Linked init no longer lies about pulling.** When the initial GitHub pull is skipped (no auth),
  the next-steps no longer claim "your GitHub issues were just pulled in" — it now tells you to set
  up auth and run `ztrack sync github`.
- **Honest boundary documented.** The README now states plainly what the default preset does _not_
  verify: that the cited commit is *relevant* to the criterion (an unrelated real SHA passes) and
  that referenced image files exist on disk (structural strings unless your preset resolves them).

## 0.21.1

- **Universal fix-hint floor.** A finding the preset gives no specific hint for — an uncovered
  code, or any finding under a preset (spec/speckit) that does not implement `fixHint` — now still
  gets a located fallback from the core: `Fix <issue>: `ztrack issue view <issue>`, then fix … —
  or accept it: `ztrack waiver sign …``. Preset-specific hints still win; the floor only fills
  gaps, so EVERY finding is self-documenting regardless of preset.

## 0.21.0

- **Findings are now self-documenting.** Every `check`/`loop` finding carries a one-line
  remediation hint — the exact action that resolves it, located to the issue/AC:
  `↳ Fix: ztrack ac patch APP-1 dev/01 --json '{"evidence":[…]}'  (\`ztrack ac --help\` for the
  schema)`. Preset-owned via the new `Preset.fixHint` (the fix is the preset's mutation grammar);
  shown under each finding in the CLI and returned in the MCP `findings` so an agent acts directly
  instead of inferring the fix. The skill teaches the model, the finding gives the next command.
- **A `.claude/skills/ztrack` skill** packages the resolution model (the check/loop loop, the
  `ac patch`/`issue patch`/`waiver sign` verbs, honest-evidence rule) so a skill-aware agent is
  fluent before it hits a finding.
- Verified self-closing: a black-box test resolves a red AC *purely from the finding's fix hint*
  (no hard-coded `ac patch` knowledge) → green. The loop closes from the finding alone.

## 0.20.3

- **Fixed: a pulled issue's local edit didn't sync back to GitHub.** The one-way `pull()` (used by
  `ztrack init --sync` and `sync --pull`) didn't seed the reconcile base, so the first
  bidirectional `sync` after a pull saw a locally-developed issue as a both-sides change and
  refused to push it (a phantom conflict — `pushed: []`, GitHub kept the old body). `pull()` now
  seeds the base (a pull IS the common ancestor). Found by the full-scale LINKED development
  simulation (`simulateLinkedProject.ts`): 25 features synced to a real GitHub repo, each
  developed + pushed (GitHub reflects it) with the adversarial gate still catching every fake, and
  a convergent idempotent re-sync. The 7 prior GitHub e2es never hit it — it only shows when you
  develop a pulled issue at scale.

## 0.20.2

- **Fixed: the visualizer showed zero issues for every configured tracker.** Two latent
  regressions from the structured-metadata redesign — `configuredBoard` destructured the old
  `{ bundle }` from `loadValidationInput` (now `{ records }`) and, worse, didn't `await` the
  now-async `resolveTrackerValidation`, so `preset` was a Promise and `check` saw no `parse()`
  (`/api/board` returned `parse_failed` + an empty board). Caught by strengthening the e2es from
  liveness checks to real-data assertions: the visualizer test now hits `/api/board` and asserts
  the seeded issue is served, and the MCP test runs a real develop loop (check passes → an MCP
  write makes it fail → re-check catches it) instead of a single call.

## 0.20.0

- **The issue store is now committed for a local tracker** (and still ignored for a linked one).
  Testing the real dev workflows found `.volter/tracker/markdown/` was always gitignored, so a
  git **worktree, a fresh clone, and CI all saw an EMPTY tracker** — the per-worktree gate the
  Stop hook advertises was broken, and `ztrack check` in CI on a fresh clone was a silent
  false-green. Now `ztrack init` commits the store (clones/CI/worktrees verify the real issues),
  while `ztrack init --sync github` keeps it ignored (GitHub is the source of truth; `ztrack sync`
  repopulates the local cache). The sync runtime (`.volter/github/`, `.volter/sync/`) is always
  ignored. Verified: branch-scoped check/loop in a real git repo; a fresh clone of a local
  tracker sees + verifies the issues; a linked init still ignores the store.

## 0.19.2

- **Audited every taught command line + fixed stale help.** Running the whole taught surface
  caught: `ac --help` taught a removed DSL (`ac check|uncheck|set-status` — "unsupported
  command"; the real command is `ac patch`); `check --help` showed a short stale usage that
  **shadowed** the real target-grammar help; `issue --help` omitted `patch`; and docs taught bare
  `ztrack fmt` (it needs `--issue`/`--input`). All fixed. The cookbook e2e now exercises the full
  surface (issue list/view/patch, ac patch, export, lint, fmt, loop, waiver, completions, sync
  error, server-command recognition) and asserts the help matches reality, so it can't drift.

## 0.19.1

- **Cookbook-tested the documented recipes.** A new black-box cookbook e2e runs the README
  quick-start verbatim — and caught that "Two ways to start (A)" ended RED (it dropped
  `--assignee me` and reused the demo's fabricated-commit body, so `check` failed on
  `issue_missing_assignee`). Fixed the recipe to the verified-green flow (scaffold → create
  `--assignee me` → check). The cookbook keeps every documented command (check / check &lt;id&gt; /
  check ./file / loop gate / the fabricated-commit demo) honest in CI.

## 0.19.0

- **Onboarding reflects the actual scenarios.** `ztrack init` next-steps now adapt: a LOCAL
  init walks scaffold -> create -> check; a LINKED init (`--sync github --repo`) goes straight to
  check / loop / sync (your GitHub issues were already pulled), and both surface the check target
  formats (`<id>`, `./file.md`, in-a-worktree auto-scope) + the ralph loop. The README adds a
  "Two ways to start" block (local vs GitHub-linked) and shows `check`/`loop` as the daily verbs
  over one target grammar.

## 0.18.0

- **Conflicts render in the issue.** Alongside the gating `sync_conflict` finding, an unresolved
  conflict now writes a `## Conflicts` block into the issue body listing each field's local vs
  remote value — so the agent sees both values right where it edits. The block is LOCAL-ONLY:
  stripped from the body the sync reconciles/pushes (it never leaks to GitHub) and removed
  automatically once the conflict converges. Mirrors the core's `## Waivers` handling.

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
