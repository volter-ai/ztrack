---
name: ztrack
description: Work in a ztrack-verified repo — make `ztrack check`/`loop` green HONESTLY, whether issues live one-per-file or inside a hand-authored document source. Use when a Stop-hook gate or `ztrack check` is red, or when marking an acceptance criterion done.
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

## Targets
`check` and `loop` take one target: nothing (whole tracker), `<issue-id>`, `<file.md>`, or — inside a worktree named for an issue — that issue automatically. `ztrack loop start <issue>` arms a Stop-hook gate that holds your turn until that issue is green. With 2+ declared sources, `issue list --source <name>` / `check --source <name>` scope to one or more sources (repeatable, comma-separated, union — refused on the `--actionable/--blocked` frontier and on source-less check paths — see docs/SOURCES.md).

## Sync (linked repos)
If the project was `init --sync github`, the tracker IS the GitHub issues. `ztrack sync github` reconciles both ways; a same-field conflict surfaces as a `sync_conflict` finding that gates `check` until you resolve it — edit and re-sync, or pick a policy (`--policy merge|hub-wins|twin-wins`, default `merge`).

## The rule that matters
Honest done only. The gate raises the cost of faking completion — don't try to beat it; satisfy it. A green gate must mean the work is real.
