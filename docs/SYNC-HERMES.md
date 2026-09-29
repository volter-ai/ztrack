# A kanban as one markdown file

`ztrack sync hermes` keeps one markdown file in step with a kanban in
[Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)'s format, read and
written through supercode's board door (`supercode workflow`), which answers every `hermes kanban`
verb and works the board by its own workflow. The file is where the board is written. The board is
generated from it, and what only the board's dispatcher and sessions write (a move a session or a
reviewer makes, the open run) comes back into the file.

The file is a [document source](SOURCES.md#the-document-format) in the `kanban` preset's grammar.
The preset has no acceptance criteria, no evidence and no comment thread. A card is its lane, its
dependencies, a few lines of prose, and its **tasks**: one line each, with ids, ticked when done,
optionally blocked by other tasks or cards. On the board, each task is a subtask card of its own.
The file holds the open cards only. Done and archived cards stay on the board.

## Set up

```bash
npm install -D @volter/ztrack
npx ztrack init --preset kanban --sync hermes --hermes-home <home>   # writes arcs.md from the board
```

`init` writes this config and runs the first sync:

```json
{
  "validation": { "entrypoint": ".volter/tracker/validation/preset.mts", "installedFrom": "kanban" },
  "sync": { "provider": "hermes", "file": "arcs.md", "home": "<home>" },
  "sources": [{ "path": "arcs.md", "format": "document", "name": "board" }]
}
```

| `sync` key | Meaning |
|---|---|
| `file` | The board file, relative to the project root (`init --file`, default `arcs.md`). |
| `home` | The home the board lives in (`supercode workflow --root`, `init --hermes-home`). Absent: the environment's. |
| `board` | A named board (`--board <slug>`, `init --board`). Absent: the home's default board. |
| `bin` | The `supercode` executable. Default `supercode` on `PATH`. |

The board is read and written only through `supercode workflow` (its `list --json`, `create`,
`specify`, `assign`, `move`, `link`/`unlink`, `goto`, `comment` and `archive`), never through its
database file. The board's events, notices and dispatcher see a sync's writes the same way they
see a person's.

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

Done when: the manager's arcs live in arcs.md backed by its board; released.

### Tasks

- [x] c1 kanban preset and sync on main
- [ ] c2 the manager's repo runs from arcs.md
  - blocked-by: c1, t-954aa1da:c3
```

- **A card** is a level-2 heading `## <id> — <title>`. The id of a card on the board is its
  board id with `-` for `_` (`t_65a8d101` is `t-65a8d101`). The title is the card's whole title:
  the outcome.
- **Its header block** follows the heading after one blank line: `status: <lane>` and, when the card
  has one, `assignee: <profile>`, one per line, ending at a blank line. The blank line is required:
  without it the lines read as prose, the card as an unassigned `todo`, and both `ztrack check`
  (`card_header_unended`) and the sync refuse the file. A lane is a status of the board's workflow:
  Hermes's `triage`, `todo`, `ready`, `running`, `review`, `blocked`, `scheduled`, `done`, `archived`,
  and any status the board's own workflow declares (a supercode board's `stopped` or `reviewing`,
  say). A new card written with no `status:` line is `todo`.
- **Its metadata block** is the paragraphs after the header made wholly of these keys (the sync
  writes them as one). Each key is optional:
  - `Blocked by:` lists the cards that must finish first (parent links), comma-separated.
  - `Workspace:` is `scratch` (the default, never written), `worktree`, `worktree:<path>` or
    `dir:<path>`.
  - `Branch:` is the worktree branch.
  - `Priority:` is an integer. The default 0 is never written.
  - `Run:` is the card's open run on the board: the run id, its status, when it started and the
    session it names. The dispatcher writes it when it claims the card, so this line is read-only.
    A sync writes the board's value and ignores an edit to it.
  - `Machine:` is the machine the card runs on (the board's own field).
  - `Session:` is free text: the card's session address.
- **The prose** is everything after that, up to `### Tasks`: a few lines, such as `Done when:`.
  A line of it that starts with `#` is written `\#`. A first line that starts like a metadata key
  is written `\Key:`. Either way, it can't read as a heading or as metadata.
- **`### Tasks`** holds the card's tasks, one per line: `- [ ] <id> <text>` open, `- [x] <id> <text>`
  done. The id is `c<N>` (or another letter prefix and number, such as `s1`). A task written without
  one gets the card's next free `c<N>` on the next sync. An indented `- blocked-by: <refs>` line under a task names what it waits on: `c1` (a task
  of this card), `t-…:c2` (a task of another card), or `t-…` (a whole card).
- **No other heading** may appear anywhere in the file, the prose before the first card included.
  The sync renders the file whole, and it refuses a file with any other heading rather than drop
  or move it. The refusal names the line.

`ztrack check` validates the file with the kanban preset. It reports a schema error for a malformed
lane or field, and it reports these rules:

| Code | Severity | Fires when |
|---|---|---|
| `card_blocker_missing` | error | `Blocked by:` names a card that isn't in the file |
| `task_blocker_missing` | error | a task's `blocked-by` names a task or card that isn't in the file, or itself |
| `card_block_cycle` | error | cards or tasks block each other in a loop |
| `duplicate_issue_id` | error | two sections carry the same id |
| `duplicate_task_id` | error | a card has two tasks with one id |
| `done_before_blocker` | warning | a ticked task (or a done card) waits on something that isn't done |
| `card_header_unended` | error | a card's prose starts with a `status:`/`assignee:` line (no blank line after the header) |
| `kanban_line_unparsed` | error | a line under Tasks is neither a task nor its `blocked-by` line |

## What a sync does

`ztrack sync hermes` reads the board (one `supercode workflow list --json`), the file, and the state
the two last agreed on (the base, kept machine-local under the sync state directory). A field the
file changed since the base goes to the board; a field only the board changed comes to the file.
There is no conflict state: the file is where the board is written, so a field both changed takes
the file's value, and an edit the board's workflow refuses is reported by the sync while the file
shows the card as it stands. The sync then reads the board again and writes the file whole from it.

| In the file | On the board |
|---|---|
| a section whose id isn't a board id (`## new-1 — …`) | `create`, with the prose (and `Session:`) as its body. The section's id becomes the new card's. `Blocked by:` may name another new section. |
| the title, the prose or `Session:` changed | `specify`: the card's text, edited where it stands |
| `status:` changed | `goto`: whichever event the board's workflow says takes the card to that lane |
| `assignee:` changed or removed | `assign` |
| `Machine:` changed | `move` |
| `Blocked by:` changed | `link` / `unlink` |
| a task added | `create "c<N> <text>" --subtask-of <card>`: a subtask of the card |
| a task's text changed | `specify` on its subtask |
| a task ticked or unticked | `goto` its subtask to `done`, or back |
| a task's `blocked-by` changed | `link` / `unlink` on its subtask |
| a task deleted | `archive` its subtask |
| a section deleted | `archive` |
| `Workspace:`, `Branch:` or `Priority:` changed | the card is **re-created** (below) |

**Tasks are subtasks.** A task `c3` of card `t-…` is the subtask of that card titled `c3 <text>`.
A subtask is its own card: its own acceptance, its own review, and the card cannot close while one
is open, as the board's workflow says. A subtask filed on the board without a `c<N>` gets its card's
next free id in its title on the next sync. A subtask is never a section of its own: it shows as its
card's task, ticked when it is done.

**Re-creating.** The board has no door to edit a created card's workspace, branch or priority. So
the sync re-creates the card, the way a board operator does by hand. It creates a new card with
the edited fields, the same parents and text. It relinks the old card's children to the new card,
comments `replaces t_…` on the new card and `replaced by t_…` on the old one, archives the old
card, and renames the section to the new id. A running card, or one with subtasks, is never
re-created: the edit is reported as refused.

Board to file: every change another actor makes shows in the file after the next sync. That covers
a new card, a move a session or reviewer makes, an assignment, a link and a subtask. When the
dispatcher claims a card, the card moves to its running lane, gets the dispatcher's `assignee:`,
and gets a `Run:` line naming the session it started or adopted. When the run ends, the `Run:` line
goes away. A card that goes done or archived on the board leaves the file. So does a `Blocked by:`
naming it, since it no longer gates anything.

`ztrack check` only validates: it never syncs, so it never writes the file or the board. Only
`ztrack sync hermes` writes, and it refuses a file that doesn't validate. The refusal covers any
error `ztrack check` would report, and any card whose `status:`/`assignee:` lines aren't followed by
a blank line. It names each problem and makes no board write. `--dry-run` prints the board writes a
sync would make and changes nothing.

## Keeping it synced

```bash
npx ztrack sync hermes --watch
```

keeps running and syncs the moment either side moves: the board file is saved, or the board records
an event (its own stream, `supercode workflow watch`, whoever made the change: a person, the
dispatcher, a session, this sync). Triggers are debounced by 0.3 seconds and coalesced into one
sync at a time. A sync's own writes trigger one more sync, which finds both sides agreeing and
writes nothing. Events that change nothing the file shows don't trigger a sync: a lease renewal, a
heartbeat, the dispatcher's asks and notes, and comments. A failed sync (a file saved mid-edit that
doesn't validate, say) is printed and the next change tries again. When the board's stream ends, so
does `--watch`, so run it under something that restarts it.

Syncs of one board file take turns through a lock in the sync state directory, so a manual
`ztrack sync hermes` waits for a running one. A sync that changes nothing leaves the file
untouched. After a board change, the file changes under whoever has it open: read it again before
editing it.

## Limits

- If the file changes while a sync runs, the sync applies what it read, leaves the file alone, and
  says to run it again (`--watch` does, on the save that changed it).
- Every sync checks that the file it rendered reads back as the board it rendered it from, before
  it replaces the file. If it doesn't, the file is left as it was and the sync names the card and
  field.
