# ztrack Documentation

Start here when using or extending ztrack.

## Use ztrack

- [Adopting ztrack](ADOPTING.md): add ztrack to an existing repository.
- [Examples](EXAMPLES.md): minimal local check, CI gate (local and GitHub-linked), and MCP loop.
- [Cookbooks](COOKBOOKS.md): runnable recipes and project-shape guides.
- [Evidence and attestation](EVIDENCE.md): cite, store (commit/attach), and verify proof; in-toto + DSSE signing.
- [AI agent playbook](AGENT-PLAYBOOK.md): includes a copy-paste `claude -p` adoption prompt.
- [Visualizer](../visualizer/README.md): `ztrack visualizer`, a local web view of issues, ACs, and findings.

## Extend ztrack

- [Preset reference](PRESETS.md): `default`, `spec`, and `speckit` install presets; add a rule; `preset upgrade`.
- [Programmatic API](API.md): run a check from code, issue CRUD, and the exports map.
- [Maintainer preset guide](../PRESET-GUIDE.md): how to design and review source-level preset internals.
- [Architecture](../ARCHITECTURE.md): package internals and the validation pipeline.

## Maintain ztrack

- [Releasing](RELEASING.md): npm and GitHub Action release checklist.
