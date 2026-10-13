# ztrack visualizer

A small, preset-agnostic web UI for the ztrack core export. It runs every
`tracker/*.md` (or, under the `speckit` preset, every `specs/<slug>/` feature
dir) through its preset, validates it, and renders the issues, acceptance
criteria, findings, and audit-derived timestamps in a browser.

It is a standalone [Bun](https://bun.sh) app — it imports the ztrack core
directly (from `src/` in a repo checkout, or `dist/src/` in an installed
package) and reads your tracker on each request. It is **not** part of the
`tsc` build and ships no compiled artifacts of its own.

## Run it

From the repo root, the easiest path is the CLI:

```bash
ztrack visualizer                # the active preset, port 3300
ztrack visualizer --preset speckit --port 4000
ztrack viz --project /path/to/repo   # viz is the short alias
```

Or run the server directly:

```bash
bun install                      # once, inside this directory (pulls react)
PRESET=simple-sdlc PROJECT_DIR=/path/to/repo bun run visualizer/server.ts
```

## Configuration

All inputs are environment variables (the `ztrack visualizer` command sets them
for you from its flags):

| Var           | Default        | Meaning                                  |
| ------------- | -------------- | ---------------------------------------- |
| `PORT`        | `3300`         | HTTP port                                |
| `PRESET`      | `simple-sdlc`  | which preset to resolve docs/context for (`default` is an alias for it, kept for backward compatibility) |
| `PROJECT_DIR` | `process.cwd()`| repo whose `tracker/` (or `specs/`) to read |

See [docs/VISUALIZER.md](../docs/VISUALIZER.md) for theming the board, teaching it new vocabulary, and adding custom panels.

## Endpoints

- `GET /` — the app shell
- `GET /api/board` — the validated core export (issues, findings, audit, timestamps)
- `GET /assets/app.js`, `GET /assets/styles.css` — client bundle + styles
- `GET /project/<path>` — sandboxed static files from the project dir. Canonical
  `<stateDir>/evidence/**` and `docs/sources/**` URLs may carry `sha256:<hex>` and an optional
  40-character `commit`; ztrack verifies the exact response bytes and can recover a cited
  historical blob from git after the working-tree copy changes or disappears. Byte ranges and
  `HEAD` are supported for video and other large evidence.
- `GET /assets/source-previews/<source-sha256>/page-<n>.png` — a confined raster preview keyed to
  the immutable source digest under `<stateDir>/tracker/visualizer/source-previews/`.
