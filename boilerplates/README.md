# ztrack Boilerplates

Boilerplates are optional starter assets that sit above the ztrack core.

## Validation Starters

Every `ztrack init --preset <name>` copies an editable validation runtime into
`.volter/tracker/validation/preset.cjs`.

- `basic`: lowest-friction evidence gate for unknown repos.
- `simple-sdlc`: basic evidence plus a small lifecycle gate.
- `simple-spec`: structured spec issue sections plus evidence gates.
- `speckit`: Spec Kit-shaped issue sections plus evidence gates.

After installation, the file belongs to the target repo. Editing it is how a
team customizes ztrack.

## Source Checkout Examples

The GitHub source checkout also contains higher-level agent-cycle examples:

- `core-sdlc/`: legacy core-SDLC agent loop example, not an install preset.
- `speckit/`: Spec Kit agent loop example.

These directories are source-only examples and are not shipped in the npm
package. They are not required for the CLI, SDK, MCP server, GitHub Action, or
installed preset path.
