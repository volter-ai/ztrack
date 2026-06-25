# ztrack Documentation

Start here when using or extending ztrack.

## Use ztrack

- [Guide](GUIDE.md): adopt into a repo, local check, CI gate, agent enforcement, visualize — one place, one recipe per task.
- [Evidence and attestation](EVIDENCE.md): cite, store (commit/attach), and verify proof; in-toto + DSSE signing.
- [AI agent playbook](AGENT-PLAYBOOK.md): the copy-paste agent adoption prompt and driving rules.
- [Visualizer](../visualizer/README.md): `ztrack visualizer`, a local web view of issues, ACs, and findings.

## Extend ztrack

- [Preset reference](PRESETS.md): choose a preset (`ztrack init --list`), the grammar, add a rule, `preset upgrade`.
- [Programmatic API](API.md): run a check from code, issue CRUD, and the exports map.
- [Maintainer preset guide](../PRESET-GUIDE.md): how to design and review source-level preset internals; adding a preset.
- [World integration](WORLD-INTEGRATION.md): validating against a mirrored world of external systems.
- [Architecture](../ARCHITECTURE.md): package internals and the validation pipeline.

## Maintain ztrack

- [Releasing](RELEASING.md): npm and GitHub Action release checklist.
