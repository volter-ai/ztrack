// ZTB-4 dev/09: a `format: "document"` source's on-disk machinery — one markdown FILE, parsed
// (src/documentParser.ts) into many issues at construction, spliced back into on write.
//
// READ (construction + `load`): every NON-umbrella parsed issue's section text is decomposed
// (documentWriteBack.ts's `decomposeSection`) into a heading line, an optional `status:`/
// `assignee:` header block, and the item's real content — which is then heading-shifted so an
// item's OWN `###` subsections present at `##` (preset-shaped: `ac patch`/`check`/round-trip all
// apply to a document issue for real, same as an issue-per-file one). The umbrella issue (a
// `Title:` header, whole-file, no span) is presented exactly as before — never reshaped, never
// writable.
//
// WRITE (`write`): accepts a CanonicalIssue whose only changed fields are
// `body`/`title`/`status`/one `assignee` (ZTB-16 dev/03 added `status`; document grammar stores one
// assignee in its header block). Labels/project/parent/children/comments still fail closed, naming
// the file and field. Re-reads the file fresh, requires it to still hold the
// exact bytes last parsed (else "changed since read"). State and assignee changes are spliced FIRST
// (documentWriteBack.ts's `spliceStatusLine`, rewriting ONLY the item's `status:` header line's
// value — fails closed if the item has none, never inventing one), then the (possibly
// status-patched) raw is re-shifted/re-spliced for body/title the same way as before
// (`spliceSectionText`) when body/title changed; metadata-only writes use the header-spliced raw
// directly. This lets parent items with id-bearing children change status/assignee without
// pretending their excised body is spliceable.
// Before writing anything, re-parses the CANDIDATE file to prove every OTHER issue is unaffected:
// a non-ancestor's section must be byte-identical (raw comparison), an ANCESTOR of the target (a
// section whose recorded span contains the target's — necessarily true for any item nested above
// a spliced leaf) must have its own post-excision `body`/`title` unchanged instead (its raw
// legitimately differs, since raw embeds the now-changed nested bytes), and the target itself must
// re-present to exactly the new body, state, and assignee. Any guard failing means NOTHING is
// written. Body/title splices are legal only for leaves; header metadata is also legal for parent
// items. The umbrella and `delete` still always fail closed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IssueSource, SourceOrigin } from './issueSource.ts';
import { type CanonicalIssue, stateTypeOf } from './markdown.ts';
import { parseMarkdownDocumentSource, type DocumentParsedIssue } from '../documentParser.ts';
import {
  decomposeSection,
  NoStatusHeaderError,
  shiftHeadings,
  spliceAssigneeLine,
  spliceSectionText,
  spliceStatusLine,
} from '../documentWriteBack.ts';
import type { ResolvedSource } from '../sources.ts';

// ── fail-closed messages (every one names the source FILE) ─────────────────────────────────────

function umbrellaWriteError(filePath: string): Error {
  return new Error(
    `the source '${filePath}' is a "document" source (one markdown file holding many issues); this issue is the ` +
    "file's UMBRELLA record (its `Title:` header, or otherwise a section with no recorded line span) — it IS the " +
    'file, not a spliceable section within it, so it can never be written through ztrack. Edit the file directly.',
  );
}

function excisedWriteError(filePath: string, id: string): Error {
  return new Error(
    `the source '${filePath}' is a "document" source; issue ${id} has id-bearing child sections whose subtrees ` +
    "were excised from its own body (they're separate issues), so its recorded span does not map cleanly onto " +
    `just its own bytes. Edit the child issues individually, or edit '${filePath}' directly.`,
  );
}

function reshapeFailedError(filePath: string, id: string, detail: string): Error {
  return new Error(
    `the source '${filePath}' is a "document" source; issue ${id}'s section could not be safely decomposed for ` +
    `write-back (${detail}) — edit '${filePath}' directly instead.`,
  );
}

function multipleAssigneesError(filePath: string, id: string): Error {
  return new Error(
    `the source '${filePath}' is a "document" source; its \`assignee:\` header stores exactly one assignee for issue ${id}, ` +
    'so multiple assignees cannot be written.',
  );
}

// ZTB-16 dev/03: a state change fails closed with THIS error (never inventing a `status:` line)
// only when the item has no `status:` header line to splice into — status changes are otherwise
// spliced, see `write()`'s use of `spliceStatusLine`.
function noStatusHeaderError(filePath: string, id: string): Error {
  return new Error(
    `the source '${filePath}' is a "document" source; issue ${id} has no \`status:\` header line to splice a ` +
    `status change into (write-back never invents one) — add a \`status:\` line under issue ${id}'s heading in ` +
    `'${filePath}', or edit it directly.`,
  );
}

function fieldNotStoredError(filePath: string, id: string, field: string): Error {
  return new Error(
    `the source '${filePath}' is a "document" source; it stores no ${field} for issue ${id}, so ${field} cannot be ` +
    `changed through ztrack (write-back only splices body, title, status, and one assignee into the recorded span) — edit '${filePath}' directly.`,
  );
}

function staleFileError(filePath: string): Error {
  return new Error(`the source '${filePath}' changed on disk since it was read; re-run the command against its current contents (write-back refuses to splice into stale content).`);
}

function spliceFailedError(filePath: string, id: string, detail: string): Error {
  return new Error(`the source '${filePath}': could not splice issue ${id}'s edit (${detail}) — nothing was written. Edit '${filePath}' directly.`);
}

function integrityFailedError(filePath: string, detail: string): Error {
  return new Error(`the source '${filePath}': write-back integrity check failed (${detail}) — nothing was written to the file. Edit '${filePath}' directly.`);
}

/** `delete` always fails closed: removing a section is a file edit, not a tracker operation. */
export function documentDeleteError(filePath: string, id: string): Error {
  return new Error(
    `the source '${filePath}' is a "document" source; deleting issue ${id} means removing its section from the ` +
    `file, which ztrack does not do — edit '${filePath}' directly.`,
  );
}

// ── read-side presentation ──────────────────────────────────────────────────────────────────────

function baseCanonicalIssue(parsed: DocumentParsedIssue): CanonicalIssue {
  return {
    identifier: parsed.id, title: parsed.title, body: parsed.body,
    // No frontmatter to read a status from — default to the same "freshly minted" values
    // `issue create` uses for an omitted `--state` (draft / open; see markdownBackend.ts), unless
    // the item's own `status:`/`assignee:` header block (decomposeSection) overrides below.
    state: 'draft', stateType: 'open',
    assignees: [], labels: [], project: null, parent: parsed.parent, children: parsed.children,
    branchName: '', priority: 0, devProgress: null,
    // Deterministic, not per-load-varying (unlike `new Date().toISOString()`) — a document source
    // has no stored timestamps, so round-trip/idempotency never depends on wall-clock time.
    createdAt: '', updatedAt: '', completedAt: null, canceledAt: null,
    url: `local://tracker/issue/${parsed.id}`, comments: [],
  };
}

interface LoadedIssue {
  /** The PRESENTED (read-shaped) view: `issue view`/`issue list` return this. */
  issue: CanonicalIssue;
  /** Absent for the umbrella issue (mirrors fileToRecord's loose-mode "whole file, no span"). */
  lineStart?: number;
  lineEnd?: number;
  /** The heading's level and the section's raw text (heading + full subtree) as last parsed —
   *  the write path's staleness/writability reference. Both absent for the umbrella issue. */
  level?: number;
  raw?: string;
  /** documentParser's parsed body (post-excision, pre-reshape) — `raw !== parsedBody` means an
   *  id-bearing descendant's subtree was excised, which fails writes closed (excisedWriteError).
   *  Absent for the umbrella issue. */
  parsedBody?: string;
  /** Set when decomposing/shifting this section for READ failed (e.g. a setext heading inside
   *  it — documentWriteBack.ts's `HeadingShiftError`); the issue still reads fine (falls back to
   *  the unshifted body, exactly like a pre-dev/09 document issue) but `write` refuses it. */
  reshapeError?: string;
  /** ZTB-23 dev/04: set when this item's own `status:`/`assignee:` header block was silently
   *  discarded for lack of a blank-line terminator (decomposeSection's `discardedHeaderLine`) —
   *  the human-readable diagnostic `DocumentSource.headerDiagnostics()` surfaces for it. Mirrors
   *  `fileToRecord`'s `loose_header_ignored` (src/check.ts), extended to the multi-issue document
   *  scan path, which had no such diagnostic before. */
  headerDiagnostic?: string;
}

/** Reshape one non-umbrella parsed issue's section into its presented CanonicalIssue. Never
 *  throws: a decompose/shift failure is caught and recorded as `reshapeError` (read still works,
 *  unshifted, matching pre-dev/09 behavior; only `write` treats it as fatal). */
function buildLoadedIssue(parsed: DocumentParsedIssue): LoadedIssue {
  const base = baseCanonicalIssue(parsed);
  if (parsed.lineStart === undefined || parsed.level === undefined || parsed.raw === undefined) {
    // The umbrella issue (or, defensively, any record missing the additive dev/09 fields) —
    // no reshaping, never writable. Its `Title:` header block's Status:/Assignee: lines (parsed
    // by documentParser, same fileToRecord semantics) DO shape its presented state/assignee
    // (ZTB-4 dev/10): a document's umbrella is otherwise permanently unassigned, which no
    // preset with an assignee rule could ever accept.
    const state = parsed.status ?? base.state;
    const issue: CanonicalIssue = {
      ...base, state, stateType: stateTypeOf(state),
      assignees: parsed.assignee ? [parsed.assignee] : base.assignees,
    };
    return { issue, lineStart: parsed.lineStart, lineEnd: parsed.lineEnd };
  }
  let issue = base;
  let reshapeError: string | undefined;
  let headerDiagnostic: string | undefined;
  try {
    const decomposed = decomposeSection(parsed.body);
    const body = shiftHeadings(decomposed.middle, 1 - parsed.level); // -(level-1)
    const status = decomposed.header?.status;
    const assignee = decomposed.header?.assignee;
    const state = status ?? 'draft';
    issue = { ...base, body, state, stateType: stateTypeOf(state), assignees: assignee ? [assignee] : [] };
    if (decomposed.discardedHeaderLine !== undefined) {
      headerDiagnostic = `issue ${parsed.id}'s status:/assignee: header block was aborted by a non-blank, ` +
        `non-header-shaped line (it needs a blank line to end the header block) and fell back to plain ` +
        `content — discarding any status:/assignee: lines already read: "${decomposed.discardedHeaderLine}"`;
    }
  } catch (e) {
    reshapeError = e instanceof Error ? e.message : String(e);
    // `issue` stays `base` (unshifted) — a conservative fallback so a read never corrupts, it just
    // shows the item less nicely reshaped; `write` refuses it below (reshapeError is set).
  }
  return {
    issue, lineStart: parsed.lineStart, lineEnd: parsed.lineEnd,
    level: parsed.level, raw: parsed.raw, parsedBody: parsed.body, reshapeError, headerDiagnostic,
  };
}

function loadedIssuesFrom(parsedIssues: DocumentParsedIssue[]): Map<string, LoadedIssue> {
  return new Map(parsedIssues.map((parsed) => [parsed.id, buildLoadedIssue(parsed)]));
}

// `load()` must hand out an INDEPENDENT copy, never a live reference into `byId`: callers (e.g.
// markdownBackend.ts's `issue edit`) mutate the object `load()` returns in place — `c.title = t`,
// `c.state = s`, `c.labels.push(...)` — before calling `write(c)`. If `load()` returned the same
// object stored internally, that mutation would ALSO mutate the "what was originally stored"
// baseline `write()` diffs against (they'd be one object), silently defeating every guard above
// (a title/state/label change would compare as "unchanged" against itself). `MarkdownSource`
// never has this hazard (its `load()` reparses the file text fresh every call); DocumentSource
// caches, so it must clone on the way out instead.
function cloneCanonicalIssue(c: CanonicalIssue): CanonicalIssue {
  return {
    ...c,
    assignees: [...c.assignees], labels: [...c.labels], children: [...c.children],
    comments: c.comments.map((cc) => ({ ...cc })),
  };
}

// ── write-side helpers ───────────────────────────────────────────────────────────────────────

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Absolute character offset of the start of `lines[lineIndex]` (0-based) if `lines` were
 *  rejoined with `\n`. Used to locate a section's recorded line span within the fresh file text
 *  (which — by the time this is called — is confirmed LF-only, so this is exact). */
function offsetAtLine(lines: readonly string[], lineIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) offset += lines[i]!.length + 1;
  return offset;
}

export class DocumentSource implements IssueSource {
  readonly format = 'document' as const;
  readonly readonlySource: boolean;
  readonly isDefault: boolean;
  readonly location: string; // the file itself — ResolvedSource.dir names a FILE for a document source
  readonly name: string; // ZTB-33 `--source` selector (ResolvedSource.name)
  private byId: Map<string, LoadedIssue>;

  constructor(resolved: ResolvedSource) {
    this.location = resolved.dir;
    this.readonlySource = resolved.readonly;
    this.isDefault = resolved.isDefault; // always false in practice: a file path never equals markdownStoreDir()
    this.name = resolved.name;
    const text = existsSync(this.location) ? readFileSync(this.location, 'utf8') : '';
    this.byId = loadedIssuesFrom(parseMarkdownDocumentSource(text, this.location));
  }

  ids(): string[] { return [...this.byId.keys()]; }
  load(id: string): CanonicalIssue | null {
    const entry = this.byId.get(id);
    return entry ? cloneCanonicalIssue(entry.issue) : null;
  }
  // ZTB-23 dev/04: every item whose own header block was silently discarded (see
  // buildLoadedIssue's `headerDiagnostic` above) — a cross-cutting `ztrack check` finding
  // (documentHeaderFindings, src/documentDiagnostics.ts), read directly off this source the same
  // way sync conflicts are (independent of the backend's `issue list` JSON contract).
  headerDiagnostics(): Array<{ issueId: string; message: string }> {
    const out: Array<{ issueId: string; message: string }> = [];
    for (const [id, entry] of this.byId) if (entry.headerDiagnostic) out.push({ issueId: id, message: entry.headerDiagnostic });
    return out;
  }
  origin(id: string): SourceOrigin {
    const entry = this.byId.get(id);
    return {
      path: this.location,
      ...(entry?.lineStart !== undefined ? { lineStart: entry.lineStart } : {}),
      ...(entry?.lineEnd !== undefined ? { lineEnd: entry.lineEnd } : {}),
    };
  }

  write(c: CanonicalIssue, opts: { dryRun?: boolean } = {}): void {
    const stored = this.byId.get(c.identifier);
    if (!stored) throw new Error(`markdown backend (document source '${this.location}'): cannot resolve issue ${c.identifier}.`);

    const bodyChanged = c.body !== stored.issue.body;
    const titleChanged = c.title !== stored.issue.title;

    // (a) structural fail-closed gates. The umbrella has no section span and remains unwritable.
    // An item with id-bearing children cannot safely rewrite body/title because its presented body
    // excludes those child subtrees, but header-only state/assignee changes remain byte-local.
    if (stored.lineStart === undefined || stored.level === undefined || stored.raw === undefined) {
      throw umbrellaWriteError(this.location);
    }
    if (stored.parsedBody !== stored.raw && (bodyChanged || titleChanged)) throw excisedWriteError(this.location, c.identifier);
    if (stored.reshapeError !== undefined) throw reshapeFailedError(this.location, c.identifier, stored.reshapeError);

    // (a) the writable delta is exactly `body`/`title`/`status`/one `assignee` — everything else
    // must be unchanged. State and assignee changes are spliced into the item's own header block.
    const stateChanged = c.state !== stored.issue.state || c.stateType !== stored.issue.stateType;
    const assigneeChanged = !sameStrings(c.assignees, stored.issue.assignees);
    if (c.assignees.length > 1) throw multipleAssigneesError(this.location, c.identifier);
    if (!sameStrings(c.labels, stored.issue.labels)) throw fieldNotStoredError(this.location, c.identifier, 'labels');
    if (c.project !== stored.issue.project) throw fieldNotStoredError(this.location, c.identifier, 'project');
    if (c.parent !== stored.issue.parent) throw fieldNotStoredError(this.location, c.identifier, 'parent');
    if (!sameStrings(c.children, stored.issue.children)) throw fieldNotStoredError(this.location, c.identifier, 'children');
    if (JSON.stringify(c.comments) !== JSON.stringify(stored.issue.comments)) throw fieldNotStoredError(this.location, c.identifier, 'comments');

    // (b) STALENESS GUARD: re-read + re-parse fresh, require the exact bytes/span last parsed.
    // CRLF (a Windows/autocrlf checkout) is a file-boundary concern only: every recorded span and
    // splice below runs in LF space (the read path normalizes identically), and the final write
    // restores the file's own EOL — so spans always map onto the text actually being spliced.
    const diskText = existsSync(this.location) ? readFileSync(this.location, 'utf8') : '';
    const hadCrlf = diskText.includes('\r\n');
    const freshText = diskText.replace(/\r\n?/g, '\n');
    const freshIssues = parseMarkdownDocumentSource(freshText, this.location);
    const freshParsed = freshIssues.find((i) => i.id === c.identifier);
    if (!freshParsed || freshParsed.raw !== stored.raw || freshParsed.lineStart !== stored.lineStart || freshParsed.lineEnd !== stored.lineEnd) {
      throw staleFileError(this.location);
    }

    // (c) build the new section text (heading possibly renamed + shifted new body + byte-preserved
    // prefix/suffix), re-derived from the FRESH raw (identical to `stored.raw`, confirmed above).
    // State and assignee metadata are spliced into the FRESH raw FIRST, then spliceSectionText
    // copies the resulting header block through while applying any body/title change.
    let rawForSplice = freshParsed.raw!;
    if (stateChanged) {
      try {
        rawForSplice = spliceStatusLine(rawForSplice, c.state);
      } catch (e) {
        if (e instanceof NoStatusHeaderError) throw noStatusHeaderError(this.location, c.identifier);
        throw spliceFailedError(this.location, c.identifier, e instanceof Error ? e.message : String(e));
      }
    }
    if (assigneeChanged) {
      try {
        rawForSplice = spliceAssigneeLine(rawForSplice, c.assignees[0] ?? null);
      } catch (e) {
        throw spliceFailedError(this.location, c.identifier, e instanceof Error ? e.message : String(e));
      }
    }
    let newSectionText = rawForSplice;
    if (bodyChanged || titleChanged) {
      try {
        newSectionText = spliceSectionText(rawForSplice, stored.level, stored.issue.title, c.title, c.body);
      } catch (e) {
        throw spliceFailedError(this.location, c.identifier, e instanceof Error ? e.message : String(e));
      }
    }

    // Locate the recorded span's exact byte offsets within the fresh (confirmed LF-only) text.
    const freshLines = freshText.split('\n');
    const sectionStart = offsetAtLine(freshLines, freshParsed.lineStart! - 1);
    const sectionEnd = sectionStart + freshParsed.raw!.length;
    if (freshText.slice(sectionStart, sectionEnd) !== freshParsed.raw) {
      throw integrityFailedError(this.location, 'recorded span did not resolve to the parsed section text');
    }
    const candidateText = freshText.slice(0, sectionStart) + newSectionText + freshText.slice(sectionEnd);

    // (d) INTEGRITY GUARD: re-parse the CANDIDATE before writing anything.
    const candidateIssues = parseMarkdownDocumentSource(candidateText, this.location);
    const freshIds = freshIssues.map((i) => i.id).sort();
    const candidateIds = candidateIssues.map((i) => i.id).sort();
    if (JSON.stringify(freshIds) !== JSON.stringify(candidateIds)) {
      throw integrityFailedError(this.location, 'the candidate file would change the set of issue ids in the document');
    }
    const candidateById = new Map(candidateIssues.map((i) => [i.id, i]));
    for (const other of freshIssues) {
      if (other.id === c.identifier) continue;
      const candidateOther = candidateById.get(other.id);
      if (!candidateOther) {
        throw integrityFailedError(this.location, `issue ${other.id}'s section would change (write-back must touch only issue ${c.identifier}'s span)`);
      }
      // An ANCESTOR of the target (a section whose recorded span CONTAINS the target's span) is
      // expected to have different RAW bytes after a nested splice — its raw is heading + full
      // subtree, which necessarily embeds the target's now-changed bytes. What must stay unchanged
      // is the ancestor's OWN content: its post-excision `body` (id-bearing descendant subtrees,
      // including the target's, are already excised from it — documentParser.ts) and its `title`.
      // The umbrella issue has no recorded span (`lineStart`/`lineEnd` undefined) and is therefore
      // never classified as an ancestor here — it keeps the raw comparison below, which for it
      // compares `undefined !== undefined` and passes; the umbrella's own parsed body legitimately
      // changes whenever a nested section changes, so it must NOT get a body/title comparison.
      const isAncestor = other.lineStart !== undefined && other.lineEnd !== undefined
        && other.lineStart <= freshParsed.lineStart! && other.lineEnd >= freshParsed.lineEnd!;
      if (isAncestor) {
        if (candidateOther.body !== other.body || candidateOther.title !== other.title) {
          throw integrityFailedError(
            this.location,
            `issue ${other.id}'s own content (outside its child issues' sections) would change (write-back must touch only issue ${c.identifier}'s span)`,
          );
        }
      } else if (candidateOther.raw !== other.raw) {
        throw integrityFailedError(this.location, `issue ${other.id}'s section would change (write-back must touch only issue ${c.identifier}'s span)`);
      }
    }
    const candidateTarget = candidateById.get(c.identifier);
    if (!candidateTarget) throw integrityFailedError(this.location, `issue ${c.identifier} would no longer exist in the candidate file`);
    const candidateLoaded = buildLoadedIssue(candidateTarget);
    if (candidateLoaded.reshapeError !== undefined
      || candidateLoaded.issue.body !== c.body
      || candidateLoaded.issue.state !== c.state
      || candidateLoaded.issue.stateType !== c.stateType
      || !sameStrings(candidateLoaded.issue.assignees, c.assignees)) {
      throw integrityFailedError(this.location, `re-presenting issue ${c.identifier} after the splice did not reproduce the new body/status/assignee exactly`);
    }

    // ztrack#28: a dry run stops HERE — every guard above ((a) structural, delta, (b) staleness,
    // (c) splice, (d) integrity) has run against the real fresh file, so a non-throwing return is
    // an honest prediction that the real write would be accepted. Nothing was written and the
    // in-memory view is untouched.
    if (opts.dryRun) return;

    // (e) write (restoring the file's own EOL — see the boundary note in (b)), then refresh the
    // in-memory view so subsequent same-process reads (ac patch's post-edit view,
    // reparentChildren sequences, etc.) see the new state — including every issue's updated spans.
    writeFileSync(this.location, hadCrlf ? candidateText.replace(/\n/g, '\r\n') : candidateText);
    this.byId = loadedIssuesFrom(candidateIssues);
  }

  delete(id: string): void { throw documentDeleteError(this.location, id); }
}
