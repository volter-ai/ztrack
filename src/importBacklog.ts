// ZTB-14: `ztrack import` — materialize a freeform/mixed-markdown backlog into the strict
// document-source grammar (src/documentParser.ts), IN PLACE, idempotently. This module is the
// read-only planner + the in-place writer for ONE FILE; the multi-input driver (directory/glob
// expansion, batch-wide id allocation, --register) lives in src/importDriver.ts.
//
// GUARDRAIL: documentParser.ts / documentSource.ts / documentWriteBack.ts / check paths / preset
// parse functions are UNTOUCHED by this work order — this module is a separate front door that
// EMITS the existing grammar. It duplicates a few small, already-battle-tested regexes/helpers
// from documentParser.ts (the id-heading token shape, the own-direct-content boundary math)
// rather than importing them, since those are module-private and the guardrail forbids editing
// that file even to add an export.
//
// Toolchain: mdast-util-from-markdown + gfm, the SAME stack documentParser.ts/markdownDocument.ts
// use (package.json already depends on it) — reused here via `parseMarkdownDocument`
// (markdownDocument.ts, NOT itself guardrailed) for heading/section structure, plus one direct
// mdast walk (via `fromMarkdown`) for the two cases markdownDocument.ts doesn't expose: top-level
// (headingless) checkbox items, and locating fenced/indented code lines so checkbox/TODO
// detection never fires inside a code sample.
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { parseMarkdownDocument, type MarkdownDocument } from './markdownDocument.ts';

// ── shared grammar tokens (intentionally duplicated from documentParser.ts — see module note) ──

// Byte-identical to documentParser.ts's `ID_HEADING_RE` (kept in manual sync; that module is
// guardrailed off-limits for edits in this work order, including additive exports).
const ID_HEADING_RE = /^([A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9]+)\b\s*(?:[—·:]\s*)?(.*)$/;

// An AC line ALREADY carries a minted id iff its first token has the "prefix/NN" shape (the
// `dev/NN` convention used throughout this codebase and TRACK-B.md) — deliberately NARROWER than
// the preset's own `parseAcLine` (boilerplates/presets/simple-sdlc.ts:137-142), which treats ANY
// leading whitespace-delimited token as an "id" (so plain prose like "Add tests to the flow"
// parses with id="Add"). That permissiveness is fine for the preset (a human already wrote a
// deliberate AC line); it is NOT a safe signal for "is this checkbox already materialized" — this
// importer needs a token shape no ordinary English sentence produces. PINNED DECISION.
const AC_ID_TOKEN_RE = /^([A-Za-z][A-Za-z0-9-]*)\/([A-Za-z0-9]+)\b\s+(.*)$/;

// A top-level checkbox line, either bullet style, 0-3 leading spaces (CommonMark's own allowance
// before a line stops being a "top-level" list item and becomes an indented code block).
const CHECKBOX_LINE_RE = /^ {0,3}[-*+]\s+\[([ xX])\]\s+(.*)$/;
// A `TODO:` line, optionally already bulleted. Recognized ANYWHERE at top level in an issue's own
// content (not just inside a list) — Design point 1: "TODO:-prefixed lines -> planned ACs".
const TODO_LINE_RE = /^ {0,3}(?:[-*+]\s+)?TODO:\s*(.*)$/i;

const HEADER_LINE_RE = /^(title|status|assignee):\s*(.+)$/i;

function normalizeHeadingTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}
function isAcHeadingTitle(title: string): boolean {
  return normalizeHeadingTitle(title) === 'acceptance criteria';
}

// Mirrors documentParser.ts's `parseHeaderBlock` exactly (same abort-on-first-non-match
// semantics): does the file's preamble open with a valid `Title:`/`Status:`/`Assignee:` block?
// Only used to decide whether preamble prose is "already-canonical umbrella" (leave alone) or
// "unmappable, report it" (no Title: header to attach it to).
function hasTitleHeaderBlock(preamble: string): boolean {
  const lines = preamble.split('\n');
  for (const line of lines) {
    if (line.trim() === '') break;
    if (!HEADER_LINE_RE.exec(line.trim())) return false;
  }
  return /^title:/im.test(preamble);
}

// ── line-level code-block guard (checkbox/TODO detection must never fire inside a code sample) ─

function codeLineSet(text: string): Set<number> {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const codeLines = new Set<number>();
  const walk = (node: any): void => {
    if (node.type === 'code' && node.position) {
      for (let line = node.position.start.line as number; line <= (node.position.end.line as number); line++) codeLines.add(line);
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(tree);
  return codeLines;
}

// ── own-direct-content line-range math (verified against markdownDocument.ts's actual lineStart/
// lineEnd semantics — see the module-level comment in importBacklog.test.ts for the derivation) ──

function directChildIndices(doc: MarkdownDocument, parentIndex: number | null): number[] {
  return doc.sections.reduce<number[]>((acc, section, index) => {
    if (section.parentIndex === parentIndex) acc.push(index);
    return acc;
  }, []);
}

/** 0-based index of the first line of section `index`'s OWN content (i.e. right after its
 *  heading line). `index === null` means the document root (the preamble, before any heading). */
function ownContentStart(doc: MarkdownDocument, index: number | null): number {
  if (index === null) return 0;
  return doc.sections[index]!.lineStart; // heading line is at 0-based (lineStart-1); content starts next
}

/** 0-based EXCLUSIVE end of section `index`'s own content — i.e. "insert before this line" both
 *  to append at the end of the section's own content, and as the upper scan bound. A section's
 *  first child (if any) is ALWAYS `doc.sections[index+1]` (headings are stored in document order,
 *  and a heading immediately following one at a deeper level is that heading's child by
 *  construction — the same nearest-lower-preceding-heading rule documentParser.ts's
 *  `nearestIdBearingAncestor` walk relies on, just applied before ids exist). */
function ownContentEnd(doc: MarkdownDocument, index: number | null): number {
  if (index === null) return doc.sections.length ? doc.sections[0]!.lineStart - 1 : Infinity; // caller clamps
  const next = doc.sections[index + 1];
  if (next && next.level > doc.sections[index]!.level) return next.lineStart - 1;
  return doc.sections[index]!.lineEnd;
}

// ── id allocation ────────────────────────────────────────────────────────────────────────────

/** Batch-wide, single-pass issue-id allocator. Mirrors `MarkdownBackend`'s own minting rule
 *  (src/backends/markdownBackend.ts): the max numeric SUFFIX seen so far across every configured
 *  source (any prefix) plus one — NOT scoped per-prefix — so a fresh mint never collides with any
 *  id anywhere in the tracker, matching `issue create`'s existing behavior exactly. */
export class IdAllocator {
  private maxSuffix = 0;
  /** Record an existing id (from any source, or already present in a file being imported) so a
   *  later `next()` never collides with it. */
  note(id: string): void {
    const n = Number(id.split('-').pop());
    if (Number.isFinite(n) && n > this.maxSuffix) this.maxSuffix = n;
  }
  next(prefix: string): string {
    this.maxSuffix += 1;
    return `${prefix}-${this.maxSuffix}`;
  }
}

// ── plan/materialize result shapes ──────────────────────────────────────────────────────────

export interface PlannedAc {
  /** 'existing' ACs are never itemized with a `text` (untouched, not our business); 'minted'
   *  covers both a brand-new AC and an already-existing-AC-section item that merely gained an id. */
  status: 'minted';
  id: string;
  text: string;
  wasPreChecked: boolean;
}

export interface PlannedIssue {
  status: 'existing' | 'minted';
  id: string;
  /** Title as it will read after materialization (unchanged for 'existing'). */
  title: string;
  parentId: string | null;
  acs: PlannedAc[];
  existingAcCount: number;
}

export interface UnmappedNote {
  line: number;
  excerpt: string;
  reason: string;
}

export interface ImportPlan {
  filePath: string;
  prefixUsed: string;
  /** Document order. */
  issues: PlannedIssue[];
  isNoop: boolean;
  unmapped: UnmappedNote[];
  preChecked: Array<{ issueId: string; acId: string; text: string }>;
}

export interface ImportResult {
  plan: ImportPlan;
  materialized: string;
}

/** Every id already present in `text`'s headings (excluding a recognized AC heading, which is
 *  never id-bearing). Used by importDriver.ts as a mandatory PRE-PASS over an entire batch —
 *  `planAndMaterialize` only notes a file's own existing ids into the allocator as it classifies
 *  THAT file, which is too late to protect an EARLIER file's minting in the same batch from
 *  colliding with a LATER file's pre-existing id; scanning every file's existing ids up front,
 *  before any file mints anything, is what actually makes the batch collision-safe. */
export function existingIdsInFile(text: string): string[] {
  if (text.includes('\r')) return []; // let the real pass throw the CRLF error; this is a scan only
  const doc = parseMarkdownDocument(text);
  const ids: string[] = [];
  for (const section of doc.sections) {
    if (isAcHeadingTitle(section.title)) continue;
    const m = ID_HEADING_RE.exec(section.title);
    if (m) ids.push(m[1]!);
  }
  return ids;
}

export function assertNoCrlf(text: string, filePath: string): void {
  if (text.includes('\r')) {
    throw new Error(
      `ztrack import: '${filePath}' contains CRLF line endings; the importer (like document-source ` +
      'write-back) only supports LF files, since inserted id tokens/AC scaffolding are positioned by ' +
      'line — convert the file to LF line endings and retry.',
    );
  }
}

type Edit =
  | { at: number; kind: 'replace'; text: string }
  | { at: number; kind: 'delete' }
  | { at: number; kind: 'insertBefore'; lines: string[] };

function applyEdits(lines: readonly string[], edits: readonly Edit[]): string[] {
  const byIndex = new Map<number, Edit[]>();
  for (const e of edits) {
    const arr = byIndex.get(e.at) ?? [];
    arr.push(e);
    byIndex.set(e.at, arr);
  }
  const out: string[] = [];
  for (let i = 0; i <= lines.length; i++) {
    for (const e of byIndex.get(i) ?? []) {
      if (e.kind === 'insertBefore') out.push(...e.lines);
    }
    if (i === lines.length) break;
    const here = byIndex.get(i) ?? [];
    if (here.some((e) => e.kind === 'delete')) continue;
    const replace = here.find((e): e is Extract<Edit, { kind: 'replace' }> => e.kind === 'replace');
    out.push(replace ? replace.text : lines[i]!);
  }
  return out;
}

/** Relocating a checklist/TODO run out of an issue's own body leaves behind the blank line(s)
 *  that used to separate it from surrounding prose. Group the relocated (non-in-place) candidates
 *  into contiguous runs (adjacent lines, or separated only by blank lines) and delete every
 *  bounding blank line (leading and trailing, when present) so nothing is left void where the
 *  run used to be — the insertion side (below) is responsible for supplying whatever fresh
 *  separator the relocated content needs at its NEW location. Scoped to `[ownStart, ownEnd)` so
 *  it never reaches into a sibling/child section's own content. */
function blankCleanupEdits(lines: readonly string[], candidates: readonly AcCandidate[], ownStart: number, ownEnd: number): Edit[] {
  const relocatedLineSet = new Set(candidates.filter((c) => !c.inPlaceInAc).map((c) => c.line));
  const relocated = [...relocatedLineSet].sort((a, b) => a - b);
  const edits: Edit[] = [];
  let runStart = -1;
  let runEnd = -1;
  const flush = () => {
    if (runStart === -1) return;
    // Every blank line STRICTLY INSIDE the run (between merged candidates) is a now-orphaned
    // separator that used to sit between two relocated items — remove it too, not just the
    // candidate lines themselves (else it survives as a stray blank in the middle of nothing).
    for (let j = runStart + 1; j < runEnd; j++) {
      if (!relocatedLineSet.has(j) && lines[j] === '') edits.push({ at: j, kind: 'delete' });
    }
    if (runEnd + 1 < ownEnd && lines[runEnd + 1] === '') edits.push({ at: runEnd + 1, kind: 'delete' });
    if (runStart - 1 >= ownStart && lines[runStart - 1] === '') edits.push({ at: runStart - 1, kind: 'delete' });
  };
  for (const line of relocated) {
    if (runStart === -1) { runStart = line; runEnd = line; continue; }
    const onlyBlanksBetween = lines.slice(runEnd + 1, line).every((l) => l === '');
    if (onlyBlanksBetween) { runEnd = line; continue; }
    flush();
    runStart = line; runEnd = line;
  }
  flush();
  return edits;
}

function insertIdIntoHeadingLine(line: string, mintedId: string): string {
  const m = /^(#{1,6}\s+)(.*)$/.exec(line);
  if (!m) return line; // defensive; every section's heading line is ATX by construction here
  return `${m[1]}${mintedId}${m[2] ? ` ${m[2]}` : ''}`;
}

const PRE_CHECKED_MARKER = ' (imported: previously marked done — needs evidence)';

interface AcCandidate {
  line: number; // 0-based, original file
  text: string;
  wasChecked: boolean;
  /** Present for a checkbox already inside a recognized AC section that merely lacks an id — it's
   *  edited IN PLACE (pure insertion), never relocated. Absent for one relocated from elsewhere in
   *  the issue's own body into the AC section. */
  inPlaceInAc: boolean;
}

/** Scan `lines[start, end)` for top-level checkbox / `TODO:` items (skipping any line the code
 *  guard marks as inside a fenced/indented code block). `inAc` tags every result's `inPlaceInAc`. */
function scanAcCandidates(lines: readonly string[], start: number, end: number, codeLines: Set<number>, inAc: boolean): AcCandidate[] {
  const out: AcCandidate[] = [];
  for (let j = Math.max(0, start); j < Math.min(end, lines.length); j++) {
    if (codeLines.has(j + 1)) continue;
    const line = lines[j]!;
    const cb = CHECKBOX_LINE_RE.exec(line);
    if (cb) { out.push({ line: j, text: cb[2]!, wasChecked: /x/i.test(cb[1]!), inPlaceInAc: inAc }); continue; }
    const todo = TODO_LINE_RE.exec(line);
    if (todo) out.push({ line: j, text: todo[1]!, wasChecked: false, inPlaceInAc: inAc });
  }
  return out;
}

/** Plan (and materialize) ONE file's import. Throws on CRLF input. `opts.prefix` is the resolved
 *  issue-id prefix (see importDriver.ts for how it's inferred); `opts.allocator` is shared across
 *  a whole import batch for collision-safe, single-pass numbering. */
export function planAndMaterialize(text: string, filePath: string, opts: { prefix: string; allocator: IdAllocator }): ImportResult {
  assertNoCrlf(text, filePath);
  const { prefix, allocator } = opts;
  const doc = parseMarkdownDocument(text);
  const lines = text.split('\n');
  const codeLines = codeLineSet(text);

  // First pass: note every id already present (this file's own existing ids) so the allocator
  // never mints a collision even before scanning other batch/config sources (importDriver.ts
  // seeds the SAME allocator with those before calling in). Also classify every section.
  const idOf = new Map<number, string>(); // section index -> existing id (only for id-bearing ones)
  for (const [index, section] of doc.sections.entries()) {
    if (isAcHeadingTitle(section.title)) continue;
    const m = ID_HEADING_RE.exec(section.title);
    if (m) { idOf.set(index, m[1]!); allocator.note(m[1]!); }
  }

  const issues: PlannedIssue[] = [];
  const unmapped: UnmappedNote[] = [];
  const preChecked: Array<{ issueId: string; acId: string; text: string }> = [];
  const edits: Edit[] = [];

  function nearestSubjectAncestorId(index: number): string | null {
    let p = doc.sections[index]!.parentIndex;
    while (p !== null) {
      if (!isAcHeadingTitle(doc.sections[p]!.title)) return idOf.get(p) ?? null;
      p = doc.sections[p]!.parentIndex;
    }
    return null;
  }

  for (const [index, section] of doc.sections.entries()) {
    if (isAcHeadingTitle(section.title)) continue; // handled as part of its parent, below

    const existingId = idOf.get(index);
    const id = existingId ?? allocator.next(prefix);
    if (!existingId) {
      idOf.set(index, id); // so a later CHILD section (processed after, document order) resolves its parent
      edits.push({ at: section.lineStart - 1, kind: 'replace', text: insertIdIntoHeadingLine(lines[section.lineStart - 1]!, id) });
    }

    const children = directChildIndices(doc, index);
    const acChildIndex = children.find((i) => isAcHeadingTitle(doc.sections[i]!.title)) ?? null;

    // Own-content candidates (checkboxes/TODOs OUTSIDE any recognized AC section) -> relocate.
    const ownStart = ownContentStart(doc, index);
    const ownEnd = ownContentEnd(doc, index);
    const outside = scanAcCandidates(lines, ownStart, ownEnd, codeLines, false);

    // Existing AC section's own checkbox items: those with an id stay untouched; those without
    // get one minted IN PLACE.
    let acExistingMaxNum = 0;
    let acExistingWidth = 2;
    let acPrefix = 'dev';
    const inPlace: AcCandidate[] = [];
    if (acChildIndex !== null) {
      const acStart = ownContentStart(doc, acChildIndex);
      const acEnd = ownContentEnd(doc, acChildIndex);
      for (let j = acStart; j < acEnd; j++) {
        if (codeLines.has(j + 1)) continue;
        const cb = CHECKBOX_LINE_RE.exec(lines[j]!);
        if (!cb) continue;
        const already = AC_ID_TOKEN_RE.exec(cb[2]!);
        if (already) {
          acPrefix = already[1]!;
          const num = Number(already[2]);
          if (Number.isFinite(num)) {
            acExistingWidth = Math.max(acExistingWidth, already[2]!.length);
            acExistingMaxNum = Math.max(acExistingMaxNum, num);
          }
          continue;
        }
        inPlace.push({ line: j, text: cb[2]!, wasChecked: /x/i.test(cb[1]!), inPlaceInAc: true });
      }
    }

    const toMint = [...inPlace, ...outside].sort((a, b) => a.line - b.line);
    const acs: PlannedAc[] = [];
    let nextAcNum = acExistingMaxNum + 1;
    const relocatedLines: string[] = [];
    for (const cand of toMint) {
      const acId = `${acPrefix}/${String(nextAcNum++).padStart(acExistingWidth, '0')}`;
      const marker = cand.wasChecked ? PRE_CHECKED_MARKER : '';
      const acText = `${cand.text}${marker}`;
      acs.push({ status: 'minted', id: acId, text: acText, wasPreChecked: cand.wasChecked });
      if (cand.wasChecked) preChecked.push({ issueId: id, acId, text: cand.text });
      if (cand.inPlaceInAc) {
        edits.push({ at: cand.line, kind: 'replace', text: `- [ ] ${acId} v1 ${acText}` });
      } else {
        edits.push({ at: cand.line, kind: 'delete' });
        relocatedLines.push(`- [ ] ${acId} v1 ${acText}`);
      }
    }

    if (outside.length) edits.push(...blankCleanupEdits(lines, toMint, ownStart, ownEnd));

    if (relocatedLines.length) {
      if (acChildIndex !== null) {
        edits.push({ at: ownContentEnd(doc, acChildIndex), kind: 'insertBefore', lines: relocatedLines });
      } else {
        const level = Math.min(section.level + 1, 6);
        edits.push({
          at: ownContentEnd(doc, index),
          kind: 'insertBefore',
          lines: ['', `${'#'.repeat(level)} Acceptance Criteria`, '', ...relocatedLines, ''],
        });
      }
    }

    issues.push({
      status: existingId ? 'existing' : 'minted',
      id, title: existingId ? section.title.replace(ID_HEADING_RE, '$2').trim() || section.title : section.title,
      parentId: nearestSubjectAncestorId(index),
      acs,
      existingAcCount: acExistingMaxNum,
    });
  }

  // Root-level content: either the (headingless) pure-checklist case, or preamble sanity when the
  // file DOES have headings.
  if (doc.sections.length === 0) {
    // Headingless file. Top-level checkbox items promote to issues (their own text becomes the
    // minted heading, converting the bullet line itself); their nested checkboxes become that
    // issue's ACs, minted in place (no relocation needed — they're already contiguous under their
    // parent bullet). PINNED DECISION: this is the one shape where a line is REWRITTEN rather
    // than purely inserted-into — otherwise the ex-checkbox text would linger as a loose
    // `ac_outside_section` item right under its own new heading.
    const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    const topList: any = (tree.children ?? []).find((n: any) => n.type === 'list');
    const topItems: any[] = topList?.children ?? [];
    if (topItems.length === 0 && text.trim() !== '') {
      unmapped.push({ line: 1, excerpt: lines[0]?.slice(0, 60) ?? '', reason: 'no heading, checkbox, or TODO: item found — nothing importable' });
    }
    for (const item of topItems) {
      if (typeof item.checked !== 'boolean') continue; // a plain (non-checkbox) top-level bullet: leave in place
      const itemStartLine = (item.position.start.line as number) - 1; // 0-based
      const nestedList = (item.children ?? []).find((c: any) => c.type === 'list');
      const ownEndLine = nestedList ? (nestedList.position.start.line as number) - 1 : (item.position.end.line as number);
      const headText = lines.slice(itemStartLine, ownEndLine).join('\n')
        .replace(/^ {0,3}[-*+]\s+\[[ xX]\]\s+/, '').trimEnd();
      const mintedId = allocator.next(prefix);
      const acs: PlannedAc[] = [];
      const mintedSubs: number[] = [];
      if (nestedList) {
        let n = 1;
        for (const sub of nestedList.children ?? []) {
          if (typeof sub.checked !== 'boolean') continue;
          const subLine = (sub.position.start.line as number) - 1;
          const cb = CHECKBOX_LINE_RE.exec(lines[subLine]!);
          if (!cb) continue;
          const already = AC_ID_TOKEN_RE.exec(cb[2]!);
          if (already) continue; // already materialized — leave untouched
          const acId = `dev/${String(n++).padStart(2, '0')}`;
          const subChecked = /x/i.test(cb[1]!);
          const marker = subChecked ? PRE_CHECKED_MARKER : '';
          const acText = `${cb[2]}${marker}`;
          acs.push({ status: 'minted', id: acId, text: acText, wasPreChecked: subChecked });
          if (subChecked) preChecked.push({ issueId: mintedId, acId, text: cb[2]! });
          edits.push({ at: subLine, kind: 'replace', text: `- [ ] ${acId} v1 ${acText}` });
          mintedSubs.push(subLine);
        }
      }
      if (mintedSubs.length) {
        edits.push({ at: mintedSubs[0]!, kind: 'insertBefore', lines: ['', '### Acceptance Criteria', ''] });
        const afterLast = mintedSubs[mintedSubs.length - 1]! + 1;
        if (lines[afterLast] !== '' && lines[afterLast] !== undefined) edits.push({ at: afterLast, kind: 'insertBefore', lines: [''] });
      }
      // An issue has no "checked" concept (unlike an AC) — a checked top-level item is promoted to
      // a plain issue heading with no claim/marker; only its NESTED checkboxes (real ACs) are
      // subject to the pre-checked policy above.
      issues.push({ status: 'minted', id: mintedId, title: headText, parentId: null, acs, existingAcCount: 0 });
      edits.push({ at: itemStartLine, kind: 'replace', text: `## ${mintedId} ${headText}` });
    }
  } else if (!hasTitleHeaderBlock(doc.preamble) && doc.preamble.trim() !== '') {
    unmapped.push({ line: 1, excerpt: doc.preamble.trim().slice(0, 60), reason: 'preamble text before the first heading has no `Title:` header to attach it to an issue' });
  }

  const materializedLines = applyEdits(lines, edits);
  const materialized = materializedLines.join('\n');

  const plan: ImportPlan = {
    filePath, prefixUsed: prefix, issues, unmapped, preChecked,
    isNoop: materialized === text,
  };
  return { plan, materialized };
}
