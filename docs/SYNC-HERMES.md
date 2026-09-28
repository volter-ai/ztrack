# A Hermes kanban as one markdown file

`ztrack sync hermes` keeps one markdown file two-way in step with a
[Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban) kanban. An agent
reads and writes the board as a file; the board stays the board, so Hermes's dispatcher (or any
other one), `hermes kanban` and anyone else on it keep working as before. Their changes reach the
file on the next sync, and the file's edits reach the board.

The file is a [document source](SOURCES.md#the-document-format) in the `kanban` preset's grammar.
The preset has no acceptance criteria and no evidence. A card is its lane, its dependencies, its
opening post and its comment thread.

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
| `comments` | Newest comments shown per open card. Default 5. A done card shows only the count. |
| `show` | The command printed for a card's full thread. Default `hermes kanban show`. |
| `policy` | Same-field collisions: `merge` (default), `board-wins` or `file-wins`. |

The board is read and written only through `hermes kanban` (its `list`, `show`, `create`,
`comment`, `assign`, `link`/`unlink` and lane verbs), never through its database file. Hermes's
events, notifications and dispatcher see a sync's writes the same way they see a person's.

## The grammar

```markdown
Any prose before the first card is kept as it is.

## t-65a8d101 — ztrack-board: the manager works its arc board as one ztrack md

status: ready
assignee: manager

Blocked by: t-954aa1da
Workspace: dir:/Users/me/volter/ztrack
Branch: wt/board
Priority: 2

Done when: the manager reads and writes one ztrack md that parses into task state.
A line of the opening post that starts with `#` is written \# so it is never a heading.

### Comments

12 earlier comments: hermes kanban show t_65a8d101
- 2026-09-28 20:58:37Z default: a comment already on the board
  a second line of the same comment
- a new comment, not yet posted
```

- **A card** is a level-2 heading `## <id> — <title>`. The id of a card on the board is its
  Hermes id with `-` for `_` (`t_65a8d101` is `t-65a8d101`). The title is the card's whole title.
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
- **The opening post** is everything after that, up to `### Comments`. It is the card's body,
  verbatim.
- **`### Comments`** holds the newest comments, oldest first. A comment on the board is
  `- <YYYY-MM-DD HH:MM:SS>Z <author>: <text>` in UTC, with further lines indented two spaces. A
  `- <text>` line with no stamp is a new comment. The `<N> earlier comments: <command>` line counts
  the comments the file leaves out.
- **No other heading** may appear anywhere in the file, the prose before the first card included.
  The sync renders the file whole, and it refuses a file with any other heading rather than drop
  or move it. The refusal names the line.

`ztrack check` validates the file with the kanban preset. It reports a schema error for an unknown
lane or a malformed field, and it reports these rules:

| Code | Severity | Fires when |
|---|---|---|
| `card_blocker_missing` | error | `Blocked by:` names a card that isn't in the file |
| `card_block_cycle` | error | cards block each other in a loop |
| `duplicate_issue_id` | error | two sections carry the same id |
| `card_done_before_blocker` | warning | a done card is blocked by a card that isn't done |
| `kanban_line_unparsed` | error | a line under Comments is neither a comment nor the count line |
| `sync_conflict` | error | the last sync found a collision, a refused edit, or a section with no card behind it |

## What a sync does

`ztrack sync hermes` reads the board, the file, and the state the two last agreed on (the base,
kept machine-local under the sync state directory). It merges each card field by field. A field
changed on one side only takes that side's value. A field changed on both sides to different
values is a collision (see [Collisions](#collisions)). The sync applies the file's side to the
board, reads the board again, and writes the file whole from it.

| In the file | On the board |
|---|---|
| a section whose id isn't a board id (`## new-1 — …`) | `create`. The section's id becomes the new card's. `Blocked by:` may name another new section. |
| `status:` changed | `complete`, `block`, `schedule`, `request-review`, `unblock`, `promote` or `reopen-review`, whichever makes that move |
| `assignee:` changed or removed | `assign` |
| `Blocked by:` changed | `link` / `unlink` |
| a `- text` line under Comments | `comment` |
| a section deleted | `archive` |
| title, opening post, `Workspace:`, `Branch:` or `Priority:` changed, or a done card moved to another lane | the card is **re-created** (below) |

Hermes has no door to edit a created card's title, body, workspace, branch or priority, and none
to reopen a done card. So the sync re-creates the card, the way a board operator does by hand. It
creates a new card with the edited fields and the same parents. It relinks the old card's children
to the new card, comments `replaces t_…` on the new card and `replaced by t_…` on the old one,
archives the old card, and renames the section to the new id. A running card is never re-created.

Board to file: every change another actor makes shows in the file after the next sync. That covers
a lane move by a dispatcher, a new card, a comment, an assignment and a link. A card archived on
the board leaves the file. So does a link to an archived card, since the card no longer gates
anything the board shows.

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
- a section whose card is gone from the board, archived there while the section was edited, or a
  board id the board never had (delete the section to resolve it);
- a new section whose card couldn't be created.

A refused write never leaves a sync half-done. The sync carries on and writes the file from the
board as it now stands.

## Limits

- One writer at a time. If the file changes while a sync runs, the sync applies what it read, leaves
  the file alone, and says to run it again.
- A done card shows only its comment count. An open card shows its newest `comments`. The full
  thread stays on the board (`hermes kanban show <id>`).
- A sync reads every card with one `hermes kanban show` each, eight at a time. A board of about 40
  cards takes several seconds.
