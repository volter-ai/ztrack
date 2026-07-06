# Dialects — design & build plan

*Status: SHIPPED in 1.2.0 (WP1–WP7; user docs live in
[SOURCES.md → Dialect lenses](SOURCES.md#dialect-lenses-read-a-repos-own-idiom)). This file
remains the design record. The stance this implements is the "Dialects" section of
[ROADMAP.md](../ROADMAP.md): ztrack is to task lists what a gradual typechecker is to untyped
code — read first, rewrite never (by default), inference over annotation, the ids belong to
the repo, dialects are data, and a conformance corpus is the definition of done.*

## The acceptance demo (what "instantly useful" means, operationally)

The reference case is a real repo that has never heard of ztrack (the shapes below are
distilled from an actual game-design repo). It keeps kill-questions in an emoji register
(`### KQ3 — …` + `**Status**: 🟢/🟡/🔴` bullets), build state in a checkbox roster
(`- [x] **WS-A: server core** — …`), and an append-only decision-log table (`| #17 | … |`)
that must NOT be treated as issues. The bar:

```
$ npx ztrack init --team AS
$ npx ztrack check
note: PREPRODUCTION.md parses under the 'emoji-register' dialect: 5 issues (KQ1 … KQ5).
      To track it as-is (read-only, file untouched):
        ztrack import PREPRODUCTION.md --register --dialect emoji-register
note: S1_BUILD.md parses under the 'checkbox-roster' dialect: 4 issues (WS-A … WS-D). …
$ npx ztrack import PREPRODUCTION.md --register --dialect emoji-register
$ npx ztrack import S1_BUILD.md --register --dialect checkbox-roster
$ npx ztrack issue list        # KQ3 done · KQ2 ready · WS-A done · … — true statuses
$ npx ztrack check             # structural truth, exit 0
$ git status                   # ONLY .volter/tracker-config.json changed. No file rewritten.
```

Two commands from first contact to a working tracker view, zero mutations to the repo's own
files. That demo ships as an e2e test over distilled fixtures.

## Vocabulary (three nouns, one invariant)

- **Dialect** — a declarative description (pure data) of how one file surface encodes
  issues: boundary, id, title, status vocabulary, hierarchy. Built-ins are named
  (`emoji-register`, `checkbox-roster`); a custom one is the same object written inline in
  the source entry. A dialect can never contain code.
- **Engine** — the ONE interpreter in core that applies a dialect to a file and emits
  ordinary `IssueRecord`s. Zero per-dialect branches, ever: adding a dialect adds data and
  fixtures, not an `if`.
- **Fixtures** — per dialect, an input file + the exact expected records JSON (plus
  *negative* fixtures: shapes that must NOT detect). The conformance suite is both the spec
  and the contribution interface.

The invariant that keeps the two-parser architecture clean: **dialects may only produce what
a backend could have produced; only presets decide what it means.** Dialects live entirely in
parser 1 (file → record). Parser 2 (the preset's body grammar — ACs, evidence, PR metadata)
never learns dialects exist.

## Why this is cheaper than it looks (verified leverage, all in the code today)

- `markdownDocument.ts#parseMarkdownDocument` already yields sections with level, parent,
  body, raw, line spans, AND parsed `checkboxItems` — the engine's structural substrate
  exists; extractors are a thin layer over it.
- **`GrammarPack` is the precedent** (`markdownDocument.ts`): a named registry of
  vocabulary-as-data (`markdown-ac`, `github-flavored`), config-extensible
  (`organization.grammar.extends` + `slotAliases`), unknown names ERROR. Dialects are the
  same pattern one level up — GrammarPack maps section headings→slots inside an issue;
  a dialect maps file surface→records. (Later, AC desugar reuses GrammarPack directly:
  `github-flavored` already maps "Tasks" → the acceptanceCriteria slot.)
- `readonly` already exists on the source config schema and is enforced by
  `DocumentSource` — the lens tier's write-refusal is plumbed.
- **The waiver post-filter is the leniency mechanism's precedent**: core already downgrades
  preset findings after rules run (error → acknowledged). Lens leniency is the same shape.
- `SAFE_ID` (`markdownBackend.ts`) accepts hyphenless ids — `KQ3`/`WS1` are valid record
  ids as-is. Only the *native document heading grammar* requires a hyphen, and lens sources
  don't use it. Native ids survive untouched until materialization.
- The config schema is strict Zod (`configSchema.ts`) — `dialect` lands in exactly one
  place, fail-closed on typos.
- `MarkdownBackend` already dispatches source format → class (`DocumentSource` vs
  `MarkdownSource`); a `DialectSource` is one more arm keyed on the source entry.
- Detection surfaces already exist: the file-target document-grammar note, the
  dark-sibling sweep, and `import --dry-run` (all shipped in 1.1.0).

## Work packages, in order

**WP1 — config + types.** `dialect?: string | InlineDialect` on the source entry
(configSchema, strict; `resolveSources` passes it through). Legal only with
`format: "document"`; v1 *implies* `readonly` (declaring `dialect` on a writable source is
a config error — one honest failure, no half-writable lens).

**WP2 — the engine + two dialects + the conformance corpus.** `src/dialects.ts`: the
extractor set (issue boundary: `heading@depth` | `checkbox-list-item`; id: pattern at
`heading-start` | `bold-lead`; title separator; status: `field-bullet` label + vocabulary |
`checkbox` | `header-block`; hierarchy: `heading-nesting` | `flat`; body verbatim), the
built-in registry (`emoji-register`, `checkbox-roster`), records stamped
`provenance: { status: 'inferred', dialect }`, diagnostics in the existing finding shapes
(`status_unrecognized`, duplicate id, id-less sections counted-and-skipped). Fixture pairs
including negatives (decision-log table, prose README, the `## Follow-up items` trap). A
registry-driven test asserts the engine has no dialect-specific branches.

**WP3 — `DialectSource`.** Same interface as `DocumentSource`, constructed by the backend
dispatch when the entry carries `dialect`; forced read-only (mutations answer: *"<file> is a
read-only dialect lens — edit the file directly, or materialize it with `ztrack import
<file>` to manage it through ztrack"*). `issue list` / `check` / `--source` work unchanged.

**WP4 — lens leniency as a core post-filter.** After preset rules run, `error` findings on
issues from a lens source downgrade to `warning` (annotated, waiver-style). Zero preset
changes — every existing user's forked preset gets correct lens behavior for free, and
loop/gate safety is automatic (warnings never fail the gate). This is deliberately chosen
over a provenance `if` inside preset templates: templates are copied into user repos, so a
preset-side fix would strand every existing copy.

**WP5 — detection + the offer.** Where the native-grammar note fires today (file-target
check, `import --dry-run`; full-check sweep only where document sources already exist —
same gating as the sibling sweep), also try each built-in dialect speculatively. Match
floor: ≥2 items that yield BOTH an id and a status; ties or below-floor → silence (guessing
wrong is worse than quiet). The offer is `ztrack import <file> --register --dialect <name>`
— a register-only mode that writes the config entry and NEVER touches the file (pinned by
the same config-untouched/file-untouched test pattern as the 1.1.0 registration offer).

**WP6 — materialize (the opt-in climb).** `ztrack import <lens-file>` (no `--dialect`)
converts to native grammar in place: ids kept verbatim when already grammar-legal (`WS-A`),
normalized when hyphenless (`KQ3` → `KQ-3`) with the alias recorded on the source entry
(`aliases: {"KQ3": "KQ-3"}`) so references resolve; statuses become `status:` lines;
`dialect`/`readonly` drop from the entry. Prose cross-references elsewhere in the repo are
never rewritten.

**WP7 — capstone.** The acceptance-demo e2e over distilled fixtures; docs (SOURCES.md
dialect section, README, the skill's authoring guidance, CHANGELOG); a manual smoke against
the real reference repo.

## Explicitly deferred

- **Relations** (`Blocks:` grammars vary too much) — structural checks only until a real
  corpus justifies a vocabulary.
- **AC desugar** (`**Acceptance:**` prose → AC grammar) — arrives as an explicit `desugar`
  block on a dialect, emitting native AC grammar into the body for parser 2 to judge;
  builds on GrammarPack unification.
- **`workstream-sections`** (the `## 2. WS1 — title` + `Tasks:`/`**Acceptance:**` shape) —
  the third dialect; needs section-number stripping and benefits from desugar. Decide after
  WP2 proves the extractor set.
- ~~**Dialect-aware dark-sibling sweep** — v1 sweep stays native-grammar-only.~~ Un-deferred
  during WP5: the sweep turned out to be one `detectDialect` call on the shared floor
  (`unregistered_dialect_sibling`, documentDiagnostics.ts), cheaper to ship than to fence off.

## Open questions (with recommendations)

- **Status vocabulary targets.** Built-in dialects map to the simple-sdlc state names
  (draft/ready/in-progress/in-review/done). That couples built-in *data* (not the engine) to
  the stock presets — acceptable, documented; a team whose preset renames states uses an
  inline dialect. Revisit only if it bites.
- **Emoji ambiguity** (someone's 🟡 means *blocked*): fixed per named dialect; the inline
  form is the remap. Do not make named dialects configurable per-key — that's an inline
  dialect with extra steps.
- **Provenance field shape** on `IssueRecord`: `provenance?: { status?: 'inferred' |
  'declared'; dialect?: string }` — additive, optional, absent everywhere today's paths run.
