# Contributing to ztrack

Thanks for your interest. ztrack is Apache-2.0.

## Ground rules
- **Issues first.** For anything non-trivial, open an issue to discuss before a PR.
- **Determinism.** ztrack's `check` is a typechecker: rules must be zero-false-positive
  facts (a SHA that's in git, a file that resolves). Fuzzy heuristics belong in `lint`,
  not `check`.
- **No telemetry, ever.** ztrack never phones home.

## Dev setup
```bash
git clone https://github.com/volter-ai/ztrack
cd ztrack
bun install --frozen-lockfile
bun run typecheck
bun test
bun run src/cli.ts --help   # run the CLI from source (no build needed)
```

Build artifacts (`dist/`, `visualizer/core.js`) are **not committed** — they're
produced by `npm run build` and, for npm publish, by the `prepack` script. Run the
CLI from source with `bun run src/cli.ts …`; build only when you need the bundled
`dist/cli.js` (e.g. to test the packaged artifact).

## PRs
- Keep them focused and small.
- Add/adjust tests; `check` regressions are caught in CI (including the test that
  proves a fabricated commit SHA fails).
