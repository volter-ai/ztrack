// ZTB-4 dev/08: `format: "document"` source parsing — turns one markdown FILE into MANY issues.
// This module still only PARSES (dev/09's write-back splice lives in documentSource.ts /
// documentWriteBack.ts, layered on top of the `level`/`raw` fields below). Every section whose
// heading starts with an ID TOKEN becomes an issue; heading nesting between id-bearing sections
// becomes parent/children links; a leading `Title:` header block (fileToRecord/loose-mode
// semantics — src/check.ts) makes the file itself an umbrella issue owning the top-level
// id-bearing sections as children.
//
// This module invents NO new markdown syntax — "a heading that starts with an id token" is the
// whole grammar (no marker, no frontmatter). It consumes markdownDocument.ts's already-solved
// heading hierarchy/spans (level, parentIndex, body, raw, lineStart/lineEnd) rather than
// reimplementing heading detection or span math.
import { basename } from 'node:path';
import { parseMarkdownDocument, type MarkdownDocument, type MarkdownSection } from './markdownDocument.ts';

// An id token is a hyphenated alnum token ("ZTB-4", "ZL-A5", "APP-12") — the same shape ids
// already have elsewhere (see markdownBackend.ts's `SAFE_ID`, a superset). After the token, an
// OPTIONAL separator (em dash, middot, or colon, each optionally surrounded by whitespace) or
// just whitespace precedes the title remainder; nothing past the separator is interpreted further
// — `## ZL-A5 · P0 · title` yields title `"P0 · title"` verbatim, not a parsed priority field.
const ID_HEADING_RE = /^([A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9]+)\b\s*(?:[—·:]\s*)?(.*)$/;

// Mirrors src/check.ts's `HEADER_LINE`/`fileToRecord` header-block scan exactly (same regex, same
// abort-on-first-non-match semantics) but applied only to the document's PREAMBLE (the text before
// the first heading — markdownDocument.ts already isolates it), since a document source's content
// proper starts at its first heading.
const HEADER_LINE = /^(title|status|assignee):\s*(.+)$/i;

export interface DocumentParsedIssue {
  id: string;
  title: string;
  body: string;
  parent: string | null;
  children: string[];
  /** Absent for the umbrella issue (mirrors fileToRecord's loose-mode "whole file, no span"). */
  lineStart?: number;
  lineEnd?: number;
  /** ZTB-4 dev/09 (additive — read path, src/documentParser.test.ts, is unchanged by these two
   *  fields): the heading's level, and the section's raw text (heading + full subtree) BEFORE any
   *  id-bearing-descendant excision — i.e. `doc.sections[index].raw`. `raw === body` iff nothing
   *  was excised (the common case); DocumentSource.write uses that equality as its span-writable
   *  gate. Both absent for the umbrella issue (no single section backs it). */
  level?: number;
  raw?: string;
  /** UMBRELLA ONLY (ZTB-4 dev/10): the `Status:`/`Assignee:` lines of the file's `Title:` header
   *  block, exactly as fileToRecord (src/check.ts) would read them. Regular items carry their own
   *  `status:`/`assignee:` header block INSIDE their section instead (decomposed by
   *  documentWriteBack.ts, not here), so these stay unset for them — one source of truth each. */
  status?: string;
  assignee?: string;
}

function directChildIndices(doc: MarkdownDocument, parentIndex: number | null): number[] {
  return doc.sections.reduce<number[]>((acc, section, index) => {
    if (section.parentIndex === parentIndex) acc.push(index);
    return acc;
  }, []);
}

// A section's OWN leading content (before its first direct child heading). `section.body` already
// spans the WHOLE subtree (markdownDocument.ts's body = everything through the next same-or-lower
// heading), and direct children's `raw` tile it contiguously right after the own leading text —
// a structural guarantee of the same next-heading walk — so subtracting their combined raw length
// off the end recovers exactly the own portion, byte-for-byte.
function ownDirectBody(doc: MarkdownDocument, index: number): string {
  const section = doc.sections[index]!;
  const childrenRawLen = directChildIndices(doc, index).reduce((sum, i) => sum + (doc.sections[i]!.raw?.length ?? 0), 0);
  return section.body.slice(0, section.body.length - childrenRawLen);
}

function hasIdBearingDescendant(doc: MarkdownDocument, index: number, isIdBearing: (i: number) => boolean): boolean {
  return directChildIndices(doc, index).some((i) => isIdBearing(i) || hasIdBearingDescendant(doc, i, isIdBearing));
}

// Reconstructs an ATX heading line from level+title. Used ONLY on the rare slow path below (a
// non-id-bearing section that must be partially rewritten because an id-bearing descendant several
// levels down needs excising) — may not byte-match unusual original spacing/setext form. The
// common path (no id-bearing descendant anywhere below) never calls this; it returns `raw`
// untouched instead.
function headingLine(section: MarkdownSection): string {
  return `${'#'.repeat(section.level)} ${section.title}`;
}

// The text of section `index`'s subtree (heading + content) with every id-bearing DESCENDANT's
// subtree excised — recursively, so a non-id-bearing section nested under an excised ancestor is
// still handled. Byte-identical to `section.raw` in the overwhelmingly common case (no id-bearing
// descendant at all — e.g. a `### Context`/`### Steps` or `## Acceptance Criteria` subsection),
// since that's then a straight pass-through of the already-correct span.
function subtreeExcisingIdBearing(doc: MarkdownDocument, index: number, isIdBearing: (i: number) => boolean): string {
  const section = doc.sections[index]!;
  const children = directChildIndices(doc, index);
  if (!children.some((i) => isIdBearing(i) || hasIdBearingDescendant(doc, i, isIdBearing))) return section.raw ?? '';
  let out = `${headingLine(section)}\n${ownDirectBody(doc, index)}`;
  for (const i of children) {
    if (isIdBearing(i)) continue; // becomes its own issue elsewhere — excised from this body
    out += subtreeExcisingIdBearing(doc, i, isIdBearing);
  }
  return out;
}

function parseHeaderBlock(preamble: string): { title?: string; status?: string; assignee?: string; headerLineCount: number } {
  const lines = preamble.split('\n');
  const meta: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; break; }
    const m = HEADER_LINE.exec(line.trim());
    if (!m) { i = 0; break; } // not a header block after all — nothing consumed
    meta[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  // status/assignee ride along with title: fileToRecord (src/check.ts) — which this scan
  // deliberately mirrors — USES all three; dropping two of them left the umbrella issue
  // permanently unassigned/draft even when the header block says otherwise (ZTB-4 dev/10 fix).
  return { title: meta.title, status: meta.status, assignee: meta.assignee, headerLineCount: i };
}

// The umbrella issue's own text: the preamble AFTER the consumed header-block lines (mirrors
// fileToRecord's `body` derivation), plus every top-level NON-id-bearing section folded in the
// same way an id-bearing item's own non-id-bearing subsections are (AC subsections, etc.) — a
// direct generalization of `subtreeExcisingIdBearing` to the document's virtual root.
function umbrellaBody(doc: MarkdownDocument, headerLineCount: number, isIdBearing: (i: number) => boolean): string {
  const preambleLines = doc.preamble.split('\n');
  let out = preambleLines.slice(headerLineCount).join('\n').replace(/^\n+/, '');
  for (const i of directChildIndices(doc, null)) {
    if (isIdBearing(i)) continue;
    out += subtreeExcisingIdBearing(doc, i, isIdBearing);
  }
  return out;
}

/** Parse one document source's text into its issue tree. `filePath` is used only for the
 *  umbrella issue's id (mirrors `fileToRecord`'s `basename(path).replace(/\.[^.]+$/, '')`). */
export function parseMarkdownDocumentSource(text: string, filePath: string): DocumentParsedIssue[] {
  const doc = parseMarkdownDocument(text);

  const idBearing = new Map<number, { id: string; title: string }>();
  doc.sections.forEach((section, index) => {
    const m = ID_HEADING_RE.exec(section.title);
    if (m) idBearing.set(index, { id: m[1]!, title: (m[2] ?? '').trim() });
  });
  const isIdBearing = (i: number): boolean => idBearing.has(i);

  // Nearest id-bearing ancestor by walking the `parentIndex` chain — heading nesting between
  // id-bearing sections becomes the parent link.
  function nearestIdBearingAncestor(index: number): number | null {
    let p = doc.sections[index]!.parentIndex;
    while (p !== null) {
      if (isIdBearing(p)) return p;
      p = doc.sections[p]!.parentIndex;
    }
    return null;
  }

  const header = parseHeaderBlock(doc.preamble);
  const umbrellaId = header.title !== undefined ? basename(filePath).replace(/\.[^.]+$/, '') : null;

  const childrenOf = new Map<string, string[]>();
  const addChild = (parentId: string, childId: string): void => {
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), childId]);
  };

  const issues: DocumentParsedIssue[] = [];
  for (const [index, { id, title }] of idBearing) {
    const ancestorIndex = nearestIdBearingAncestor(index);
    const parentId = ancestorIndex !== null ? idBearing.get(ancestorIndex)!.id : umbrellaId;
    if (parentId) addChild(parentId, id);
    const section = doc.sections[index]!;
    issues.push({
      id, title, parent: parentId, children: [], // children filled below, once every parent is known
      body: subtreeExcisingIdBearing(doc, index, isIdBearing),
      lineStart: section.lineStart, lineEnd: section.lineEnd,
      level: section.level, raw: section.raw,
    });
  }

  if (umbrellaId) {
    issues.push({
      id: umbrellaId, title: header.title || umbrellaId, parent: null, children: [],
      body: umbrellaBody(doc, header.headerLineCount, isIdBearing),
      ...(header.status !== undefined ? { status: header.status } : {}),
      ...(header.assignee !== undefined ? { assignee: header.assignee } : {}),
      // No line span — the umbrella IS the file (mirrors fileToRecord's loose-mode "whole file,
      // no span" origin for a file with no backend columns).
    });
  }

  for (const issue of issues) issue.children = childrenOf.get(issue.id) ?? [];
  return issues;
}
