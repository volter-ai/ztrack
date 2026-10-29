// ZTB-4 dev/09: document-source write-back — the splice that turns a `DocumentSource`'s spans
// (dev/08) into a real write path. Two grammar-free primitives live here, independent of
// documentParser.ts's id-heading grammar and of any preset:
//
//   shiftHeadings(text, delta)   — renumber every ATX heading INSIDE `text` by `delta` levels,
//                                  at any indent and inside list items and block quotes
//                                  (a fenced-code `## fake` is never touched; a level pushed
//                                  outside [1,6], or a setext heading in the way, throws).
//   nestHeadings / unnestHeadings — the same move for a board card's text, losslessly: a heading
//                                  that cannot move is written as text and read back as itself.
//   decomposeSection(raw)        — split one parsed issue's section text (heading + subtree, the
//                                  same string documentParser.ts calls `raw`/`body`) into a
//                                  PREFIX (heading line + optional `status:`/`assignee:` header
//                                  block + the blank-line run up to the first content line), a
//                                  MIDDLE (the item's real content), and a trailing SUFFIX of
//                                  blank lines — reassembling prefix+middle+suffix reproduces
//                                  `raw` byte-for-byte (pinned by the property test in
//                                  documentWriteBack.test.ts).
//   spliceSectionText(...)       — the write-side inverse: given a FRESH `raw` re-read from disk,
//                                  rebuild the section text with a (possibly renamed) heading and
//                                  a new body, everything else byte-preserved.
//
// DocumentSource (backends/documentSource.ts) is the only caller — this module owns no I/O and no
// document-tree walking (that stays in documentParser.ts / markdownDocument.ts).
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';

// ── shiftHeadings ────────────────────────────────────────────────────────────────────────────

/** Thrown by `shiftHeadings` when it finds a heading it cannot safely renumber: a SETEXT heading
 *  (`Title\n===`/`Title\n---` — no `#` run to adjust; converting it to ATX risks corrupting text
 *  that merely looked like an underline, e.g. a thematic break glued to a preceding paragraph) or
 *  an ATX heading whose shifted level would leave the valid `#`-run range [1,6]. Callers treat
 *  this as "this item cannot be safely spliced" rather than attempting a lossy rewrite. */
export class HeadingShiftError extends Error {}

// A heading's line: the containers it sits in (indentation, block-quote `>` and list markers, as in a task's brief
// indented under its list item, `  ### Acceptance`), then its `#` run. The containers never hold a `#`, so the run is
// the line's first one and only it is renumbered.
const ATX_LINE_RE = /^((?:[ \t]|>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))*)(#{1,6})(\s.*|)$/;

/** Renumber every REAL ATX heading (mdast/CommonMark heading detection — a `#` inside a fenced or
 *  indented code block is not a heading) inside `text` by `delta` levels, leaving everything else
 *  byte-identical. `delta === 0` is still validated (still throws on a setext heading) so a
 *  caller that relies on "shiftHeadings succeeded" as a writability signal gets it even when the
 *  shift is a no-op (an L=1 document item, whose read/write shift delta is 0). */
export function shiftHeadings(text: string, delta: number, headingLines?: readonly number[]): string {
  const lines = text.split('\n');
  // The 0-based lines that start a heading: the caller's, when the document parse that cut `text`
  // already found them, else the GFM tokenizer's (only heading positions are read; the GFM tree
  // extensions are not built).
  let starts = headingLines;
  if (!starts) {
    const found: number[] = [];
    const walk = (node: unknown): void => {
      const n = node as { type?: string; position?: { start: { line: number } }; children?: unknown[] };
      if (n.type === 'heading' && n.position) found.push(n.position.start.line - 1); // mdast lines are 1-based
      for (const c of n.children ?? []) walk(c);
    };
    walk(fromMarkdown(text, { extensions: [gfm()] }));
    starts = found;
  }
  const edits: Array<{ lineIndex: number; lead: string; hashes: string; rest: string }> = [];
  for (const lineIndex of starts) {
    const raw = lines[lineIndex] ?? '';
    const atx = ATX_LINE_RE.exec(raw);
    if (!atx) {
      throw new HeadingShiftError(
        `shiftHeadings: line ${lineIndex + 1} ("${raw}") is a setext heading (Title\\n===/---), which cannot be ` +
        'renumbered without risking corruption of surrounding text; the item this belongs to is not splice-writable.',
      );
    }
    edits.push({ lineIndex, lead: atx[1] ?? '', hashes: atx[2]!, rest: atx[3] ?? '' });
  }
  for (const edit of edits) {
    const newLevel = edit.hashes.length + delta;
    if (newLevel < 1 || newLevel > 6) {
      throw new HeadingShiftError(
        `shiftHeadings: line ${edit.lineIndex + 1} would shift from level ${edit.hashes.length} to ${newLevel}, outside the valid [1,6] range.`,
      );
    }
    lines[edit.lineIndex] = `${edit.lead}${'#'.repeat(newLevel)}${edit.rest}`;
  }
  return lines.join('\n');
}

// ── nestHeadings / unnestHeadings ────────────────────────────────────────────────────────────
//
// A board card at heading level L holds its text with each heading moved down L-1 levels, so it
// sits under the card's heading. Three headings cannot move: a setext heading (it has no `#` run),
// a level-1 heading (it would land on the card's own level and end the card) and one that would
// pass level 6. Each is written as text instead: one `\` goes before its `#` run, or before a
// setext heading's underline, and Markdown reads that line as a paragraph's, showing the
// characters as typed. Reading removes the `\`. A line that already starts, after its containers,
// with `\`s and then a `#` run or an underline (ESCAPED_LINE_RE) gets one more `\` on the way out
// and loses one on the way back, so every text reads back as it was written. A text with none of
// these headings and none of these lines comes out exactly as shiftHeadings writes it.

const ESCAPED_LINE_RE = /^((?:[ \t]|>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))*)\\+(?:#{1,6}(?:\s|$)|(?:=+|-+)[ \t]*$)/;
const LEAD_RE = /^(?:[ \t]|>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))*/;

// Each heading Markdown finds in `text`: its first and last 0-based line (a setext heading's last
// line is its underline) and its level.
function headingsOf(text: string): Array<{ start: number; end: number; depth: number }> {
  const found: Array<{ start: number; end: number; depth: number }> = [];
  const walk = (node: unknown): void => {
    const n = node as { type?: string; depth?: number; position?: { start: { line: number }; end: { line: number } }; children?: unknown[] };
    if (n.type === 'heading' && n.position) found.push({ start: n.position.start.line - 1, end: n.position.end.line - 1, depth: n.depth! });
    for (const c of n.children ?? []) walk(c);
  };
  walk(fromMarkdown(text, { extensions: [gfm()] }));
  return found;
}

// The line-wise escape protocol never owns code or HTML bytes. Record their CommonMark
// spans before changing anything, and apply the same exclusion when reading encoded text.
function opaqueLines(text: string): Set<number> {
  const lines = new Set<number>();
  const walk = (node: unknown): void => {
    const n = node as { type?: string; position?: { start: { line: number }; end: { line: number } }; children?: unknown[] };
    if ((n.type === 'code' || n.type === 'html') && n.position) {
      for (let i = n.position.start.line - 1; i < n.position.end.line; i++) lines.add(i);
      return;
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(fromMarkdown(text, { extensions: [gfm()] }));
  return lines;
}

/** `text` written `delta` heading levels down, as a card at level `delta + 1` holds it (see above).
 *  Throws HeadingShiftError only when the result would not read back as `text`. */
export function nestHeadings(text: string, delta: number): string {
  const lines = text.split('\n');
  let escaped = false;
  const opaque = opaqueLines(text);
  const escape = (index: number): void => {
    const line = lines[index] ?? '';
    const lead = LEAD_RE.exec(line)![0];
    const written = `${lead}\\${line.slice(lead.length)}`;
    if (!ESCAPED_LINE_RE.test(written)) {
      throw new HeadingShiftError(`nestHeadings: line ${index + 1} ("${line}") is a heading that cannot be written as text.`);
    }
    lines[index] = written;
    escaped = true;
  };
  lines.forEach((line, index) => { if (!opaque.has(index) && ESCAPED_LINE_RE.test(line)) escape(index); });
  const kept = new Set<number>();
  for (const heading of headingsOf(text)) {
    const level = heading.depth + delta;
    if (heading.end > heading.start) {
      // A setext heading stays only where it needs no move: a level-2 one in a level-1 card's text.
      if (delta === 0 && level > 1) kept.add(heading.start);
      else escape(heading.end);
      continue;
    }
    const atx = ATX_LINE_RE.exec(lines[heading.start] ?? '');
    if (!atx) throw new HeadingShiftError(`nestHeadings: line ${heading.start + 1} ("${lines[heading.start]}") is a heading with no # run.`);
    if (level > delta + 1 && level <= 6) {
      lines[heading.start] = `${atx[1] ?? ''}${'#'.repeat(level)}${atx[3] ?? ''}`;
      kept.add(heading.start);
    } else escape(heading.start);
  }
  // Only `#` runs changed: the text reads as it did, one level for another (shiftHeadings' case).
  if (!escaped) return lines.join('\n');
  // A heading written as text is a paragraph's line, and a paragraph reads the lines after it
  // differently (a following `===` underlines it; an HTML block can no longer start after it), so
  // a heading the text did not have can appear. Each such heading is written as text too.
  for (;;) {
    const found = headingsOf(lines.join('\n')).filter((heading) => !kept.has(heading.start));
    if (!found.length) break;
    for (const heading of found) escape(heading.end);
  }
  const result = lines.join('\n');
  if (unnestHeadings(result, delta) !== text) {
    throw new HeadingShiftError(`nestHeadings: the text's headings cannot be written ${delta} level(s) down so that it reads back unchanged.`);
  }
  return result;
}

/** The inverse of `nestHeadings`: a card's text as it is held at level `delta + 1`, read back. */
export function unnestHeadings(text: string, delta: number): string {
  const lines = text.split('\n');
  const opaque = opaqueLines(text);
  for (const heading of headingsOf(text)) {
    if (heading.end > heading.start) {
      if (delta === 0) continue;
      throw new HeadingShiftError(`unnestHeadings: line ${heading.start + 1} ("${lines[heading.start]}") is a setext heading inside a card at level ${delta + 1}.`);
    }
    const atx = ATX_LINE_RE.exec(lines[heading.start] ?? '');
    if (!atx) throw new HeadingShiftError(`unnestHeadings: line ${heading.start + 1} ("${lines[heading.start]}") is a heading with no # run.`);
    const level = atx[2]!.length - delta;
    if (level < 1 || level > 6) {
      throw new HeadingShiftError(`unnestHeadings: line ${heading.start + 1} would shift from level ${atx[2]!.length} to ${level}, outside the valid [1,6] range.`);
    }
    lines[heading.start] = `${atx[1] ?? ''}${'#'.repeat(level)}${atx[3] ?? ''}`;
  }
  lines.forEach((line, index) => {
    if (opaque.has(index) || !ESCAPED_LINE_RE.test(line)) return;
    const lead = LEAD_RE.exec(line)![0];
    lines[index] = lead + line.slice(lead.length + 1);
  });
  return lines.join('\n');
}

// ── decomposeSection ─────────────────────────────────────────────────────────────────────────

const HEADER_LINE_RE = /^(status|assignee):\s*(.+)$/i;

export interface DecomposedSection {
  /** The section's first line, verbatim (the heading, e.g. `## DOC-1 — Alpha item`). */
  headingLineRaw: string;
  /** Heading line through the end of the consumed header block (if any), including its
   *  terminating blank-line run up to the first content line. Always starts with
   *  `headingLineRaw` verbatim. */
  prefixRaw: string;
  /** The item's real content — what `shiftHeadings(±(level-1))` operates on. */
  middle: string;
  /** The trailing run of blank lines at the very end of the section (before the next heading, or
   *  end of file). */
  suffixBlanks: string;
  /** The header block's fields, or `null` when no header block was present (never started, or
   *  aborted — see the module comment). Only `status`/`assignee` are recognized here; a `title:`
   *  line is NOT part of this grammar (the heading owns the title) and aborts the block exactly
   *  like any other non-matching line. */
  header: { status?: string; assignee?: string } | null;
  /** 0-based line index (within `raw.split('\n')`) of each header field's OWN line — lets a
   *  caller (spliceStatusLine, below) rewrite exactly one field's value without re-deriving the
   *  header-block scan. Empty when `header` is `null`; a key is present iff `header` has it. */
  headerLineIndex: { status?: number; assignee?: number };
  /** ZTB-23 dev/04: set when a header block was genuinely IN PROGRESS (at least one `status:`/
   *  `assignee:` line already matched) but then discarded because a non-blank, non-header-shaped
   *  line followed instead of the blank line the block needs to terminate — e.g. `assignee: me`
   *  immediately followed by prose, no blank line in between. `header` is `null` in this case,
   *  same as "there was never a header block at all"; this field is what lets a caller (
   *  DocumentSource) tell the two apart and emit a diagnostic instead of silently losing the
   *  metadata (mirrors `fileToRecord`'s `loose_header_ignored`, src/check.ts). The offending
   *  line, verbatim. Undefined whenever there was no partial match to discard (no header
   *  attempted at all, or a clean header + blank line). */
  discardedHeaderLine?: string;
}

function toLines(raw: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = raw.endsWith('\n');
  const lines = (trailingNewline ? raw.slice(0, -1) : raw).split('\n');
  return { lines, trailingNewline };
}

/** Decompose one parsed issue's section text (heading + subtree — `DocumentParsedIssue.raw`/
 *  `.body` in the common non-excised case) into prefix/middle/suffix. Pure string manipulation —
 *  no markdown parsing — since the header-block grammar is a fixed two-field line scan (mirrors
 *  `parseHeaderBlock` in documentParser.ts / `fileToRecord` in check.ts), not a markdown construct. */
export function decomposeSection(raw: string): DecomposedSection {
  const { lines } = toLines(raw);
  // Prefix sum of "line length + 1" per line, used as slice offsets into `raw`. Deliberately
  // over-counts a trailing separator after the LAST line even when `raw` has no trailing newline
  // — String.slice clamps an out-of-range end index to `raw.length`, so that overcount is benign
  // and lets every boundary (including "consumes the whole raw") share one formula.
  const ps: number[] = [0];
  for (let i = 0; i < lines.length; i++) ps.push(ps[i]! + lines[i]!.length + 1);
  const slice = (a: number, b: number): string => raw.slice(ps[a]!, ps[b]!);

  const headingLineRaw = lines[0] ?? '';

  // Skip the blank-line run immediately after the heading line.
  let skipStart = 1;
  while (skipStart < lines.length && lines[skipStart] === '') skipStart++;

  // Attempt the header-block scan starting right after that run — same abort semantics as
  // `parseHeaderBlock`/`fileToRecord`: stop (and consume) at the first blank line; a non-matching
  // non-blank line before that aborts the WHOLE block (nothing — not even earlier matched lines —
  // is consumed as header).
  let header: { status?: string; assignee?: string } | null = null;
  let headerLineIndex: { status?: number; assignee?: number } = {};
  let prefixEnd = skipStart;
  let discardedHeaderLine: string | undefined;
  {
    let idx = skipStart;
    const meta: Record<string, string> = {};
    const metaLines: Record<string, number> = {};
    let aborted = false;
    for (; idx < lines.length; idx++) {
      const line = lines[idx]!;
      if (line.trim() === '') { idx++; break; }
      const m = HEADER_LINE_RE.exec(line.trim());
      if (!m) { aborted = true; break; }
      const key = m[1]!.toLowerCase();
      // A header line edited as a page (Git Notes) may end in a Markdown hard break, `\`: it is not part of the value.
      meta[key] = m[2]!.replace(/\s*\\$/u, '').trim();
      metaLines[key] = idx;
    }
    if (!aborted && Object.keys(meta).length > 0) {
      header = meta;
      headerLineIndex = metaLines;
      prefixEnd = idx;
    } else if (aborted && Object.keys(meta).length > 0) {
      // A field WAS matched (status: or assignee:) before the abort — the block is being
      // silently discarded, not merely absent. Record the line that killed it (ZTB-23 dev/04).
      discardedHeaderLine = lines[idx]!;
    }
  }
  // Swallow any further blank lines up to the first content line — covers a multi-blank-line run
  // after the header block; a no-op when there was no header block (skipStart already consumed
  // the leading run).
  while (prefixEnd < lines.length && lines[prefixEnd] === '') prefixEnd++;

  const prefixRaw = slice(0, prefixEnd);

  let suffixStart = lines.length;
  while (suffixStart > prefixEnd && lines[suffixStart - 1] === '') suffixStart--;
  const middle = slice(prefixEnd, suffixStart);
  const suffixBlanks = slice(suffixStart, lines.length);

  return { headingLineRaw, prefixRaw, middle, suffixBlanks, header, headerLineIndex, ...(discardedHeaderLine !== undefined ? { discardedHeaderLine } : {}) };
}

// ── spliceSectionText ────────────────────────────────────────────────────────────────────────

/** The write-side inverse of `decomposeSection` + `shiftHeadings`: given a FRESHLY re-read
 *  section `raw` (so `prefixRaw`/`suffixBlanks` are re-derived from disk, never from a possibly
 *  stale construction-time snapshot), a `newTitle` (possibly unchanged) and a `newBody` (already
 *  in the CanonicalIssue's presented, unshifted shape), produce the new section text.
 *
 *  Title handling: if `newTitle === storedTitle`, the heading line is reused verbatim (byte-exact
 *  — no re-derivation risk). Otherwise `storedTitle` must be a non-empty, exact SUFFIX of the
 *  heading line; that suffix is replaced. A title that isn't a clean suffix (pathological
 *  spacing) throws — callers fail the whole write closed rather than guess. */
export function spliceSectionText(
  freshRaw: string,
  level: number,
  storedTitle: string,
  newTitle: string,
  newBody: string,
): string {
  const { headingLineRaw, prefixRaw, suffixBlanks } = decomposeSection(freshRaw);
  let newHeadingLine = headingLineRaw;
  if (newTitle !== storedTitle) {
    if (storedTitle.length === 0) {
      throw new Error(`spliceSectionText: cannot rename — the stored title is empty, so it cannot be located in the heading line "${headingLineRaw}".`);
    }
    const idx = headingLineRaw.lastIndexOf(storedTitle);
    if (idx === -1 || idx + storedTitle.length !== headingLineRaw.length) {
      throw new Error(`spliceSectionText: cannot rename — the stored title "${storedTitle}" is not the trailing text of the heading line "${headingLineRaw}".`);
    }
    newHeadingLine = headingLineRaw.slice(0, idx) + newTitle;
  }
  const newPrefixRaw = newHeadingLine + prefixRaw.slice(headingLineRaw.length);
  const shiftedBody = shiftHeadings(newBody, level - 1);
  return newPrefixRaw + shiftedBody + suffixBlanks;
}

// ── header-field splices ─────────────────────────────────────────────────────────────────────

/** Thrown by `spliceStatusLine` when the section has no `status:` header line to rewrite. No
 *  position is invented for a missing header — `decomposeSection` records no insertion point for
 *  one (see `DecomposedSection.headerLineIndex`, only ever populated for a field that's actually
 *  present), so a document item with no `status:` line fails this splice closed; the caller
 *  (documentSource.ts's `write()`) turns this into a fail-closed error naming the file/issue. */
export class NoStatusHeaderError extends Error {}

// The value stops before a Markdown hard break (`\`, a Git Notes page's line break), which a rewrite keeps.
const STATUS_VALUE_RE = /^(\s*status\s*:\s*)(.*?)(\s*(?:\\)?\s*)$/i;

/** ZTB-16 dev/03: the write-side analogue of `spliceSectionText`, scoped to ONE header field —
 *  given a FRESHLY re-read section `raw` (same staleness contract as `spliceSectionText`), rewrite
 *  ONLY the existing `status:` header line's VALUE, leaving every other byte untouched: the rest
 *  of that same line (key casing, colon spacing, trailing whitespace), the `assignee:` line if
 *  present, the heading, the body, everything. Composes with `spliceSectionText`: call this FIRST
 *  on the section's raw text, then feed the result in as `spliceSectionText`'s `freshRaw` — the
 *  updated status line rides along inside `prefixRaw`, which `spliceSectionText` otherwise copies
 *  verbatim. */
export function spliceStatusLine(raw: string, newStatus: string): string {
  const decomposed = decomposeSection(raw);
  const lineIndex = decomposed.headerLineIndex.status;
  if (!decomposed.header || lineIndex === undefined) {
    throw new NoStatusHeaderError(
      `spliceStatusLine: no \`status:\` header line found to splice (decomposeSection found ` +
      `${decomposed.header ? 'a header block, but with no status field in it' : 'no header block at all'}).`,
    );
  }
  const { lines, trailingNewline } = toLines(raw);
  const line = lines[lineIndex]!;
  const m = STATUS_VALUE_RE.exec(line);
  if (!m) {
    // Defensive/unreachable in practice: decomposeSection classified this exact line as the
    // status field via the SAME grammar (HEADER_LINE_RE on the trimmed line), so it always
    // matches here too. Fail closed rather than silently no-op if that ever drifts.
    throw new NoStatusHeaderError(`spliceStatusLine: status header line ${lineIndex + 1} ("${line}") did not re-match the expected "status: <value>" shape.`);
  }
  lines[lineIndex] = `${m[1]}${newStatus}${m[3]}`;
  return lines.join('\n') + (trailingNewline ? '\n' : '');
}

/** Thrown when a partially recognized, malformed header makes insertion ambiguous. */
export class NoAssigneeInsertionPointError extends Error {}

const ASSIGNEE_VALUE_RE = /^(\s*assignee\s*:\s*)(.*?)(\s*(?:\\)?\s*)$/i;

/** Rewrite, add, or remove one document item's `assignee:` header line.
 *
 *  - Existing line + non-null value: rewrite only its value, preserving casing and whitespace.
 *  - Existing line + null: remove only that line.
 *  - Missing line + non-null value: insert after an existing `status:` line, or create a clean
 *    one-field header at the section's deterministic heading/content boundary.
 *  - Missing line + null: byte-identical no-op.
 *
 *  A partially recognized header that was discarded by the parser still fails closed; inserting
 *  into that ambiguous shape could accidentally reclassify user prose as metadata. */
export function spliceAssigneeLine(raw: string, newAssignee: string | null): string {
  if (newAssignee !== null && (newAssignee.trim() !== newAssignee || newAssignee.includes('\n') || newAssignee.includes('\r') || newAssignee.length === 0)) {
    throw new Error('spliceAssigneeLine: assignee must be a non-empty, single-line value without leading or trailing whitespace.');
  }

  const decomposed = decomposeSection(raw);
  const assigneeLineIndex = decomposed.headerLineIndex.assignee;
  const { lines, trailingNewline } = toLines(raw);

  if (assigneeLineIndex !== undefined) {
    if (newAssignee === null) {
      lines.splice(assigneeLineIndex, 1);
      return lines.join('\n') + (trailingNewline ? '\n' : '');
    }
    const line = lines[assigneeLineIndex]!;
    const m = ASSIGNEE_VALUE_RE.exec(line);
    if (!m) {
      throw new Error(`spliceAssigneeLine: assignee header line ${assigneeLineIndex + 1} ("${line}") did not re-match the expected "assignee: <value>" shape.`);
    }
    lines[assigneeLineIndex] = `${m[1]}${newAssignee}${m[3]}`;
    return lines.join('\n') + (trailingNewline ? '\n' : '');
  }

  if (newAssignee === null) return raw;

  const statusLineIndex = decomposed.headerLineIndex.status;
  if (decomposed.header && statusLineIndex !== undefined) {
    lines.splice(statusLineIndex + 1, 0, `assignee: ${newAssignee}`);
    return lines.join('\n') + (trailingNewline ? '\n' : '');
  }

  if (decomposed.discardedHeaderLine !== undefined) {
    throw new NoAssigneeInsertionPointError(
      `spliceAssigneeLine: the section has a partially recognized header aborted by "${decomposed.discardedHeaderLine}"; refusing to insert into an ambiguous header.`,
    );
  }

  // No header exists. The parser's grammar deterministically skips the blank run immediately
  // after the heading and begins content at the first non-blank line. Insert a one-field header
  // plus its required blank terminator at that exact boundary; existing heading/body bytes remain
  // in the same order and candidate re-parse below proves the new presentation.
  let contentStart = 1;
  while (contentStart < lines.length && lines[contentStart] === '') contentStart++;
  lines.splice(contentStart, 0, `assignee: ${newAssignee}`, '');
  return lines.join('\n') + (trailingNewline ? '\n' : '');
}
