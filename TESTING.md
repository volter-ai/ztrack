# Testing

ztrack tests are **E2E-first**. The primary proof is the real, packed-and-installed CLI
exercising real behavior — not the engine called in-process. Unit tests are kept **minimal**:
reserved for surgical regression of complex pure logic that is painful or impossible to pin
through the CLI.

## Real-CLI E2E — the primary gate (deterministic, runs in CI)

Each script `npm pack`s ztrack, installs the tarball into a fresh git repo, and drives the
actual `ztrack` binary. No mocks; the only thing that isn't real is the live agent.

- **`demos/check-e2e.sh`** — the generic preset's `ztrack check` rule behaviors through the
  installed CLI: checkbox/status mismatch, checked-AC commit/evidence gates, unknown
  evidence, blocking (self / missing / cycle), `--verify-commits`, the SDLC gates
  (missing-AC, done-with-unpassed, missing source marker), and canceled-case exemption.
- **`demos/loop-gate-ci.sh`** — the loop Stop hook's full decision table (armed/held/released,
  per-session exemption non-leak, iteration cap), the `ztrack waiver` round-trip, and the
  review-fix regressions (H1 blocker/reason, H2 non-waivable invariants, M3 all-descoped,
  the `.gitignore` migration).
- **`demos/fresh-project-dry-run.sh`** — install into fresh repos; `init → check` across every
  shipped preset; MCP, SDK, and the autonomy profile.
- **`demos/loop-e2e.sh`** — the **live-agent** loop (real headless Claude driving the hook).
  Manual (needs a `claude` login + network + Haiku); not in CI.

## Unit tests — surgical only

Reserved for complex pure logic, and for code the CLI can't reach:

- the block graph (`src/core/blocking.test.ts`), active-issue scope resolution
  (`src/core/scope.test.ts`), the ref grammar (`src/core/ref.test.ts`), AC mutations +
  AC-Version stamping (`src/modelEdit.test.ts`);
- the mdast parser's exact structured output and the waiver freshness-fingerprint / `waivable`
  logic and the parser regression edge cases (`src/markdownDocument.test.ts`) — **not** the
  rule-firing behaviors, which live in `check-e2e.sh`;
- the preset upgrade 3-way-merge that keeps an edited `preset.mts` reconcilable with its source
  (`src/presetUpgrade.test.ts`);
- the standalone `simple-sdlc` / `simple-gh-sdlc` / `spec` / `speckit` presets (`boilerplates/presets/*.test.ts`).
  `ztrack check` always uses the installed standalone `preset.mts`; these are reached in the
  shipped product only through the **visualizer** (`serverCore.ts` resolves them via the
  registry for display), where E2E is impractical — so a unit test is their surgical coverage.
- markdown serialization + parser edges (`src/backends/markdown.test.ts`,
  `src/markdownDocument.test.ts`, `src/graphql.test.ts`): null-vs-empty, comment-block
  round-trips, fenced-code blocks, CRLF, `fmt` fixed-point — exactly the things a CLI E2E
  can't isolate.

## Adding a feature

Prove it **E2E through the real CLI first** (extend `check-e2e.sh` / `loop-gate-ci.sh`). Add a
unit test only when there is a specific, complex edge the E2E can't isolate — and say why.
