---
name: ztrack
description: Work with a ztrack tracker — make `ztrack check`/`loop` green HONESTLY, author issues into stored or document sources, and operate under an armed ztrack-plugin Stop hook. Use when a Stop-hook gate holds your turn, when `ztrack check` is red, when marking an acceptance criterion done, when a repo has `.volter/tracker-config.json`, or when asked to file/groom/burn down a backlog.
---

# ztrack: making the gate green honestly

ztrack is a typechecker for your issue tracker: a **checked acceptance criterion (AC) must cite proof that actually exists.** `ztrack check` is the gate; in a `ztrack loop` the Stop hook holds your turn until it passes. Your job is to make it green by doing the work and citing real evidence — **never by fabricating evidence.**

Fresh repo? Route by situation: issues already on GitHub → `ztrack init --sync github --repo o/n` (they pull in; GitHub stays the truth). A pile of tasks, no tracker → `ztrack init`, then `ztrack import <tasks.md> --register` materializes the list into issues. Driving ONE issue → `ztrack loop start <id> --until done`. Burning a WHOLE backlog → dispatch one loop-armed subagent per `ztrack issue list --actionable` row, wave by wave, re-querying after each merge (GUIDE § Orchestrating a whole backlog).

## The loop
1. Run the gate: `ztrack check` (or `ztrack check <issue-id>` / `ztrack check --auto-scope`, which is what the Stop hook runs).
2. **Read each finding — it tells you the fix.** Every finding ends with a `↳ Fix:` line naming the exact command. Run it (filling real values).
3. Re-run the gate. Repeat until green.

```
APP-1  x error  passed_ac_missing_evidence
       └─ AC dev/01 is passed but has no image evidence.
       ↳ Fix: ztrack ac patch APP-1 dev/01 --json '{"evidence":[{"id":"ev1","image":"<path>","commit":"<sha>","acVersion":1}]}'  (`ztrack ac --help` / `ztrack issue view APP-1` for the AC schema)
```

## Operating under an armed gate (the ztrack plugin)

If your turn is being held with "ztrack loop (<issue>): not done yet", a loop is armed on that issue. What to know:

- **Bare `loop start <id>`** holds until the issue's CURRENT status passes check. **`--until <stage>`** (e.g. `ready`, `done`) holds until the status genuinely reaches that stage AND passes there. **Do not flip the status early to end the turn** — the stage's own lifecycle gates still fire for real (`--state done` with unpassed ACs just trades one red finding for another). Reach the stage by doing the work.
- The findings printed at each held turn ARE your next-step list. Work them top-down.
- The cap: each actor gets a bounded number of held turns (default 8); past it the loop stops and surfaces what's left rather than grinding forever.
- **Honest escapes, graded** (never fake "done" instead): leave the AC pending and report the blocker; amend an over-specified AC through the sanctioned edit path (a recorded scope decision — evidence against the old wording auto-stales); `ztrack waiver sign <issue> --code <finding-code> --reason "…"` for a finding an authority knowingly accepts (last resort); or, when genuinely stuck past the half-way point, the held message names a per-actor exempt file you can create to end YOUR turn only (the loop stays armed). `ztrack loop stop` disarms entirely.

## The resolution verbs
Two source models — know which one you're in before you edit anything:
- **Issue-per-file store (most repos, the default):** you never hand-edit issue markdown — the preset owns the grammar. Mutate only through the verbs below.
- **Document source** (a hand-authored plan/backlog file holds many issues — tell by a finding citing a path like `PLAN.md:42`, or `format:"document"` in the config): `ac patch` and title/body edits still splice into the file at the issue's recorded span (leaf items only — an item with id-bearing child sections fails closed). State, assignee, label, parent/children, comments, writes to the umbrella issue, and delete all **fail closed** (the error names the file). For those, edit the document directly at the cited line, then re-run check — that's the sanctioned path, not a workaround.

Verbs:
- **`ztrack ac patch <issue> <acId> --json '{…}'`** — overlay AC fields (mark checked/passed, attach evidence, add proof). The JSON is the preset's AC schema shape; run `ztrack issue view <issue>` to see the exact shape for your preset (default: `{checked, status, evidence:[{id,image,commit,acVersion}], proof:{explanation,evidenceRefs}}`).
- **`ztrack issue patch <issue> --json '{…}'`** — overlay issue-level fields.
- **`ztrack issue edit <issue> --assignee … --state …`** — set issue columns (assignee, state).
- **`ztrack waiver sign <issue> --code <finding-code> [--ac <acId>] [--ref <subject>] --reason "…"`** — only when you *knowingly accept* a finding you cannot satisfy; prefer fixing. `sign` pins the waiver to the single offending occurrence (a `ref:` field, auto-captured; it refuses an ambiguous sign — pass `--ref` to pick one). An unpinned row that could pin warns `waiver_overbroad`; `ztrack waiver migrate` converts legacy broad rows.

The cited commit must EXIST in git (`ztrack check` enforces this by default) — so implement and commit the real work first, then cite that SHA. If a needed commit, PR, screenshot, or evidence source does not exist, **leave the AC unchecked and report the blocker** — do not invent it.

## Authoring into a document source

When hand-writing new issues into a `format:"document"` file (a plan/backlog markdown):

- Match the file's existing section shape exactly — an id-bearing heading (`## APP-12 — Title`), then the header lines (`Status:`, `Assignee:`, priority/labels as the file already does them), then the body, then an `### Acceptance Criteria` list in the preset's AC grammar. Copy a sibling issue as the template; `ztrack fmt --input <file> --check` tells you if your section is canonical.
- **Pick the next free id in the file's numbering scheme** — grep the tracker first (`ztrack issue list --state all`); a duplicate id fails check loud.
- **Bare headings**: on a freeform file (no ids anywhere yet), `import` materializes every heading — a top-level `#` becomes the umbrella issue. Once a file has id-bearing issues, a bare heading *above* them is kept as document structure (reported in the plan, never minted); a bare *leaf* heading still becomes a new issue. Put an id token in a heading yourself if it should BE an issue.
- Line endings don't matter — LF and CRLF (Windows/autocrlf) files both work; ztrack splices in LF space and writes back the file's own EOL.
- Verify before you finish: `ztrack import <file> --dry-run` shows exactly what would materialize; `ztrack check --source <file>` validates just that source.

## Targets
`check` and `loop` take one target: nothing (whole tracker), `<issue-id>`, `<file.md>`, or — inside a worktree named for an issue — that issue automatically. `ztrack loop start <issue>` arms a Stop-hook gate that holds your turn until that issue is green. With 2+ declared sources, `issue list --source <name>` / `check --source <name>` scope to one or more sources (repeatable, comma-separated, union — refused on the `--actionable/--blocked` frontier and on source-less check paths — see docs/SOURCES.md).

## Adopting ztrack into a repo (one-time)
`ztrack init` (add `--sync github --repo o/n` for linked mode; `--preset` per docs/PRESETS.md, `simple-sdlc` is the baseline). Then **prove the gate**: mark one AC passed citing a fake commit SHA → `ztrack check` must fail `evidence_commit_not_found` → replace with a real SHA → green. That red→green is the point. `npm i -D ztrack` is required (a one-off `npx` is not enough — the preset imports `ztrack/preset-kit` from the project's node_modules). Full recipe: docs/AGENT-PLAYBOOK.md.

## Sync (linked repos)
If the project was `init --sync github`, the tracker IS the GitHub issues. `ztrack sync github` reconciles both ways; a same-field conflict surfaces as a `sync_conflict` finding that gates `check` until you resolve it — edit and re-sync, or pick a policy (`--policy merge|hub-wins|twin-wins`, default `merge`).

## The rule that matters
Honest done only. The gate raises the cost of faking completion — don't try to beat it; satisfy it. A green gate must mean the work is real.
