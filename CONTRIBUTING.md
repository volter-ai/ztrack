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
```

## PRs
- Keep them focused and small.
- Add/adjust tests; `check` regressions are caught in CI (including the test that
  proves a fabricated commit SHA fails).
