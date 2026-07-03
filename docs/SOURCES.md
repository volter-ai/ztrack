# Sources

Where the tracker reads and writes issues from — the default single store, additional declared
directories, and a **document source**: one markdown file decomposed into many issues.

## What sources are

The tracker doesn't hardwire one folder. It reads one or more **declared sources** and unions
their issues by id. With no `sources:` key in `.volter/tracker-config.json` (the common case),
behavior is exactly the historical default: one implicit `issue-per-file` store at
`.volter/tracker/markdown/`. Declaring `sources:` is additive — it doesn't change that default
unless you say so.

## Declaring sources

```json
{
  "backend": "markdown",
  "sources": [
    { "path": ".volter/tracker/markdown" },
    { "path": "vendor/imported-issues", "readonly": true },
    { "path": "docs/BACKLOG.md", "format": "document" }
  ]
}
```

Each entry:

- **`path`** — repo-root-relative. A directory of one-issue-per-file markdown, or a single
  markdown file.
- **`format`** — `"issue-per-file"` (a directory) or `"document"` (one file, many issues).
  Optional: when omitted it's inferred from `path`'s shape — a path ending in `.md` defaults to
  `"document"`, anything else defaults to `"issue-per-file"`.
- **`readonly`** — optional, default `false`. `true` marks a source ztrack may read but never
  write; a write routed at it is rejected with an error naming the source file to edit instead.

The whole config is schema-validated. An unrecognized key at any level — top-level or nested,
including inside a `sources[]` entry — is a config error naming the key and, when it looks like a
typo, the nearest valid sibling (e.g. `source:` → `unknown key "source" ... did you mean
"sources"?`).

**Id conflicts.** ztrack never silently picks a winner when the same issue id is defined in two
different declared sources — `ztrack check` reports it as an `issue_id_conflict` error naming both
source paths. Rename one of them or remove the duplicate.

## The document format

A document source is one markdown file where headings whose text starts with an **id token**
(e.g. `APP-1`) become issues. Everything else in the file — prose, non-id-bearing sections — is
just body content, exactly like reading any other markdown.

```markdown
Title: Q3 backlog
Status: in-progress
Assignee: kim

Team-wide backlog for Q3. Items below are the individual work orders.

## APP-1 — Add the /health endpoint

status: in-progress
assignee: alex

Implement a liveness endpoint the load balancer can poll.

### APP-1a — Wire the route

status: draft
assignee: sam

Register the route in the router.

#### Acceptance Criteria

- [ ] dev/01 v1 GET /health returns 200
  - status: pending

## APP-2 — Add the /ready endpoint

status: draft
assignee: alex

### Acceptance Criteria

- [ ] dev/01 v1 GET /ready returns 200 once startup completes
  - status: pending
```

### What ztrack sees

Declare this file as a `document` source and `ztrack issue list --json identifier,title,parent`
reports four issues:

| id | title | parent | assignee | state |
|---|---|---|---|---|
| `BACKLOG` | Q3 backlog | *(none)* | kim | in-progress |
| `APP-1` | Add the /health endpoint | `BACKLOG` | alex | in-progress |
| `APP-1a` | Wire the route | `APP-1` | sam | draft |
| `APP-2` | Add the /ready endpoint | `BACKLOG` | alex | draft |

`APP-1a`'s presented body is level-shifted so the installed preset sees it in the exact shape it
expects from an issue-per-file store — its own `#### Acceptance Criteria` subsection (level 4 in
the document) is promoted to `## Acceptance Criteria`:

```markdown
Register the route in the router.

## Acceptance Criteria

- [ ] dev/01 v1 GET /health returns 200
  - status: pending
```

`APP-1`'s presented body excises `APP-1a`'s subtree (it's a child issue, not duplicated content).
`ztrack check` runs the installed preset over every one of these issues exactly as it would an
issue-per-file store — evidence rules, lifecycle gates, all of it. Splice write-backs (`ac patch`,
title/body edits) land on **leaf items at any nesting depth** — both `APP-2` and the nested
`APP-1a` are spliceable; an item with an id-bearing child (`APP-1`) reads fine but refuses splices,
failing closed with an error naming the file (see [Writing back](#writing-back)) — so keep the ACs
you intend to `ac patch` on leaf items.

### Grammar rules

- A heading whose text **starts with an id token** (`APP-1`, `ZL-A5`, …: a hyphenated
  alphanumeric token) starts an issue. The token becomes the id; an optional separator (em dash
  `—`, middot `·`, colon `:`, or just whitespace) and the remainder becomes the title. Nothing
  past the separator is parsed further.
- The heading's subtree (everything through the next same-or-shallower heading) is the issue's
  body — **except** any nested id-bearing heading inside it, which becomes a **child issue**
  instead (the nesting is the parent link) and is excised from the parent's body.
- Directly under an item's heading, an optional header block of `status: <state>` /
  `assignee: <name>` lines (one per line, terminated by a blank line) sets that item's presented
  state/assignee. The block is all-or-nothing: if any other non-matching line interrupts it before
  the blank line, the whole block is treated as absent — its lines read as plain body content and
  the item keeps its defaults (`draft` / unassigned).
- A per-item `Acceptance Criteria` subsection (any heading level, e.g. `### Acceptance Criteria`
  directly under a `##` item) attaches ACs to that item. Read-side, an item's own subsection
  headings are level-shifted so the preset's grammar sees them in canonical (issue-per-file)
  shape — a `###` AC subsection under a `##` item becomes `##`, matching what
  `simple-sdlc`/`simple-gh-sdlc` expect.
- The document **preamble** (everything before the first id-bearing heading) may carry `Title:` /
  `Status:` / `Assignee:` lines. If a `Title:` line is present, the file itself becomes an
  **umbrella issue** — every top-level id-bearing heading is its child. The umbrella's **id is
  always derived from the filename** (`BACKLOG.md` → `BACKLOG`), never from the `Title:` line's
  text — the `Title:` line only supplies the title (verbatim, including anything that looks like
  an id prefix) and, via the same header-block scan, the umbrella's `Status:`/`Assignee:`. With no
  `Title:` line, there's no umbrella — top-level items simply have no parent.
- Every issue records its **origin span** — the source file's path plus the heading section's
  line range (the umbrella has no span; it *is* the file). `ztrack check` findings print
  `path:line`.

## Writing back

Two kinds of edit reach a document source:

1. **Splices** — `ztrack ac patch` and `issue edit --title`/`--body` (and, through it, `fmt`).
   These re-derive the item's new section text and splice it into the file at the recorded span.
   Every byte **outside** that span is untouched; writing back an unmodified read reproduces the
   file byte-for-byte.
2. **Everything else fails closed**, with an error naming the file (and, in the config-validation
   sense, why):

| Change | Result |
|---|---|
| `title` / `body` (ac patch, `issue edit --title`/`--body`) | spliced into the recorded span |
| `state` (`issue edit --state`, `issue close`) | fails closed — a document item's state lives on its `status:` header line; edit the file directly |
| `assignee` (`issue edit --assignee`) | fails closed, same shape, naming `assignee:` |
| `labels` / `project` / `parent` / `children` | fails closed — the document stores none of these; write-back only splices body/title |
| `comment` (`issue comment`) | fails closed — comments have no home in the document grammar |
| `issue delete` | **always** fails closed — removing a section is a file edit, not a tracker operation |
| any write to the **umbrella** issue | **always** fails closed — the umbrella *is* the file, not a spliceable section within it |
| a write to an item whose subtree was **excised** (it has an id-bearing child) | fails closed regardless of field — its recorded span doesn't map cleanly onto just its own bytes |
| a write to a **nested leaf** item (its section lives inside an ancestor item's section, but it has no id-bearing children of its own) | spliced into the recorded span, same as any other leaf item — the integrity guard checks the ancestor's own content (outside its child issues' sections), not its raw bytes, so the ancestor's raw legitimately changing to embed the new span doesn't trip it |
| a write to a `readonly: true` source | fails closed at the source layer, before any document-specific guard runs |
| a **stale** document (changed on disk since it was read) | fails closed — re-run against current contents |

Header blocks are parsed on read but **never rewritten** by ztrack — the sanctioned way to change
an item's state or assignee is to edit the document directly, not a workaround. Every fail-closed
error names the file so the fix is always "edit it there."

## Diagnostics

Parsing failure modes that used to vanish silently now surface as findings on `ztrack check`:

| Code | Severity | Fires when |
|---|---|---|
| `issue_id_conflict` | error, unwaivable | the same issue id is defined in more than one declared source |
| `ac_sections_multiple` | warning | an issue has more than one `## Acceptance Criteria` heading — every section's ACs are merged (append), none discarded |
| `ac_outside_section` | warning | a checkbox item sits outside any recognized Acceptance Criteria section — it would otherwise vanish from the model with no trace |
| `ac_id_malformed` | warning | an AC line matches neither `<id> v<version> <text>` nor `<id> <text>`; the whole line becomes the id, unaddressable by `ac patch` |
| `loose_header_ignored` | warning | (loose single-file `ztrack check <file.md>` mode) a `Title:`/`Status:`/`Assignee:` header block was aborted by a non-header line, or a header-shaped line survives in the body |

`ac_sections_multiple`, `ac_outside_section`, and `ac_id_malformed` come from the installed
preset's own grammar (`simple-sdlc`/`simple-gh-sdlc`) — they fire identically whether the issue
lives in its own file or inside a document source's item, since a document item's body is
level-shifted into the same shape before the preset ever parses it. `loose_header_ignored` is
specific to checking a bare file as one issue (`ztrack check ./some-file.md`); a document source's
own `Title:`/`status:`/`assignee:` header-block scans do not currently emit it — an aborted
preamble header block is now discarded atomically, same as loose-file mode (ZTB-12): no umbrella
issue is minted, and none of the aborted block's `Title:`/`Status:`/`Assignee:` lines leak into
one. There is still no diagnostic naming the offending line for this case (a known gap) — a
document whose preamble header block aborts just quietly has no umbrella, the same shape as a
document with no `Title:` line at all.

## Round-trip fidelity

A document source's splice write-back sits on top of the same `parse → serialize`
position-preserving contract every preset write already has to satisfy — see
[Presets → Round-trip fidelity](PRESETS.md#round-trip-fidelity) for the exact guarantees
(unmodified round trip is byte-identical; an edit changes only the bytes the changed element
owns). The document layer adds one more constraint on top: the span it splices into must still be
exactly the bytes it last read, or the write refuses (the staleness guard above).

## Importing a freeform backlog

A real backlog usually isn't written in the grammar above — it's headings, prose, and checkboxes
with no id tokens, which today parses to **zero issues, silently**. `ztrack import` materializes
that freeform/mixed markdown into the strict document grammar, **in place**, so it becomes an
ordinary document source with full gating and round-trip:

```bash
ztrack import notes/backlog.md --dry-run     # preview: planned issue tree + diff, writes nothing
ztrack import notes/backlog.md               # materialize in place
ztrack import notes/backlog.md --register    # ...and append it to tracker-config.json's `sources`
```

`<path-or-glob>` accepts one or more of a `.md` file, a directory (recursive), or a quoted glob
(e.g. `"notes/**/backlog*.md"`) — a directory/glob import treats **each file as its own document
source** (its own tree; no folder-level parent issue is ever invented) and applies default excludes
(`node_modules`, `.volter`, and any directory already covered by a configured `issue-per-file`
source). Numbering across a multi-file batch is a single pass, so ids never collide even across
files imported together.

### Recognized shapes

| In the freeform file | Becomes |
|---|---|
| A heading whose text already starts with an id token (`APP-1 …`) | The existing issue — **never** altered or renumbered. |
| A heading with no id token | A **new issue** — an id token is inserted into the heading; nesting (heading depth) becomes the parent/child link, exactly the grammar above. |
| `- [ ]` / `* [ ]` checkbox items under an issue, outside a recognized `Acceptance Criteria` section | Promoted into a canonical `## Acceptance Criteria` subsection, each gaining a minted `dev/NN v1` id. |
| `TODO:`-prefixed lines | Same as a checkbox item — a planned AC, text preserved verbatim after the minted id. |
| Prose paragraphs | Left exactly where they are — an issue's body. |
| A headingless file (pure checklist, no headings at all) | Each **top-level** checkbox item promotes to its own issue (its text becomes the minted heading); that item's **nested** checkboxes become its Acceptance Criteria. |
| Content the importer can't map (e.g. preamble prose with no `Title:` header to attach it to) | **Left in place, untouched, and named in the run's report** — never guessed, never dropped. |

Id numbering: `--prefix <PREFIX>` if given, else inferred from an id already present in the file,
else the tracker config's `local.teamKey`, else a clear error asking for `--prefix`. Issue numbering
is the max existing numeric suffix **across every configured source** plus one, ascending in
document order (mirrors `issue create`'s own minting rule — never scoped per-prefix). AC ids
(`dev/NN`) are scoped **per issue**, continuing after that issue's own existing max.

### The `[x]` (pre-checked) policy

A checked box in a freeform backlog usually just means "someone's mental model says this is done"
— it carries no commit, no proof, nothing `ztrack check` could ever verify. Importing it as
`checked: true` would either mint a false claim or make the freshly materialized file immediately
fail its own gate. So **every pre-checked item imports as an UNCHECKED AC**, with the original claim
preserved by a marker appended to its text:

```markdown
- [ ] dev/03 v1 Write the onboarding doc (imported: previously marked done — needs evidence)
```

The run's report prints a count and a list of every item this happened to (issue, AC id, original
text) so nothing silently downgrades unnoticed. ztrack **never** mints `checked: true` or fabricates
evidence — closing the loop (citing the real commit that did the work) is a normal `ztrack ac patch`
afterward, same as any other AC.

### The idempotence contract

`ztrack import` is safe to run over and over:

- **Already-canonical input is a no-op**: byte-identical output, exit 0, reported as
  `no-op (already canonical)` — a whole directory/glob import is safe to re-run blindly for exactly
  this reason.
- **Incremental import touches only the new content**: append a freeform section to an
  already-materialized file and re-import — every byte of the previously materialized content is
  untouched; only the new section gains ids/AC scaffolding.
- **Existing ids are never altered or renumbered**, at either the issue or the AC level.
- The writer is **insert-only**: unmappable content is left in place, never deleted or reordered
  (the one exception is documented above — a headingless top-level checkbox line is converted into
  its own heading, and checkboxes/`TODO:` lines outside an AC section relocate INTO one, since that
  relocation is the whole point of materializing a freeform backlog; every other byte survives).
- CRLF input is rejected with a clear error (same LF-only constraint as document-source
  write-back) rather than silently mis-positioning an edit.

### `--register`

Without `--register`, `ztrack import` never touches `tracker-config.json` — it prints the exact
`sources` snippet to add. With `--register`, it appends precisely those entries (one
`{"path": "...", "format": "document"}` per materialized/no-op file), skipping any file that's
already a declared source (so re-running `--register` is idempotent, never a duplicate). If
`sources` wasn't declared at all yet, `--register` also makes the pre-existing implicit default
store explicit — declaring any source turns off the "no `sources:` key" default fallback (above),
so silently losing your existing board on your first `--register` would be a nasty surprise;
instead it's one more visible, printed, additive entry.

**Non-goals** (a different tool's job): extracting `TODO`/`FIXME` comments out of source code
(that's copy-out-with-provenance, a different semantic, not materialize-in-place); importing from
an external tracker (GitHub/Jira — the sync/twin layer's job, see
[`ztrack sync`](GUIDE.md#how-linked-sync-works)); non-markdown inputs.
