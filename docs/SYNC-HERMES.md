# A Hermes kanban as one markdown file

`ztrack sync hermes` keeps one markdown file two-way in step with a
[Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban) kanban. An agent
reads and writes the board as a file; the board stays the board, so Hermes's dispatcher (or any
other one), `hermes kanban` and anyone else on it keep working as before. Their changes reach the
file on the next sync, and the file's edits reach the board.

The file is a [document source](SOURCES.md#the-document-format) in the `kanban` preset's grammar.
The preset has no acceptance criteria, no evidence and no comment thread. A card is its lane, its
dependencies, a few lines of prose, and its **tasks**: one line each, with ids, ticked when done,
optionally blocked by other tasks or cards. The file holds the open cards only. Done and archived
cards stay on the board.

## Set up

```bash
npm install -D @volter/ztrack
npx ztrack init --preset kanban --sync hermes --hermes-home ~/.hermes   # writes arcs.md from the board
```

`init` writes this config and runs the first sync:

```json
{
  "validation": { "entrypoint": ".volter/tracker/validation/preset.mts", "installedFrom": "kanban" },
  "sync": { "provider": "hermes", "file": "arcs.md", "home": "~/.hermes" },
  "sources": [{ "path": "arcs.md", "format": "document", "name": "board" }]
}
```

| `sync` key | Meaning |
|---|---|
| `file` | The board file, relative to the project root (`init --file`, default `arcs.md`). |
| `home` | `HERMES_HOME` of the board's profile (`init --hermes-home`). Absent: the environment's. |
| `board` | A named Hermes board (`hermes kanban --board <slug>`, `init --board`). Absent: the home's default board. |
| `bin` | The `hermes` executable. Default `hermes` on `PATH`. |
| `policy` | Same-field collisions: `merge` (default), `board-wins` or `file-wins`. |

The board is read and written only through `hermes kanban` (its `list`, `show`, `create`,
`comment`, `assign`, `link`/`unlink` and lane verbs), never through its database file. Hermes's
events, notifications and dispatcher see a sync's writes the same way they see a person's.

## The grammar

```markdown
Any prose before the first card is kept as it is.

## t-65a8d101 — ztrack-board: the manager's arcs live in one ztrack md

status: running
assignee: default

Blocked by: t-954aa1da
Workspace: dir:/Users/me/volter/ztrack
Run: 78 running since 2026-09-28 21:26:06Z, sc:yuerans-macbook-pro:claude-code:b2b278cf-…
Machine: yuerans-macbook-pro
Session: sc:yuerans-macbook-pro:claude-code:b2b278cf-…

Done when: the manager's arcs live in arcs.md backed by its Hermes kanban; released.

### Tasks

- [x] c1 kanban preset and sync hermes on main
- [ ] c2 the manager's repo runs from arcs.md
  - blocked-by: c1, t-954aa1da:c3
```

- **A card** is a level-2 heading `## <id> — <title>`. The id of a card on the board is its
  Hermes id with `-` for `_` (`t_65a8d101` is `t-65a8d101`). The title is the card's whole title:
  the outcome.
- **Its header block** follows the heading after one blank line: `status: <lane>` and, when the card
  has one, `assignee: <profile>`, one per line, ending at a blank line. The lanes are Hermes's:
  `triage`, `todo`, `ready`, `running`, `review`, `blocked`, `scheduled`, `done`, `archived`.
  A new card written with no `status:` line is `todo`.
- **Its metadata block** is the first paragraph after the header, and only when every line of it
  is one of these keys. Each key is optional:
  - `Blocked by:` lists the cards that must finish first (Hermes parent links), comma-separated.
  - `Workspace:` is `scratch` (the default, never written), `worktree`, `worktree:<path>` or
    `dir:<path>`.
  - `Branch:` is the worktree branch.
  - `Priority:` is an integer. The default 0 is never written.
  - `Run:` is the card's open run on the board: the run id, its status, when it started and the
    session it names. A dispatcher writes it when it claims the card, so this line is read-only. A
    sync writes the board's value and ignores an edit to it. The session is the run metadata's
    `address` (else `session_id`), top-level or one level down (supercode's dispatcher records
    `metadata.supercode.address`).
  - `Machine:` and `Session:` are free text: the machine the arc runs on and its session's address.
- **The prose** is everything after that, up to `### Tasks`: a few lines, such as `Done when:`.
  A line of it that starts with `#` is written `\#`. A first line that starts like a metadata key
  is written `\Key:`. Either way, it can't read as a heading or as metadata.
- **`### Tasks`** holds the card's tasks, one per line: `- [ ] <id> <text>` open, `- [x] <id> <text>`
  done. The id is `c<N>`. A task written without one gets the card's next free `c<N>` on the next
  sync. An indented `- blocked-by: <refs>` line under a task names what it waits on: `c1` (a task
  of this card), `t-…:c2` (a task of another card), or `t-…` (a whole card).
- **No other heading** may appear anywhere in the file, the prose before the first card included.
  The sync renders the file whole, and it refuses a file with any other heading rather than drop
  or move it. The refusal names the line.

`ztrack check` validates the file with the kanban preset. It reports a schema error for an unknown
lane or a malformed field, and it reports these rules:

| Code | Severity | Fires when |
|---|---|---|
| `card_blocker_missing` | error | `Blocked by:` names a card that isn't in the file |
| `task_blocker_missing` | error | a task's `blocked-by` names a task or card that isn't in the file, or itself |
| `card_block_cycle` | error | cards or tasks block each other in a loop |
| `duplicate_issue_id` | error | two sections carry the same id |
| `duplicate_task_id` | error | a card has two tasks with one id |
| `done_before_blocker` | warning | a ticked task (or a done card) waits on something that isn't done |
| `kanban_line_unparsed` | error | a line under Tasks is neither a task nor its `blocked-by` line |
| `sync_conflict` | error | the last sync found a collision, a refused edit, or a section with no card behind it |

## What a sync does

`ztrack sync hermes` reads the board, the file, and the state the two last agreed on (the base,
kept machine-local under the sync state directory). It merges each card field by field. A field
changed on one side only takes that side's value. A field changed on both sides to different
values is a collision (see [Collisions](#collisions)). The sync applies the file's side to the
board, reads the board again, and writes the file whole from it.

| In the file | On the board |
|---|---|
| a section whose id isn't a board id (`## new-1 — …`) | `create`, with the prose as its body. The section's id becomes the new card's. `Blocked by:` may name another new section. |
| `status:` changed | `complete`, `block`, `schedule`, `request-review`, `unblock`, `promote` or `reopen-review`, whichever makes that move |
| `assignee:` changed or removed | `assign` |
| `Blocked by:` changed | `link` / `unlink` |
| the prose, `Machine:`, `Session:` or a task changed | one comment authored `arcs` carrying the card's new state (below) |
| a section deleted | `archive` |
| the title, `Workspace:`, `Branch:` or `Priority:` changed, or a done card moved to another lane | the card is **re-created** (below) |

**A card's state.** Hermes can't edit any of a created card's text. So the part of a card that
changes every tick (its prose, `Machine:`, `Session:` and tasks) is carried in Hermes's one writable
channel. Each change posts one comment authored `arcs`, whose text is that part of the section in
this grammar. The latest `arcs` comment is the card's state. Until a card has one, its prose is its
Hermes body. The board keeps every state as history, while the file shows only the current one.
Tasks are not Hermes cards for two reasons: a card linked as the arc's parent would hold the arc out
of `ready`, and a ready task card would be dispatched as a session of its own.

**Re-creating.** Hermes has no door to edit a created card's title, workspace, branch or priority,
and none to reopen a done card. So the sync re-creates the card, the way a board operator does by
hand. It creates a new card with the edited fields, the same parents and the same state. It relinks
the old card's children to the new card, comments `replaces t_…` on the new card and
`replaced by t_…` on the old one, archives the old card, and renames the section to the new id. A
running card is never re-created: the edit is recorded as a conflict instead.

Board to file: every change another actor makes shows in the file after the next sync. That covers
a new card, a state comment, an assignment and a link. When a dispatcher claims a card, the card
moves to `running`, gets the dispatcher's `assignee:`, and gets a `Run:` line naming the session it
started or adopted. When the run ends, the `Run:` line goes away. A card that goes done or archived
on the board leaves the file. So does a `Blocked by:` naming it, since it no longer gates anything.

`ztrack check` (the whole tracker, not `ztrack check <file>.md`) and `ztrack loop start` run the
sync first on a Hermes-linked project, like they do for a GitHub-linked one. A sync that can't run prints `! sync hermes skipped: <why>`, and the check
then reads the file as it is. `--dry-run` prints the board writes a sync would make and changes
nothing.

## Collisions

By default a collision is not applied either way. The file keeps its value, the board keeps its
own, and `ztrack check` reports a `sync_conflict` naming both until the two agree. Edit the file to
match, or re-sync with `--policy file-wins` (the file's value goes to the board) or
`--policy board-wins` (the board's value comes to the file).

These are also recorded as conflicts, with the file keeping its value:

- an edit Hermes refuses: a lane move with no Hermes verb (into `running` or `triage`), or a write
  the CLI rejects, with Hermes's own message;
- a section whose card is gone from the board, done or archived there while the section was edited,
  or a board id the board never had (delete the section to resolve it);
- a new section whose card couldn't be created.

A refused write never leaves a sync half-done. The sync carries on and writes the file from the
board as it now stands.

## Limits

- One writer at a time. If the file changes while a sync runs, the sync applies what it read, leaves
  the file alone, and says to run it again.
- Every sync checks that the file it rendered reads back as the board it rendered it from, before
  it replaces the file. If it doesn't, the file is left as it was and the sync names the card and
  field.
- A sync reads every open card with one `hermes kanban show` each, eight at a time. A board of about
  25 open cards takes several seconds.
