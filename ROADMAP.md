# Roadmap

ztrack is useful today as a local verification layer for task work. The roadmap
keeps the core local-first and deterministic.

## Near Term

- More copy-pasteable examples for GitHub Issues, Linear, and Jira workflows.
- Public CI examples for committed snapshot gates.
- Clearer docs for MCP and stop-hook agent integration.
- More install presets for teams that already use Spec Kit, OpenSpec,
  Backlog.md, or similar file-based planning systems.

## Later

- First-class shell completions.
- Optional bundled connectors for common tracker/source systems.
- Managed setup and support paths for teams that want help wiring ztrack into an
  existing workflow.

## Non-Goals

- No telemetry in the open-source core.
- No LLM-as-judge gate for `check`; fuzzy or subjective feedback belongs in
  `lint`.
- No forced migration away from the tracker your team already uses.
