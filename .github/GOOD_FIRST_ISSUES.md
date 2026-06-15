# Good First Issue Drafts

These are launch-day seed issues to create after the public repo is live. Keep them small, concrete, and independently useful.

## Add a minimal GitHub Issues example fixture

Labels: `good first issue`, `docs`, `examples`

Body:

```md
Create a tiny example project under `examples/github-issues-basic/` that shows the smallest ztrack workflow against GitHub Issues.

Acceptance:

- Includes a README with setup commands.
- Includes one passing issue body and one failing issue body.
- Documents the expected `ztrack check` result.
- Does not require private credentials for the static example.
```

## Document the fake-SHA failure mode

Labels: `good first issue`, `docs`

Body:

```md
Add a short docs page explaining why ztrack treats a checked acceptance criterion with a missing commit SHA as a hard error.

Acceptance:

- Shows a minimal failing issue snippet.
- Shows the expected error code.
- Explains the fix: cite a real commit that exists in git.
- Links back to the Quickstart.
```

## Add shell completions notes

Labels: `good first issue`, `cli`, `docs`

Body:

```md
Investigate the simplest shell completion path for the ztrack CLI and document the current state.

Acceptance:

- Notes whether completion generation exists today.
- If it exists, documents install commands for zsh and bash.
- If it does not exist, proposes the smallest implementation approach without adding it yet.
```

