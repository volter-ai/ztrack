# Roadmap

ztrack is useful today as a local verification layer for task work. The roadmap
keeps the core local-first and deterministic.

## Near Term

- More copy-pasteable examples for Linear and Jira workflows (GitHub Issues is covered by built-in
  linked sync).
- More install presets for teams on OpenSpec, Backlog.md, or similar file-based planning systems.

## Dialects — read the world's task lists as they are

The dialect engine and two built-in dialects (the status-emoji register and the checkbox roster)
shipped in 1.2.0; the stance and the engine are [docs/DIALECTS.md](docs/DIALECTS.md). Still to read
as lenses, each with its conformance fixture pair: numbered workstream sections
(`## 2. WS1 — title` with `**Acceptance:**` prose bars), decision-log tables keyed `#N` (recognized
to exclude and link, not import), and pre-registered experiment runbooks.

## Later

- Optional bundled connectors for common tracker/source systems.
- Managed setup and support paths for teams that want help wiring ztrack into an
  existing workflow.

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
  capped breadcrumb in `loop status`), never silent. See `plugins/ztrack` for the
  trust-boundary writeup.
