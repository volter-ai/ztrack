# Tracker Preset Guide — build & review

How to add or extend a preset in ztrack on the core contract, and how to adversarially review it. **An agent working on a preset should read this doc first.** Reference implementations (the bar): `src/presets/default.ts`, `src/presets/speckitCore.ts`. Core engine: `src/core/engine.ts`.

Contents: [1. Contract](#1-architecture-contract--non-negotiable) · [2. Core model](#2-core-model-enginets) · [3. Source the SDLC](#3-source-the-sdlc-faithfully) · [4. Build order](#4-build-order) · [5. Never](#5-never-anti-patterns) · [6. Review](#6-review)

---

## 1. Architecture contract — NON-NEGOTIABLE
1. **ONE strict Zod master schema.** Core fields + preset-specific fields, every object `.strict()`. NEVER `.passthrough()`, `z.any()`, `z.unknown()` (except an intentionally-opaque external payload inside `Context`), a raw `body` field, or a `sections: Record<>` map.
2. **mdast parse straight into the schema.** Document STRUCTURE (headings scope sections; list items / table rows / paragraphs are records; GFM checkboxes) comes from the AST. Regex ONLY to read field content from within a node's text. NEVER line-scan the raw doc/section to discover records or structure. A leading `---` YAML frontmatter block is allowed (metadata not in the body).
3. **The parse target IS the schema.** `parse(string) -> candidate object`; `check()` runs `schema.safeParse`. No projection / `toIssues` / second model.
4. **Pure rules.** `Rule.run = (root, ctx) => Finding[]`. No I/O, no filesystem/network, no global mutable state, no `Date.now()`/randomness, no mutation of `root`, no `throw`. Deterministic.
5. **One impure edge: the loader.** Real data (git, twin world, issue files) enters only through a loader that reads the backend + builds `{markdown/bundle, Context}` — mirror `core/gitWorld.ts`. Parse and rules stay pure.
6. **Preset shape:** `{ name, schema, parse, rules, primitives }`, registered in `core/registry.ts`.

## 2. Core model (engine.ts)
- `CoreRoot { issues: CoreIssue[] }` — the root is ALWAYS multi-issue (the "snapshot"). Cross-issue rules range over `root.issues`.
- `CoreIssue { id, title, summary, status, acceptanceCriteria, +opt primitives }`, `CoreAC { id, status, evidence, +category?, proof? }`, `CoreEvidence { id }`.
- `Context`: injected local facts — `git` (commits, PR heads, branches) and `world` (twin events + annotations). A rule reading `ctx.*` MUST early-return when it is absent.
- Primitives (`labels, relations, linkedIssues, children, sources, category, proof`) are opt-in; declare which the SDLC uses in `primitives`. `audit` is core/always-on (do not declare).

## 3. Source the SDLC faithfully
> This is where presets go wrong. Derive from the REAL, authoritative source — never a dormant predecessor or memory. Capture as much of the real process as the artifacts formally encode. Verify, don't invent.

- **Premade system (speckit / openspec / …):** `WebFetch` the upstream templates + skill/command definitions; install/inspect the real tool's output. Map its real artifacts to the schema. Do NOT inherit invented fields from an in-repo predecessor — confirm every field against the upstream template.
- **Bespoke pre-existing process:** the team's written standards/process docs are authoritative; read them ALL first. Use any legacy implementation only to enumerate completeness (rule codes); the standards win on semantics. Separate in-scope (single-issue/markdown) from a different provider layer (world/snapshot).
- **Brand-new (fresh repo):** elicit the process from the user and WRITE IT DOWN before coding — the ordered states, the AC type(s), what evidence each completion needs, the per-state entry gates, the roles/concurrency. Confirm before building.

## 4. Build order
1. **Map the process:** states (ordered) · AC type(s) · evidence/proof shape · per-state entry gates · roles · what's out of scope (a different provider).
2. **Design the strict schema:** narrow `status`/enums; model each AC type; evidence/proof as a typed pool or nested; the primitives the SDLC uses. `.strict()` everywhere.
3. **Write the mdast parser → schema** (structure from AST; field content via regex within node text; frontmatter for metadata; a `===MARKER===` split for multi-file/multi-issue bundles).
4. **Write rules**, grouped: structural existence (required sections/fields) · checkbox⇄status consistency · per-state gates · evidence requirements + freshness/anchoring (read `ctx.git`) · ref-integrity · completeness/cross-issue (over `root.issues`, read `ctx.world`). Each emits a stable `code`.
5. **Multi-input** if needed: frontmatter metadata, `Context.world` for twin/world grounding, a bundle marker for multiple issues/files.
6. **Loader** (impure): read real data → `Context` + bundle; the only place with fs/world/git. Map files↔issues by parsed id (NOT ordinal — parse may drop invalid segments).
7. **Register** in `core/registry.ts`.
8. **Tests:** clean fixtures that produce ZERO findings (incl. warnings) at each lifecycle stage, plus a perturbation that fires each rule; a strict-schema rejection test; round-trip if there's a serializer.
9. **Review** (section 6): run the three adversarial passes; reproduce every finding before fixing.
10. **Prove on real data** via the loader; if porting, cross-check findings against the legacy/world validator (they should agree where scope overlaps).

## 5. Never (anti-patterns that caused real bugs)
- A two-layer snapshot/projection model — the multi-issue root IS the snapshot.
- `.passthrough()` / `any` / raw-body / metadata mined from body prose when frontmatter or structured fields exist.
- Line-scanning a section to find records (use mdast node boundaries).
- Parser-side semantic INFERENCE (keyword heuristics that invent a fact the artifact never states). If the standard requires the fact, require it explicitly.
- Per-file checking that leaves `root.issues` size 1 — it silently defeats every cross-issue rule.
- Hard-error completeness over fuzzy matching or a partial corpus — make it advisory (warning) unless the corpus is known-complete and matching is exact.
- Silently defaulting a required field (e.g. an explicit `status:`) — record that it was absent and flag it.
- Leaving any emitted `code` unclassified if the repo has a code-classification gate.

---

## 6. Review
Run after building or changing a preset. **Launch the three adversarial passes below IN PARALLEL** (each as a `general-purpose` sub-agent, or run them yourself in sequence — resetting framing between each — if you can't spawn). Prepend the target file paths (the preset + its loader) to each prompt. Then **reproduce the load-bearing findings yourself** (`bun -e` against the real module — never trust a review blind) and synthesize one report. Bar: `default.ts`, `speckitCore.ts`.

### Lens A — Purity / architecture (dispatch this)
> Adversarial. Assume NON-conformant; prove deviations; cite file:line; read-only.
> **A. SCHEMA:** every object `.strict()`? no `.passthrough()`/`any`/`unknown` smuggling content (opaque payload only inside `Context`)? no raw `body`/`sections: Record<>`? structural-metadata fields justified as typed projections, not leaks? root multi-issue + strict?
> **B. PARSER:** ALL document structure from mdast (headings/list-items/table-rows/checkboxes)? regex ONLY for field content within a node's text, NEVER to discover records by line-scanning? frontmatter only the leading `---`, no nested-key corruption, consistent precedence vs body fallback? bundle split collision-safe? parse target IS the schema (no projection/toIssues)? NO parser-side semantic inference?
> **C. RULES:** each pure — reads only root+ctx, no I/O, no Date.now/random, no root mutation, no throw, deterministic? throw-safe on schema-valid edge input? (only the parser may shape its candidate before validation.)
> **D. LOADER:** the only impure edge (mirrors gitWorld.ts)? pure transform correct? files↔issues mapped by parsed id NOT ordinal index? no silent catch / unsafe assertion?
> Output: PASS/PARTIAL/FAIL per criterion with exact file:line, then a prioritized must-fix list. Don't soften.

### Lens B — Edge cases / completeness (dispatch this)
> Adversarial. Find behaviors WRONG or fragile on real input; for EACH give a concrete failing input and reproduce it with `bun -e`; mark DEFINITE vs THEORETICAL; cite file:line; read-only. Compare to the standards/upstream + legacy impl for semantic drift.
> Probe: (1) **matching** — false matches from short/common substrings (is there a specificity floor?), missed matches, URL/key normalization, can non-actionable items satisfy a gate; (2) **completeness/gates** — right vs standards? over-fires on a partial corpus or under fuzzy matching (→ should be warning, not error)? any rule that can't fire or fires on valid input? did legacy gate on a field the new schema dropped? (3) **hashing/version staleness** stability; (4) **frontmatter** edge cases (quotes, lists, CRLF, nested, block scalars, spaces, a `---` in the body); (5) **multi-issue bundle** (dup ids, empty segments, ordering, per-segment structural facts); (6) **state/evidence gates** vs `*-STANDARDS.md`; (7) **loader edges + scale** (empty dir, no world, missing files, O(n·m)/memory on multi-MB logs).
> Output: prioritized must-fix / should-fix / low with file:line + failing input; what the tests do NOT cover; minimal fix direction per must-fix (recommend, don't implement).

### Lens C — Realistic-run simulation (dispatch this)
> Dynamic. Role-play the SDLC's actors and drive MANY realistic end-to-end runs by hand; read-only. Per run: author a realistic artifact for a lifecycle point, run check/loader, record EXPECTED vs ACTUAL findings, advance state as the next actor would, re-check. Cover: happy path start→done; each state-gate violated; evidence going stale (sha/version drift); a multi-issue snapshot with cross-issue relations + partial corpus; world/sources grounding (a true reflection passes, a short-quote/unrelated one does NOT, an unreflected source surfaces at the right severity); malformed/adversarial input (missing/duplicate/reordered/no-id) — never crash, never silent-clean on a bad artifact. Drive it as the PM/manager loop: does derived state advance correctly, or get STUCK / LOOP / FALSELY ADVANCE?
> Output: a numbered run log (scenario · authored/changed · expected · actual · verdict); ranked DIVERGENCES with **false-pass before false-fail** + triggering input + suspected file:line; one-line "would this survive a real autonomous run end-to-end?" with the reason.

### Synthesize + "ready"
1. Collect the three reports; **reproduce every must-fix yourself** (false-pass divergences first — the dangerous ones).
2. One ranked list: **must-fix** (breaks contract or correctness on real data) / **should-fix** / **low**, each with file:line + reproduced failing input.
3. Re-verify until clean: preset tests green (clean fixtures = 0 findings; a perturbation per rule), `tsc` clean, and — if porting — world/legacy-validator fidelity on real data where scope overlaps.

**Ready = contract held + behavior correct on real data, not just fixtures green.**
