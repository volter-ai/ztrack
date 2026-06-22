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

- ~~First-class shell completions.~~ **Shipped (0.7.0):** `ztrack completions <bash|zsh>`.
  This was the first feature **dogfooded through the loop itself** — authored as a ztrack
  issue, armed (`ztrack loop start`), held while the ACs were claimed-but-unproven (the
  oracle reported the missing commit/evidence), and released only once real commit+evidence
  were cited. (Insight from the dogfood: you can't run a ztrack tracker from a checkout named
  `ztrack` without renaming the package — self-reference shadows the installed CLI.)
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

**All items complete (0.6.0).**

### Review follow-ups (post-0.6.0, multi-agent review)

Fixed and shipped (0.6.1): a `reason:`/`blocked-by:` parser collision that silently dropped
a real dependency (H1); `descopeReason` over-capture (M4); a done case with EVERY AC
descoped passing with nothing verified (M3); a waiver downgrading structural invariants like
block cycles / duplicate ids (H2 — now `waivable: false`); hook/CLI robustness (torn-write
guards); a gitignore migration so loop runtime files are ignored on repos `init`'d before the
loop existed; and the visualizer dropping all-acknowledged issues from the findings view.

All follow-ups now closed:

- [x] **Visualizer client typechecked in CI** — added `visualizer/tsconfig.json` and a CI
  step (`tsc --noEmit -p visualizer/tsconfig.json`). It passed at 0 errors. ✅
- [x] **`src/core/cli.ts` deleted** — an unwired dev entry (no bin, no importer, no test).
  Its standalone-preset exports stay used by the preset unit tests. ✅
- [x] **"`default`/`speckit` reject `status: descoped`" — verified a non-issue.** A configured
  ztrack project validates with the installed generic preset (`resolveTrackerValidation`),
  which supports `descoped`; the standalone-preset fallback (`server.ts:89`) only fires for
  no-config markdown viewing, where a `descoped` AC doesn't arise. A preset/data mismatch
  there correctly errors. No change. ✅
- [x] **In-loop agent reaching `loop stop` / `waiver sign` — settled as a Non-Goal** (see
  below): we do not build containment; that's the harness's permission layer. The cooperative
  boundary (R5) is the intended design, not a gap. ✅

### Testing posture — E2E-first (done; see TESTING.md)

The primary gate is the **real packed+installed CLI** (`demos/check-e2e.sh` for `check` rule
behaviors, `loop-gate-ci.sh` for the loop+waiver, `fresh-project-dry-run.sh` for install/MCP/
SDK, all in CI; `loop-e2e.sh` live-agent, manual). Unit tests are minimal and **surgical**:
the block graph, scope/ref grammar, AC-Version mutations, the mdast parser's exact output, the
waiver freshness/`waivable` logic, install-parity, the markdown serialization edges, and the
viz-only presets. The generic-preset behavioral tests were migrated out of `presetKit.test.ts`
into `check-e2e.sh`. (`scopeIntegration.test.ts` stays — it asserts the scope-routing
integration precisely against the `default` preset, which the generic-preset E2E doesn't
isolate.)

## Non-Goals

- No telemetry in the open-source core.
- No LLM-as-judge gate for `check`; fuzzy or subjective feedback belongs in
  `lint`.
- No forced migration away from the tracker your team already uses.
- **No containment of the in-loop agent.** The loop is cooperative: an operator (or the
  agent) can `ztrack loop stop`, `ztrack waiver sign`, or edit the tracker. These are
  operator tools, not access we try to prevent — real containment (what a process may run /
  read / write) is the harness's permission and sandbox layer, not ztrack's. ztrack's
  guarantee is narrower and honest: while armed, a turn ends only when the issue actually
  passes `ztrack check`, and every sanctioned way out is recorded (a waiver in the tracker, a
  capped breadcrumb in `loop status`), never silent. See `plugins/ztrack-gate` for the
  trust-boundary writeup.
