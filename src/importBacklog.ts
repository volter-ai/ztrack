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
import { IdAllocator } from './idAllocator.ts';

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

// The batch-wide, single-pass issue-id allocator now lives in its own module (idAllocator.ts) —
// it's the ONE shared implementation `backends/markdownBackend.ts`'s `issue create` handler also
// calls, so the two mints can't drift apart. Re-exported here (this module's existing public
// name) so every current `import { IdAllocator } from './importBacklog.ts'` site is unaffected.
export { IdAllocator };

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
const MULTILINE_ITEM_REASON = 'multi-line checkbox item — move it into the Acceptance Criteria section manually (only single-line items are auto-promoted)';
const MULTILINE_TODO_REASON = 'multi-line TODO: item — move it into the Acceptance Criteria section manually (only single-line items are auto-promoted)';

interface AcCandidate {
  line: number; // 0-based, original file
  text: string;
  wasChecked: boolean;
  /** Present for a checkbox already inside a recognized AC section that merely lacks an id — it's
   *  edited IN PLACE (pure insertion), never relocated. Absent for one relocated from elsewhere in
   *  the issue's own body into the AC section. */
  inPlaceInAc: boolean;
}

// ── multi-line checkbox items are NEVER relocated (work-order rule: "when in doubt, leave content
// in place and report rather than transform") ──────────────────────────────────────────────────
//
// The candidate scan below is line-based; relocating only a checkbox's FIRST line would orphan
// its continuation lines / non-checkbox children in place, scrambling the document. So every
// checkbox listItem is measured via its mdast position span, and any item whose full span is not
// entirely composed of single-line checkbox items is FROZEN: none of its lines are relocated, and
// the topmost frozen item is NAMED in the unmapped report.

interface CheckboxItemSpan {
  /** 0-based line of the item's `- [ ]` marker line. */
  start: number;
  /** 0-based last line of the item's ENTIRE span (nested lists included). */
  end: number;
  /** 0-based last line of the item's OWN text (before its first nested list). */
  ownEnd: number;
  checked: boolean;
  /** 0 = an item of a root-level list; +1 per nesting level. */
  depth: number;
}

function collectCheckboxItems(text: string): CheckboxItemSpan[] {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const items: CheckboxItemSpan[] = [];
  const walk = (node: any, depth: number): void => {
    if (node.type === 'listItem' && typeof node.checked === 'boolean' && node.position) {
      const firstNested = (node.children ?? []).find((c: any) => c.type === 'list' && c.position);
      items.push({
        start: (node.position.start.line as number) - 1,
        end: (node.position.end.line as number) - 1,
        ownEnd: (firstNested ? (firstNested.position.start.line as number) - 1 : (node.position.end.line as number)) - 1,
        checked: node.checked === true,
        depth,
      });
    }
    const nextDepth = node.type === 'listItem' ? depth + 1 : depth;
    for (const c of node.children ?? []) walk(c, nextDepth);
  };
  walk(tree, 0);
  return items;
}

interface RelocationSafety {
  /** Every 0-based line belonging to a NOT-relocatable checkbox item's span — the scan skips them. */
  frozen: Set<number>;
  /** The topmost frozen items' start lines (not contained in another frozen item) — each gets ONE
   *  unmapped report entry when the scan reaches it. */
  frozenTopStarts: Set<number>;
}

/** A bare `TODO: …` paragraph's mdast span (0-based lines). Collected the same way
 *  `collectCheckboxItems` collects checkbox listItems — a `TODO:` line with an unindented,
 *  non-blank continuation folds (CommonMark lazy continuation) into the SAME `paragraph` node, so
 *  its position span already exposes the "does this item have more than one line" shape. */
interface TodoParagraphSpan {
  start: number;
  end: number;
}

function collectTodoParagraphs(text: string, lines: readonly string[]): TodoParagraphSpan[] {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const items: TodoParagraphSpan[] = [];
  const walk = (node: any): void => {
    if (node.type === 'paragraph' && node.position) {
      const start = (node.position.start.line as number) - 1;
      const end = (node.position.end.line as number) - 1;
      if (TODO_LINE_RE.test(lines[start] ?? '')) items.push({ start, end });
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(tree);
  return items;
}

/** An item is relocatable iff every line of its span BEYOND its own first line is accounted for:
 *  blank, the first line of a single-own-line checkbox item (relocated as its own candidate), or
 *  a `TODO:` line (mdast folds an unindented `TODO: …` directly under a checkbox into that item's
 *  paragraph as a lazy continuation, but the scan relocates it as its own independent candidate —
 *  nothing is orphaned). Anything else — a plain prose continuation line, a non-checkbox child —
 *  makes the item (and, via this same flat line check, every ancestor) frozen.
 *
 *  ZTB-16 dev/02: the SAME rule applies to a bare `TODO:` paragraph's own continuation lines. Only
 *  the paragraph's first line matched `TODO_LINE_RE` and relocated — an indented prose
 *  continuation line right under it (no blank line, so mdast folds it into the same paragraph) is
 *  neither a checkbox nor another `TODO:` line, so it was left behind, orphaned, when the first
 *  line moved. Freezing the WHOLE paragraph (mirroring the checkbox-item rule: "when in doubt,
 *  leave content in place and report") keeps the two in the same unit — either both relocate
 *  (single-line TODO, unchanged behavior) or both stay put and get named in the report. */
function relocationSafety(
  items: readonly CheckboxItemSpan[],
  todoParagraphs: readonly TodoParagraphSpan[],
  lines: readonly string[],
): RelocationSafety {
  const candidateStarts = new Set(items.filter((i) => i.ownEnd === i.start).map((i) => i.start));
  const covered = (l: number): boolean => {
    const line = lines[l] ?? '';
    return line.trim() === '' || candidateStarts.has(l) || TODO_LINE_RE.test(line);
  };
  const spanUnsafe = (start: number, end: number): boolean => {
    for (let l = start + 1; l <= end; l++) {
      if (!covered(l)) return true;
    }
    return false;
  };
  const unsafe = items.filter((item) => spanUnsafe(item.start, item.end));
  const unsafeTodo = todoParagraphs.filter((p) => spanUnsafe(p.start, p.end));
  const frozen = new Set<number>();
  for (const item of unsafe) for (let l = item.start; l <= item.end; l++) frozen.add(l);
  const frozenTopStarts = new Set<number>();
  for (const item of unsafe) {
    const contained = unsafe.some((o) => o !== item && o.start <= item.start && o.end >= item.end && (o.start < item.start || o.end > item.end));
    if (!contained) frozenTopStarts.add(item.start);
  }
  for (const p of unsafeTodo) {
    // A TODO paragraph fully inside an already-frozen checkbox span gets ONE report (the
    // checkbox's), not a second one for the paragraph nested inside it.
    const containedInFrozenCheckbox = unsafe.some((o) => o.start <= p.start && o.end >= p.end);
    for (let l = p.start; l <= p.end; l++) frozen.add(l);
    if (!containedInFrozenCheckbox) frozenTopStarts.add(p.start);
  }
  return { frozen, frozenTopStarts };
}

/** Scan `lines[start, end)` for top-level checkbox / `TODO:` items (skipping any line the code
 *  guard marks as inside a fenced/indented code block, and any line of a FROZEN multi-line item —
 *  the topmost frozen item is reported into `unmapped` instead). `inAc` tags every result's
 *  `inPlaceInAc`. */
function scanAcCandidates(
  lines: readonly string[], start: number, end: number, codeLines: Set<number>, inAc: boolean,
  safety: RelocationSafety, unmapped: UnmappedNote[],
): AcCandidate[] {
  const out: AcCandidate[] = [];
  for (let j = Math.max(0, start); j < Math.min(end, lines.length); j++) {
    if (codeLines.has(j + 1)) continue;
    const line = lines[j]!;
    if (safety.frozenTopStarts.has(j)) {
      const cb = CHECKBOX_LINE_RE.exec(line);
      const reason = cb ? MULTILINE_ITEM_REASON : MULTILINE_TODO_REASON;
      unmapped.push({ line: j + 1, excerpt: (cb ? cb[2]! : line.trim()).slice(0, 60), reason });
      continue;
    }
    if (safety.frozen.has(j)) continue;
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
  const checkboxItems = collectCheckboxItems(text);
  const todoParagraphs = collectTodoParagraphs(text, lines);
  const safety = relocationSafety(checkboxItems, todoParagraphs, lines);

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
    const outside = scanAcCandidates(lines, ownStart, ownEnd, codeLines, false, safety, unmapped);

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
    // Headingless file. EVERY top-level checkbox item (across ALL root-level lists — prose between
    // lists splits one visual checklist into several mdast list nodes, and each must be processed;
    // handling only the first silently dropped and later mis-attributed the rest) promotes to its
    // own issue: its text becomes the minted heading (the one shape where a line is REWRITTEN
    // rather than purely inserted-into — otherwise the ex-checkbox text would linger as a loose
    // `ac_outside_section` item right under its own new heading). Its nested checkboxes RELOCATE
    // into a minted `### Acceptance Criteria` block inserted at the END of the issue's own span
    // (immediately before the next top-level item / EOF) — the same insertion point the heading
    // path uses (ownContentEnd) — so root-level prose between lists lands ABOVE the AC heading as
    // issue body, never inside the AC section (which the preset would flag as ac_prose_in_section
    // and the write path would then refuse). A multi-line item (per `relocationSafety`) is left
    // fully in place and named in the report, never promoted or split.
    const topItems = checkboxItems.filter((i) => i.depth === 0).sort((a, b) => a.start - b.start);
    if (topItems.length === 0 && text.trim() !== '') {
      unmapped.push({ line: 1, excerpt: lines[0]?.slice(0, 60) ?? '', reason: 'no heading, checkbox, or TODO: item found — nothing importable' });
    }
    const NESTED_CHECKBOX_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
    for (const [idx, item] of topItems.entries()) {
      if (safety.frozenTopStarts.has(item.start)) {
        const cb = CHECKBOX_LINE_RE.exec(lines[item.start]!);
        unmapped.push({ line: item.start + 1, excerpt: (cb ? cb[2]! : lines[item.start]!.trim()).slice(0, 60), reason: MULTILINE_ITEM_REASON });
        continue;
      }
      if (safety.frozen.has(item.start)) continue; // inside an outer frozen span (defensive; top items can't nest)
      const spanEnd = topItems[idx + 1]?.start ?? lines.length;
      const headText = lines[item.start]!.replace(/^ {0,3}[-*+]\s+\[[ xX]\]\s+/, '').trimEnd();
      const mintedId = allocator.next(prefix);
      // An issue has no "checked" concept (unlike an AC) — a checked top-level item is promoted to
      // a plain issue heading with no claim/marker; only its NESTED checkboxes (real ACs) are
      // subject to the pre-checked policy below.
      edits.push({ at: item.start, kind: 'replace', text: `## ${mintedId} ${headText}` });

      // Nested checkboxes (the item is safe, so each nested non-blank line IS a single-line
      // checkbox item): relocate ALL of them into the AC block. One already carrying an id is
      // relocated VERBATIM (id/marker preserved — existing ids are never altered or renumbered);
      // fresh ones number after the existing max, same as the heading path's AC-section rule.
      const nested = checkboxItems
        .filter((n) => n.depth >= 1 && n.start > item.start && n.end <= item.end)
        .sort((a, b) => a.start - b.start);
      let acExistingMaxNum = 0;
      let acExistingWidth = 2;
      let acPrefix = 'dev';
      for (const sub of nested) {
        const cb = NESTED_CHECKBOX_RE.exec(lines[sub.start]!);
        const already = cb ? AC_ID_TOKEN_RE.exec(cb[2]!) : null;
        if (!already) continue;
        acPrefix = already[1]!;
        const num = Number(already[2]);
        if (Number.isFinite(num)) {
          acExistingWidth = Math.max(acExistingWidth, already[2]!.length);
          acExistingMaxNum = Math.max(acExistingMaxNum, num);
        }
      }
      const acs: PlannedAc[] = [];
      const relocatedLines: string[] = [];
      let n = acExistingMaxNum + 1;
      for (const sub of nested) {
        const cb = NESTED_CHECKBOX_RE.exec(lines[sub.start]!);
        if (!cb) continue; // defensive; safety guarantees a checkbox line
        edits.push({ at: sub.start, kind: 'delete' });
        const already = AC_ID_TOKEN_RE.exec(cb[2]!);
        if (already) { relocatedLines.push(`- [${cb[1]}] ${cb[2]}`); continue; }
        const acId = `${acPrefix}/${String(n++).padStart(acExistingWidth, '0')}`;
        const subChecked = /x/i.test(cb[1]!);
        const marker = subChecked ? PRE_CHECKED_MARKER : '';
        const acText = `${cb[2]}${marker}`;
        acs.push({ status: 'minted', id: acId, text: acText, wasPreChecked: subChecked });
        if (subChecked) preChecked.push({ issueId: mintedId, acId, text: cb[2]! });
        relocatedLines.push(`- [ ] ${acId} v1 ${acText}`);
      }

      if (relocatedLines.length) {
        // Insert before the trailing-newline marker so the file's final newline stays final.
        let insertAt = spanEnd;
        if (insertAt === lines.length && lines.length > 0 && lines[lines.length - 1] === '') insertAt = lines.length - 1;
        // One blank line between the preceding SURVIVING content and the AC heading: walk back
        // over lines this item just deleted (relocated nested checkboxes) to find what survives.
        const deleted = new Set(nested.map((s) => s.start));
        let p = insertAt - 1;
        while (p >= 0 && deleted.has(p)) p--;
        const lead = p >= 0 && lines[p] !== '' ? [''] : [];
        const trail = insertAt < lines.length && lines[insertAt] !== '' ? [''] : [];
        edits.push({ at: insertAt, kind: 'insertBefore', lines: [...lead, '### Acceptance Criteria', '', ...relocatedLines, ...trail] });
      }

      issues.push({ status: 'minted', id: mintedId, title: headText, parentId: null, acs, existingAcCount: acExistingMaxNum });
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
