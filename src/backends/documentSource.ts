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
// WRITE (`write`): accepts a CanonicalIssue whose only changed fields are `body`/`title` (every
// other field must be unchanged — status/assignee/labels/project/parent/children/comments have no
// home in a document's grammar and fail closed, naming the file and the field). Re-reads the file
// fresh, requires it to still hold the exact bytes last parsed (else "changed since read"),
// re-shifts the new body back to the file's heading depth, splices the new section text into the
// recorded span, and — before writing anything — re-parses the CANDIDATE file to prove every
// other issue's section is byte-identical and the target re-presents to exactly the new body. Any
// guard failing means NOTHING is written. `delete` still always fails closed (removing a section
// is a file edit, not a tracker op).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IssueSource, SourceOrigin } from './issueSource.ts';
import { type CanonicalIssue, stateTypeOf } from './markdown.ts';
import { parseMarkdownDocumentSource, type DocumentParsedIssue } from '../documentParser.ts';
import { decomposeSection, shiftHeadings, spliceSectionText } from '../documentWriteBack.ts';
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

function statusOrAssigneeError(filePath: string, id: string, field: 'status' | 'assignee'): Error {
  return new Error(
    `the source '${filePath}' is a "document" source; a document item's ${field} lives on its \`${field}:\` header ` +
    `line inside the file — splicing a ${field} change is not implemented. Edit issue ${id}'s \`${field}:\` line in ` +
    `'${filePath}' directly.`,
  );
}

function fieldNotStoredError(filePath: string, id: string, field: string): Error {
  return new Error(
    `the source '${filePath}' is a "document" source; it stores no ${field} for issue ${id}, so ${field} cannot be ` +
    `changed through ztrack (write-back only splices \`body\`/title into the recorded span) — edit '${filePath}' directly.`,
  );
}

function staleFileError(filePath: string): Error {
  return new Error(`the source '${filePath}' changed on disk since it was read; re-run the command against its current contents (write-back refuses to splice into stale content).`);
}

function crlfError(filePath: string): Error {
  return new Error(
    `the source '${filePath}' contains CRLF line endings; document-source write-back only supports LF files (the ` +
    'read path normalizes CRLF, so a recorded span would no longer map onto the real on-disk bytes) — convert the ' +
    'file to LF line endings and retry.',
  );
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
}

/** Reshape one non-umbrella parsed issue's section into its presented CanonicalIssue. Never
 *  throws: a decompose/shift failure is caught and recorded as `reshapeError` (read still works,
 *  unshifted, matching pre-dev/09 behavior; only `write` treats it as fatal). */
function buildLoadedIssue(parsed: DocumentParsedIssue): LoadedIssue {
  const base = baseCanonicalIssue(parsed);
  if (parsed.lineStart === undefined || parsed.level === undefined || parsed.raw === undefined) {
    // The umbrella issue (or, defensively, any record missing the additive dev/09 fields) —
    // presented exactly as before dev/09: no reshaping, never writable.
    return { issue: base, lineStart: parsed.lineStart, lineEnd: parsed.lineEnd };
  }
  let issue = base;
  let reshapeError: string | undefined;
  try {
    const decomposed = decomposeSection(parsed.body);
    const body = shiftHeadings(decomposed.middle, 1 - parsed.level); // -(level-1)
    const status = decomposed.header?.status;
    const assignee = decomposed.header?.assignee;
    const state = status ?? 'draft';
    issue = { ...base, body, state, stateType: stateTypeOf(state), assignees: assignee ? [assignee] : [] };
  } catch (e) {
    reshapeError = e instanceof Error ? e.message : String(e);
    // `issue` stays `base` (unshifted) — a conservative fallback so a read never corrupts, it just
    // shows the item less nicely reshaped; `write` refuses it below (reshapeError is set).
  }
  return {
    issue, lineStart: parsed.lineStart, lineEnd: parsed.lineEnd,
    level: parsed.level, raw: parsed.raw, parsedBody: parsed.body, reshapeError,
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
  private byId: Map<string, LoadedIssue>;

  constructor(resolved: ResolvedSource) {
    this.location = resolved.dir;
    this.readonlySource = resolved.readonly;
    this.isDefault = resolved.isDefault; // always false in practice: a file path never equals markdownStoreDir()
    const text = existsSync(this.location) ? readFileSync(this.location, 'utf8') : '';
    this.byId = loadedIssuesFrom(parseMarkdownDocumentSource(text, this.location));
  }

  ids(): string[] { return [...this.byId.keys()]; }
  load(id: string): CanonicalIssue | null {
    const entry = this.byId.get(id);
    return entry ? cloneCanonicalIssue(entry.issue) : null;
  }
  origin(id: string): SourceOrigin {
    const entry = this.byId.get(id);
    return {
      path: this.location,
      ...(entry?.lineStart !== undefined ? { lineStart: entry.lineStart } : {}),
      ...(entry?.lineEnd !== undefined ? { lineEnd: entry.lineEnd } : {}),
    };
  }

  write(c: CanonicalIssue): void {
    const stored = this.byId.get(c.identifier);
    if (!stored) throw new Error(`markdown backend (document source '${this.location}'): cannot resolve issue ${c.identifier}.`);

    // (a) structural fail-closed gates — the umbrella issue, no span, or an excised subtree.
    if (stored.lineStart === undefined || stored.level === undefined || stored.raw === undefined) {
      throw umbrellaWriteError(this.location);
    }
    if (stored.parsedBody !== stored.raw) throw excisedWriteError(this.location, c.identifier);
    if (stored.reshapeError !== undefined) throw reshapeFailedError(this.location, c.identifier, stored.reshapeError);

    // (a) the writable delta is exactly `body`/`title` — everything else must be unchanged.
    if (c.state !== stored.issue.state || c.stateType !== stored.issue.stateType) throw statusOrAssigneeError(this.location, c.identifier, 'status');
    if (!sameStrings(c.assignees, stored.issue.assignees)) throw statusOrAssigneeError(this.location, c.identifier, 'assignee');
    if (!sameStrings(c.labels, stored.issue.labels)) throw fieldNotStoredError(this.location, c.identifier, 'labels');
    if (c.project !== stored.issue.project) throw fieldNotStoredError(this.location, c.identifier, 'project');
    if (c.parent !== stored.issue.parent) throw fieldNotStoredError(this.location, c.identifier, 'parent');
    if (!sameStrings(c.children, stored.issue.children)) throw fieldNotStoredError(this.location, c.identifier, 'children');
    if (JSON.stringify(c.comments) !== JSON.stringify(stored.issue.comments)) throw fieldNotStoredError(this.location, c.identifier, 'comments');

    // (b) STALENESS GUARD: re-read + re-parse fresh, require the exact bytes/span last parsed.
    const freshText = existsSync(this.location) ? readFileSync(this.location, 'utf8') : '';
    if (freshText.includes('\r')) throw crlfError(this.location);
    const freshIssues = parseMarkdownDocumentSource(freshText, this.location);
    const freshParsed = freshIssues.find((i) => i.id === c.identifier);
    if (!freshParsed || freshParsed.raw !== stored.raw || freshParsed.lineStart !== stored.lineStart || freshParsed.lineEnd !== stored.lineEnd) {
      throw staleFileError(this.location);
    }

    // (c) build the new section text (heading possibly renamed + shifted new body + byte-preserved
    // prefix/suffix), re-derived from the FRESH raw (identical to `stored.raw`, confirmed above).
    let newSectionText: string;
    try {
      newSectionText = spliceSectionText(freshParsed.raw!, stored.level, stored.issue.title, c.title, c.body);
    } catch (e) {
      throw spliceFailedError(this.location, c.identifier, e instanceof Error ? e.message : String(e));
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
      if (!candidateOther || candidateOther.raw !== other.raw) {
        throw integrityFailedError(this.location, `issue ${other.id}'s section would change (write-back must touch only issue ${c.identifier}'s span)`);
      }
    }
    const candidateTarget = candidateById.get(c.identifier);
    if (!candidateTarget) throw integrityFailedError(this.location, `issue ${c.identifier} would no longer exist in the candidate file`);
    const candidateLoaded = buildLoadedIssue(candidateTarget);
    if (candidateLoaded.reshapeError !== undefined || candidateLoaded.issue.body !== c.body) {
      throw integrityFailedError(this.location, `re-presenting issue ${c.identifier} after the splice did not reproduce the new body exactly (the heading shift did not invert cleanly)`);
    }

    // (e) write, then refresh the in-memory view so subsequent same-process reads (ac patch's
    // post-edit view, reparentChildren sequences, etc.) see the new state — including every
    // issue's updated spans.
    writeFileSync(this.location, candidateText);
    this.byId = loadedIssuesFrom(candidateIssues);
  }

  delete(id: string): void { throw documentDeleteError(this.location, id); }
}
