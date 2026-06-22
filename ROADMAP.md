# Roadmap

ztrack is useful today as a local verification layer for task work. The roadmap
keeps the core local-first and deterministic.

## Near Term

- More copy-pasteable examples for GitHub Issues, Linear, and Jira workflows.
- Public CI examples for committed validated-root gates.
- Clearer docs for MCP and stop-hook agent integration.
- More install presets for teams that already use Spec Kit, OpenSpec,
  Backlog.md, or similar file-based planning systems.

## Later

- First-class shell completions.
- Optional bundled connectors for common tracker/source systems.
- Managed setup and support paths for teams that want help wiring ztrack into an
  existing workflow.

## Loop hardening (engineering follow-ups, in progress)

Follow-on work after the 0.5.0 ship (the autonomy loop + escapes + waiver + descope).
These make the honest paths work better and the loop tidier. The framing that governs
them (see `plugins/ztrack-gate`): the loop is **cooperative, not a sandbox** — none of
these tries to contain an adversarial agent (that's the harness's job). Checked off as
each lands, with the proof that shows it.

- [x] **R1 — Self-exempt is offered only after a genuine try, not on turn 1.** The Stop
  hook advertises the per-session exempt path on *every* held turn, which reads as a "press
  here to quit" button. Offer it only past the half-way point of the iteration budget
  (`n*2 > max`). *Proof:* `loop-gate-ci.sh` "R1" — exempt path absent on an early held turn,
  present once past half the budget. ✅
- [x] **R2 — Iteration cap holds-and-surfaces instead of silently disarming.** The cap
  removes the arm marker (so the agent isn't trapped) but leaves no trace, so a capped loop
  just vanishes. Drop a gitignored `.ztrack-loop-capped.json` breadcrumb; `ztrack loop
  status` reports it; `ztrack loop start` clears it. *Proof:* `loop-gate-ci.sh` "R2" — after
  the cap the hook exits 0, the marker is gone, the breadcrumb exists, `status` reports
  capped, a fresh session isn't trapped, and `start` clears it. ✅
- [x] **R3 — Loop state hygiene: sweep all per-session files on any disarm.** Green / cap /
  `loop stop` only remove the current session's iter file; stray `.ztrack-loop-iter-*` /
  `.ztrack-loop-exempt-*` linger. Sweep them all on disarm. *Proof:* `loop-gate-ci.sh` "R3" —
  plant stray files, go green / `loop stop`, assert none remain. ✅
- [x] **R4 — Move CI off the deprecated Node 20 actions runner.** Bumped
  `actions/setup-node@v4 → v5` (runs on Node 24) in `publish.yml`. *Proof:* the workflow
  references v5; the next publish run carries no Node 20 deprecation annotation. ✅
- [x] **R5 — Document the trust boundary and the descope scope.** Added a "Trust boundary —
  cooperative, not a sandbox" section to `plugins/ztrack-gate/README.md` and noted that
  descope counts toward done only on SDLC-gated presets (under `basic` the waiver is the
  durable escape). *Proof:* the doc sections exist. ✅
- [x] **R6 — Ship.** Released **0.6.0**: changelog + version bump, tagged `v0.6.0`. *Proof:*
  the publish workflow is green (typecheck, tests, consumer-path, loop-gate, then npm
  publish) and `npm view ztrack@0.6.0` resolves. ✅

**All items complete (0.6.0).** Next, if/when wanted: whether an in-loop agent should be able
to reach `loop stop` / `waiver sign` at all is a genuine product question left open under the
cooperative trust boundary (R5) — pick it up only if adversarial agents become a concern.

### Review follow-ups (post-0.6.0, multi-agent review)

Fixed and shipped (0.6.1): a `reason:`/`blocked-by:` parser collision that silently dropped
a real dependency (H1); `descopeReason` over-capture (M4); a done case with EVERY AC
descoped passing with nothing verified (M3); a waiver downgrading structural invariants like
block cycles / duplicate ids (H2 — now `waivable: false`); hook/CLI robustness (torn-write
guards); a gitignore migration so loop runtime files are ignored on repos `init`'d before the
loop existed; and the visualizer dropping all-acknowledged issues from the findings view.

Deliberately deferred (low value / out of scope, not bugs in the shipped path):

- [ ] **The standalone `default`/`speckit` presets reject `status: descoped`** (their AC
  status enums lack it). These are the **visualizer's** presets (not what `ztrack init`
  installs); descope is a generic-preset feature, so rejecting it is arguably correct — but a
  generic-preset tracker with a descoped AC, viewed under the default viz preset, could fail
  to parse. Add `descoped` to their enums if that combination matters.
- [ ] **The visualizer client isn't typechecked in CI** (separate Bun app, lazy-installed
  deps; only bundled, not `tsc`'d). Pre-existing; a `tsconfig` + a CI typecheck step would
  catch shape drift in the client.
- [ ] **`src/core/cli.ts` is an unwired dev entry** (no bin, nothing imports it) — dead-ish.
  Either wire it or delete it; it's the only non-test importer of the standalone presets.

### Testing posture — E2E-first (done; see TESTING.md)

The primary gate is the **real packed+installed CLI** (`demos/check-e2e.sh` for `check` rule
behaviors, `loop-gate-ci.sh` for the loop+waiver, `fresh-project-dry-run.sh` for install/MCP/
SDK, all in CI; `loop-e2e.sh` live-agent, manual). Unit tests are minimal and **surgical**:
the block graph, scope/ref grammar, AC-Version mutations, the mdast parser's exact output, the
waiver freshness/`waivable` logic, install-parity, and the viz-only presets. The
generic-preset behavioral tests were migrated out of `presetKit.test.ts` into `check-e2e.sh`.

- [ ] **Minor residual:** `src/scopeIntegration.test.ts` (3t) is now also covered E2E by
  `loop-gate-ci` (auto-scope) — kept for the precise routing-logic assertions, but it's the
  one remaining behavioral test with an E2E equivalent.

## Non-Goals

- No telemetry in the open-source core.
- No LLM-as-judge gate for `check`; fuzzy or subjective feedback belongs in
  `lint`.
- No forced migration away from the tracker your team already uses.
