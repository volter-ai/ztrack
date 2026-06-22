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

- [ ] **R1 — Self-exempt is offered only after a genuine try, not on turn 1.** The Stop
  hook advertises the per-session exempt path on *every* held turn, which reads as a "press
  here to quit" button. Offer it only past the half-way point of the iteration budget
  (`n*2 > max`). *Proof:* a `loop-gate-ci.sh` case grepping the hook message — exempt path
  absent early, present late.
- [ ] **R2 — Iteration cap holds-and-surfaces instead of silently disarming.** The cap
  removes the arm marker (so the agent isn't trapped) but leaves no trace, so a capped loop
  just vanishes. Drop a gitignored `.ztrack-loop-capped.json` breadcrumb; `ztrack loop
  status` reports it; `ztrack loop start` clears it. *Proof:* after the cap, hook exits 0,
  arm marker gone, breadcrumb present, `status` reports capped, `start` clears it.
- [ ] **R3 — Loop state hygiene: sweep all per-session files on any disarm.** Green / cap /
  `loop stop` only remove the current session's iter file; stray `.ztrack-loop-iter-*` /
  `.ztrack-loop-exempt-*` linger. Sweep them all on disarm. *Proof:* plant stray files,
  disarm, assert none remain.
- [ ] **R4 — Move CI off the deprecated Node 20 actions runner.** Bump the pinned GitHub
  Actions. *Proof:* workflows reference the new versions; the next run is clean.
- [ ] **R5 — Document the trust boundary and the descope scope.** State plainly that the
  loop is cooperative (an operator can `loop stop` / `waiver sign`; not prevented) and that
  descope-as-satisfied-with-reason applies to SDLC-gated presets. *Proof:* doc sections exist.
- [ ] **R6 — Ship.** Changelog + version bump + npm publish, gated on the consumer-path +
  loop-gate runs. *Proof:* the publish workflow is green and `npm view ztrack@<new>` resolves.

## Non-Goals

- No telemetry in the open-source core.
- No LLM-as-judge gate for `check`; fuzzy or subjective feedback belongs in
  `lint`.
- No forced migration away from the tracker your team already uses.
