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
- [ ] **R6 — Ship.** Changelog + version bump + npm publish, gated on the consumer-path +
  loop-gate runs. *Proof:* the publish workflow is green and `npm view ztrack@<new>` resolves.

## Non-Goals

- No telemetry in the open-source core.
- No LLM-as-judge gate for `check`; fuzzy or subjective feedback belongs in
  `lint`.
- No forced migration away from the tracker your team already uses.
