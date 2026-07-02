// ZTB-4 dev/09: document-source write-back — the splice that turns a `DocumentSource`'s spans
// (dev/08) into a real write path. Two grammar-free primitives live here, independent of
// documentParser.ts's id-heading grammar and of any preset:
//
//   shiftHeadings(text, delta)   — renumber every ATX heading INSIDE `text` by `delta` levels
//                                  (a fenced-code `## fake` is never touched; a level pushed
//                                  outside [1,6], or a setext heading in the way, throws).
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
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

// ── shiftHeadings ────────────────────────────────────────────────────────────────────────────

/** Thrown by `shiftHeadings` when it finds a heading it cannot safely renumber: a SETEXT heading
 *  (`Title\n===`/`Title\n---` — no `#` run to adjust; converting it to ATX risks corrupting text
 *  that merely looked like an underline, e.g. a thematic break glued to a preceding paragraph) or
 *  an ATX heading whose shifted level would leave the valid `#`-run range [1,6]. Callers treat
 *  this as "this item cannot be safely spliced" rather than attempting a lossy rewrite. */
export class HeadingShiftError extends Error {}

const ATX_LINE_RE = /^(#{1,6})(\s.*|)$/;

/** Renumber every REAL ATX heading (mdast/CommonMark heading detection — a `#` inside a fenced or
 *  indented code block is not a heading) inside `text` by `delta` levels, leaving everything else
 *  byte-identical. `delta === 0` is still validated (still throws on a setext heading) so a
 *  caller that relies on "shiftHeadings succeeded" as a writability signal gets it even when the
 *  shift is a no-op (an L=1 document item, whose read/write shift delta is 0). */
export function shiftHeadings(text: string, delta: number): string {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const lines = text.split('\n');
  const edits: Array<{ lineIndex: number; hashes: string; rest: string }> = [];
  const walk = (node: unknown): void => {
    const n = node as { type?: string; position?: { start: { line: number } }; children?: unknown[] };
    if (n.type === 'heading' && n.position) {
      const lineIndex = n.position.start.line - 1; // mdast lines are 1-based
      const raw = lines[lineIndex] ?? '';
      const atx = ATX_LINE_RE.exec(raw);
      if (!atx) {
        throw new HeadingShiftError(
          `shiftHeadings: line ${lineIndex + 1} ("${raw}") is a setext heading (Title\\n===/---), which cannot be ` +
          'renumbered without risking corruption of surrounding text; the item this belongs to is not splice-writable.',
        );
      }
      edits.push({ lineIndex, hashes: atx[1]!, rest: atx[2] ?? '' });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  for (const edit of edits) {
    const newLevel = edit.hashes.length + delta;
    if (newLevel < 1 || newLevel > 6) {
      throw new HeadingShiftError(
        `shiftHeadings: line ${edit.lineIndex + 1} would shift from level ${edit.hashes.length} to ${newLevel}, outside the valid [1,6] range.`,
      );
    }
    lines[edit.lineIndex] = `${'#'.repeat(newLevel)}${edit.rest}`;
  }
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
  let prefixEnd = skipStart;
  {
    let idx = skipStart;
    const meta: Record<string, string> = {};
    let aborted = false;
    for (; idx < lines.length; idx++) {
      const line = lines[idx]!;
      if (line.trim() === '') { idx++; break; }
      const m = HEADER_LINE_RE.exec(line.trim());
      if (!m) { aborted = true; break; }
      meta[m[1]!.toLowerCase()] = m[2]!.trim();
    }
    if (!aborted && Object.keys(meta).length > 0) {
      header = meta;
      prefixEnd = idx;
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

  return { headingLineRaw, prefixRaw, middle, suffixBlanks, header };
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
