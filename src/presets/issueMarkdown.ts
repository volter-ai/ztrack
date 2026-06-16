import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

export type MarkdownCheckboxItem = {
  checked: boolean;
  marker: string;
  body: string;
  lineStart: number;
  lineEnd: number;
};

export type MarkdownDiagnostic = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  section?: string;
  line?: number;
  expected?: string[];
  actual?: string[];
  missingSources?: string[];
  acceptanceCriterion?: string;
  acceptanceCriteria?: string[];
  evidenceId?: string;
  proofId?: string;
  evidenceRef?: string;
  proofRef?: string;
  evidenceRefs?: string[];
  proofRefs?: string[];
  commitHashes?: string[];
  citedPrIds?: string[];
  status?: string;
  type?: string;
  approvalCriterion?: string;
  approvedDevAc?: string;
  approvedAcVersion?: string;
  currentAcVersion?: string;
  approvedSha?: string;
  currentSha?: string;
  approvedEvidence?: string[];
  currentEvidenceRefs?: string[];
  missingApprovedEvidence?: string[];
  missingPrs?: string[];
  unchecked?: string[];
  prs?: string[];
};

export type MarkdownSection = {
  level: number;
  title: string;
  normalizedTitle: string;
  body: string;
  raw?: string;
  parentIndex: number | null;
  lineStart: number;
  lineEnd: number;
  checkboxItems: MarkdownCheckboxItem[];
};

export type MarkdownDocument = {
  preamble: string;
  rawPreamble?: string;
  sections: MarkdownSection[];
  trailingNewline: boolean;
};

export type ParsedIssueMarkdown = {
  document: MarkdownDocument;
  diagnostics: MarkdownDiagnostic[];
  // slot name (from the active GrammarPack) -> the section that filled it, or null.
  sections: Record<string, MarkdownSection | null>;
};

// A section title is just a string. A grammar (GrammarPack + section order) is
// supplied by the caller; the generic default enforces no section canon.
export type CanonicalSectionTitle = string;

// A preset's template/variant selector (e.g. a preset may have multiple issue
// shapes). Just a name; the actual section vocabulary is supplied as a GrammarPack
// + section order, not derived from this string.
export type IssueMarkdownTemplate = string;

export type CanonicalIssueMarkdown = {
  title?: string;
  sections: Partial<Record<string, string>>;
  trailingNewline?: boolean;
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const CHECKBOX_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/;

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') offsets.push(index + 1);
  }
  return offsets;
}

// Guard the public order-taking functions: a string is iterable, so passing a template
// NAME ('parent-case') where a section-order ARRAY is expected would silently iterate
// character-by-character and corrupt the output. Fail loud instead.
function assertSectionOrder(sectionOrder: readonly string[]): void {
  if (!Array.isArray(sectionOrder)) {
    throw new TypeError(
      `sectionOrder must be an array of section titles (e.g. ['Summary','Sources']), got ${typeof sectionOrder}`,
    );
  }
}

// Checkbox-item detection via mdast (CommonMark+GFM): robust on real human
// markdown where the old line-regex + indentation heuristic mis-fired —
// `- [x]` inside fenced code is no longer a false item, and nested lists parse
// correctly. Item BODY is the RAW source slice (preserves backticks/emphasis
// byte-for-byte; mdast textContent would strip delimiters and corrupt
// AC-Version hashing), minus nested-list children and the marker prefix —
// matching the prior contract. Validated drop-in by scripts/mdast-equivalence-probe.ts
// (200/205 bodies byte-identical; divergences are mdast-more-correct).
function parseCheckboxItems(body: string, sectionLineStart: number): MarkdownCheckboxItem[] {
  const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const items: MarkdownCheckboxItem[] = [];
  const walk = (node: any): void => {
    if (node.type === 'listItem' && typeof node.checked === 'boolean' && node.position) {
      const firstNested = (node.children ?? []).find((c: any) => c.type === 'list' && c.position);
      const start = node.position.start.offset as number;
      const end = (firstNested ? firstNested.position.start.offset : node.position.end.offset) as number;
      // raw slice for this item's own content (excluding nested children),
      // with the "- [x] " / "- [ ] " marker prefix removed, trailing ws trimmed.
      const itemBody = body.slice(start, end).replace(/^\s*-\s+\[[ xX]\]\s+/, '').replace(/\s+$/, '');
      // lines are 1-based within `body`; sectionLineStart is the absolute line
      // of the section body's first line, so absolute = sectionLineStart + (n-1).
      const startLine = sectionLineStart + (node.position.start.line - 1);
      const lastOwnLine = (firstNested ? firstNested.position.start.line - 1 : node.position.end.line);
      items.push({
        checked: node.checked === true,
        marker: node.checked ? 'x' : ' ',
        body: itemBody,
        lineStart: startLine,
        lineEnd: sectionLineStart + (Math.max(node.position.start.line, lastOwnLine) - 1),
      });
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(tree);
  return items;
}

export function parseMarkdownDocument(text: string): MarkdownDocument {
  // Normalize CRLF/CR to LF so line numbers are correct and section bodies don't
  // retain trailing \r (the line model below is LF-based).
  text = text.replace(/\r\n?/g, '\n');
  const offsets = lineOffsets(text);
  const lines = text.split('\n');
  // Heading detection via mdast (CommonMark): a `#` inside a fenced code block
  // is NOT a heading (the old line-regex mis-detected those), and setext
  // headings are recognized. Title comes from the RAW heading-line slice (not
  // mdast textContent, which strips inline markdown) so section vocabulary
  // matches byte-for-byte; raw/offset feed the existing body-slicing below.
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const headings: Array<{ level: number; title: string; line: number; offset: number; raw: string }> = [];
  const collectHeadings = (node: any): void => {
    if (node.type === 'heading' && node.position) {
      const offset = node.position.start.offset as number;
      const raw = text.slice(offset, node.position.end.offset as number);
      const atx = /^(#{1,6})\s+(.*)$/.exec(raw);
      headings.push({
        level: node.depth as number,
        title: (atx ? atx[2]! : raw.split('\n')[0]!).trim(), // ATX: after the #s; setext: first line
        line: node.position.start.line as number,
        offset,
        raw,
      });
    }
    for (const c of node.children ?? []) collectHeadings(c);
  };
  collectHeadings(tree);

  const preambleEnd = headings[0]?.offset ?? text.length;
  const sections = headings.map((heading, index): MarkdownSection => {
    const headingEnd = heading.offset + heading.raw.length;
    const bodyStart = text[headingEnd] === '\n' ? headingEnd + 1 : headingEnd;
    const nextHeading = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const nextOffset = nextHeading?.offset ?? text.length;
    const body = text.slice(bodyStart, nextOffset).replace(/\n$/, '');
    const sectionLineStart = heading.line + 1;
    let parentIndex: number | null = null;
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex--) {
      if ((headings[candidateIndex]?.level ?? 0) < heading.level) {
        parentIndex = candidateIndex;
        break;
      }
    }
    const endLineIndex = offsets.findIndex((offset) => offset >= nextOffset);
    return {
      level: heading.level,
      title: heading.title.trim(),
      normalizedTitle: normalizeTitle(heading.title),
      body,
      raw: text.slice(heading.offset, nextOffset),
      parentIndex,
      lineStart: heading.line,
      lineEnd: endLineIndex >= 0 ? endLineIndex : lines.length,
      checkboxItems: parseCheckboxItems(body, sectionLineStart),
    };
  });

  return {
    preamble: text.slice(0, preambleEnd).replace(/\n$/, ''),
    rawPreamble: text.slice(0, preambleEnd),
    sections,
    trailingNewline: text.endsWith('\n'),
  };
}

// --- Pluggable grammar -----------------------------------------------------
// A tracker issue's normalized model has SLOTS (acceptanceCriteria, evidence,
// sources, …); how an issue's HEADINGS map to them is pluggable. A GrammarPack
// declares, per slot, the accepted heading titles (canonical first, then
// aliases). A preset supplies its own pack to teach the tracker its section
// vocabulary as DATA (e.g. map "Done When" → the acceptanceCriteria slot).
export type GrammarSlot = string;

export type GrammarPack = { name: string; slotTitles: Record<GrammarSlot, string[]> };

// Default generic pack: the minimal section vocabulary a plain issue uses, each
// slot accepting only its canonical title. Presets extend or replace it.
export const MARKDOWN_AC_PACK: GrammarPack = {
  name: 'markdown-ac',
  slotTitles: {
    summary: ['Summary'],
    acceptanceCriteria: ['Acceptance Criteria'],
    sources: ['Sources'],
    evidence: ['Evidence'],
  },
};

// A premade pack for teams whose issues use GitHub-style section names — built
// by EXTENDING markdown-ac with common aliases, the way a team would (data,
// not code). Demonstrates the registry; serves as a real adapter starting point.
const GITHUB_FLAVORED_PACK: GrammarPack = {
  name: 'github-flavored',
  slotTitles: {
    ...MARKDOWN_AC_PACK.slotTitles,
    acceptanceCriteria: ['Acceptance Criteria', 'Done When', 'Definition of Done', 'Tasks'],
    sources: ['Sources', 'Context', 'Background', 'Motivation'],
    evidence: ['Evidence', 'Verification', 'Testing'],
  },
};

// Named-pack registry. A config selects a base pack with
// organization.grammar.extends: "<name>" (default markdown-ac), then layers its
// own slotAliases on top. Unknown names ERROR (no silent fallback).
export const GRAMMAR_PACKS: Record<string, GrammarPack> = {
  'markdown-ac': MARKDOWN_AC_PACK,
  'github-flavored': GITHUB_FLAVORED_PACK,
};

// Resolve the active pack from config: extend a named base pack with aliases.
export function resolveGrammarPack(opts?: { extends?: string; slotAliases?: Record<string, string[]> }): GrammarPack {
  const baseName = opts?.extends ?? 'markdown-ac';
  const base = GRAMMAR_PACKS[baseName];
  if (!base) throw new Error(`unknown grammar pack '${baseName}' (available: ${Object.keys(GRAMMAR_PACKS).join(', ')})`);
  if (!opts?.slotAliases) return base;
  return {
    name: `${base.name}+config`,
    slotTitles: Object.fromEntries(
      (Object.keys(base.slotTitles) as GrammarSlot[]).map((slot) => [
        slot, [...base.slotTitles[slot]!, ...((opts.slotAliases as Record<string, string[]>)[slot] ?? [])],
      ]),
    ) as Record<GrammarSlot, string[]>,
  };
}

// Resolve a slot to a section by trying the pack's accepted titles in order.
// No silent fallback: a pack is complete by construction (every slot has at
// least its canonical title), so an undeclared slot is a programming error, not
// something to paper over with an invented title.
function slotSection(document: MarkdownDocument, slot: GrammarSlot, pack: GrammarPack): MarkdownSection | null {
  const titles = pack.slotTitles[slot];
  if (!titles || titles.length === 0) throw new Error(`grammar pack '${pack.name}' declares no titles for slot '${slot}'`);
  for (const title of titles) {
    const normalized = normalizeTitle(title);
    const found = document.sections.find((section) => section.normalizedTitle === normalized);
    if (found) return found;
  }
  return null;
}

function childSectionsForTemplate(document: MarkdownDocument): MarkdownSection[] {
  const titleSection = document.sections.find((section) => section.level === 1 && section.parentIndex === null) ?? null;
  if (!titleSection) return document.sections.filter((section) => section.parentIndex === null);
  const titleIndex = document.sections.indexOf(titleSection);
  return document.sections.filter((section) => section.parentIndex === titleIndex && section.level === 2);
}

function issueMarkdownDiagnostics(document: MarkdownDocument, sectionOrder: readonly string[]): MarkdownDiagnostic[] {
  const diagnostics: MarkdownDiagnostic[] = [];
  const h1Sections = document.sections.filter((section) => section.level === 1 && section.parentIndex === null);
  if (document.rawPreamble?.trim()) {
    diagnostics.push({
      level: 'error',
      code: 'issue_markdown_preamble_text',
      message: 'Issue body has text before the title heading.',
    });
  }
  if (h1Sections.length === 0) {
    diagnostics.push({
      level: 'error',
      code: 'issue_markdown_missing_title',
      message: 'Issue body must start with a single # title heading.',
    });
  } else if (h1Sections.length > 1) {
    diagnostics.push({
      level: 'error',
      code: 'issue_markdown_multiple_titles',
      message: 'Issue body must have exactly one # title heading.',
      actual: h1Sections.map((section) => section.title),
    });
  }

  // No section order supplied (generic default): stop after the title/preamble checks
  // so a project's own section names are never flagged as missing/unknown/out-of-order.
  // A preset enforces its section canon by passing its section order.
  if (sectionOrder.length === 0) return diagnostics;

  const expected = sectionOrder;
  const expectedNormalized = new Set(expected.map(normalizeTitle));
  const actualSections = childSectionsForTemplate(document);
  const actualCanonicalTitles = actualSections
    .filter((section) => expectedNormalized.has(section.normalizedTitle))
    .map((section) => section.title);
  const actualNormalized = actualSections.map((section) => section.normalizedTitle);

  for (const expectedTitle of expected) {
    if (!actualNormalized.includes(normalizeTitle(expectedTitle))) {
      diagnostics.push({
        level: 'error',
        code: 'issue_markdown_missing_section',
        message: `Issue body is missing required section ## ${expectedTitle}.`,
        section: expectedTitle,
        expected: [...expected],
        actual: actualSections.map((section) => section.title),
      });
    }
  }

  for (const section of actualSections) {
    // "unknown" = a section title not in the supplied canon (the section order).
    if (!expectedNormalized.has(section.normalizedTitle)) {
      diagnostics.push({
        level: 'error',
        code: 'issue_markdown_unknown_section',
        message: `Issue body contains non-canonical section ## ${section.title}.`,
        section: section.title,
        line: section.lineStart,
        expected: [...expected],
      });
    }
  }

  const duplicateCounts = new Map<string, MarkdownSection[]>();
  for (const section of actualSections.filter((candidate) => expectedNormalized.has(candidate.normalizedTitle))) {
    duplicateCounts.set(section.normalizedTitle, [...(duplicateCounts.get(section.normalizedTitle) ?? []), section]);
  }
  for (const sections of duplicateCounts.values()) {
    if (sections.length <= 1) continue;
    diagnostics.push({
      level: 'error',
      code: 'issue_markdown_duplicate_section',
      message: `Issue body repeats section ## ${sections[0]!.title}.`,
      section: sections[0]!.title,
      actual: sections.map((section) => `line ${section.lineStart}`),
    });
  }

  if (JSON.stringify(actualCanonicalTitles) !== JSON.stringify(expected.filter((title) => actualNormalized.includes(normalizeTitle(title))))) {
    diagnostics.push({
      level: 'error',
      code: 'issue_markdown_section_order',
      message: 'Issue body sections are not in canonical order.',
      expected: [...expected],
      actual: actualCanonicalTitles,
    });
  }

  return diagnostics;
}

// Parse an issue body into the generic document model plus per-slot resolution
// driven by the supplied GrammarPack. `sectionOrder` (empty by default = generic,
// permissive) drives section-canon diagnostics; a preset passes its order to enforce.
export function parseIssueMarkdown(
  text: string,
  sectionOrder: readonly string[] = [],
  pack: GrammarPack = MARKDOWN_AC_PACK,
): ParsedIssueMarkdown {
  assertSectionOrder(sectionOrder);
  const document = parseMarkdownDocument(text);
  const sections = Object.fromEntries(
    Object.keys(pack.slotTitles).map((name) => [name, slotSection(document, name, pack)]),
  );
  return {
    document,
    diagnostics: issueMarkdownDiagnostics(document, sectionOrder),
    sections,
  };
}

export function renderCanonicalIssueMarkdown(issue: CanonicalIssueMarkdown, sectionOrder: readonly string[] = []): string {
  assertSectionOrder(sectionOrder);
  const parts: string[] = [];
  if (issue.title) parts.push(`# ${issue.title.trim()}`);
  for (const title of sectionOrder) {
    const body = issue.sections[title]?.replace(/\s+$/, '') ?? '';
    parts.push(body ? `## ${title}\n\n${body}` : `## ${title}`);
  }
  return `${parts.join('\n\n')}${issue.trailingNewline === false ? '' : '\n'}`;
}

export function renderMarkdownDocument(document: MarkdownDocument): string {
  const rootSections = document.sections.filter((candidate) => candidate.parentIndex === null);
  if (rootSections.length > 0 && rootSections.every((section) => section.raw !== undefined)) {
    return `${document.rawPreamble ?? document.preamble}${rootSections.map((section) => section.raw ?? '').join('')}`;
  }

  const parts: string[] = [];
  if (document.preamble) parts.push(document.preamble);
  for (const section of rootSections) {
    const heading = `${'#'.repeat(section.level)} ${section.title}`;
    parts.push(section.body ? `${heading}\n${section.body}` : heading);
  }
  return `${parts.join('\n')}${document.trailingNewline ? '\n' : ''}`;
}

// ---------------------------------------------------------------------------
// Canonicalization (`tracker fmt`). fmt(x) = canonicalizeIssueMarkdown(x):
//  - headings normalized (`## Title`, canonical spelling for known section
//    titles differing only in case/whitespace; legacy aliases are NOT
//    renamed — the corpus proof showed renames collide with existing
//    canonical sections; vocabulary fixes belong to lint --fix, not fmt)
//  - canonical section order under the title; unknown sections keep their
//    relative order after the canonical ones; nested (###+) content stays
//    with its section
//  - whitespace: per-line trailing space stripped, blank-line runs collapsed
//    to one, exactly one blank line between blocks; checkbox markers
//    normalized to `- [x]` / `- [ ]`
//  - NEVER deletes or invents content: preamble and unknown sections are
//    preserved; missing sections stay missing (that's check's job)
//
// Contract proven by fmt-corpus-proof: idempotent; fixed-point on canonical
// renders; parse-semantics preserved (same sections by normalized title,
// same checkbox semantics); check findings shrink monotonically and only by
// issue_markdown_* codes.

// Whitespace/checkbox normalization for a block's content. Lines inside a fenced (or
// indented) code block are byte-preserved — `protectedAbsLines` holds their absolute
// 1-based line numbers, and `startLine` is the absolute line of `lines[0]`. fmt must
// never edit code bytes (significant whitespace, checkbox-like sample lines).
function canonicalizeBlockText(lines: string[], startLine: number, protectedAbsLines: Set<number>): string {
  const prot = lines.map((_, i) => protectedAbsLines.has(startLine + i));
  const rewritten = lines.map((line, i) => {
    if (prot[i]) return line;
    const checkbox = CHECKBOX_RE.exec(line);
    if (checkbox) {
      const indent = checkbox[1] ?? '';
      const marker = (checkbox[2] ?? ' ').toLowerCase() === 'x' ? 'x' : ' ';
      return `${indent}- [${marker}] ${(checkbox[3] ?? '').replace(/\s+$/, '')}`;
    }
    return line.replace(/\s+$/, '');
  });
  // Collapse runs of blank lines, but never collapse/drop a protected (code) line.
  const collapsed: Array<{ line: string; prot: boolean }> = [];
  for (let i = 0; i < rewritten.length; i++) {
    const entry = { line: rewritten[i]!, prot: prot[i]! };
    const prev = collapsed[collapsed.length - 1];
    if (entry.line === '' && !entry.prot && prev && prev.line === '' && !prev.prot) continue;
    collapsed.push(entry);
  }
  while (collapsed.length && collapsed[0]!.line === '' && !collapsed[0]!.prot) collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1]!.line === '' && !collapsed[collapsed.length - 1]!.prot) collapsed.pop();
  return collapsed.map((entry) => entry.line).join('\n');
}

type FmtBlock = { headingLevel: number; title: string; content: string[]; contentStart: number };

export function canonicalizeIssueMarkdown(text: string, sectionOrder: readonly string[] = []): string {
  assertSectionOrder(sectionOrder);
  text = text.replace(/\r\n?/g, '\n'); // normalize line endings (LF-based line model)
  // Canonical spelling for the known section titles (from the supplied order):
  // a section differing only in case/whitespace is respelled to the canonical form.
  const canonicalSpelling = new Map<string, string>(sectionOrder.map((title) => [normalizeTitle(title), title] as const));
  const lines = text.split('\n');
  // Real ATX heading lines per mdast (CommonMark): a `#` inside a fenced code
  // block is NOT a heading, so fmt must not split a block there (it would
  // corrupt code containing `## ...`). Gate the HEADING_RE block-split on this
  // set so fmt agrees with the parser on what a heading is. (ATX only — setext
  // would change the line-array block model; fmt emits ATX regardless.)
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const headingLines = new Set<number>();
  // Absolute 1-based line numbers inside fenced/indented code blocks — fmt preserves
  // these byte-for-byte (significant whitespace, checkbox-like sample lines).
  const codeLines = new Set<number>();
  const markNodes = (node: any): void => {
    if (node.type === 'heading' && node.position) headingLines.add(node.position.start.line as number);
    if (node.type === 'code' && node.position) {
      for (let line = node.position.start.line as number; line <= (node.position.end.line as number); line++) codeLines.add(line);
    }
    for (const c of node.children ?? []) markNodes(c);
  };
  markNodes(tree);
  // Split into preamble + heading-led blocks (a block owns the lines up to
  // the next heading of ANY level, unlike MarkdownSection.body).
  const blocks: FmtBlock[] = [];
  const preamble: string[] = [];
  let current: FmtBlock | null = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const heading = headingLines.has(lineIndex + 1) ? HEADING_RE.exec(line) : null;
    if (heading) {
      // heading is at 1-based line (lineIndex+1); its content begins on the next line.
      current = { headingLevel: (heading[1] ?? '').length, title: (heading[2] ?? '').trim(), content: [], contentStart: lineIndex + 2 };
      blocks.push(current);
    } else if (current) {
      current.content.push(line);
    } else {
      preamble.push(line);
    }
  }

  // Group level<=2 blocks into top-level units; deeper headings ride along
  // with the preceding unit so nested content never migrates.
  type Unit = { kind: 'title' | 'section'; title: string; level: number; parts: string[] };
  const units: Unit[] = [];
  let unit: Unit | null = null;
  for (const block of blocks) {
    const ownContent = canonicalizeBlockText(block.content, block.contentStart, codeLines);
    if (block.headingLevel <= 2 || !unit) {
      const spelled = block.headingLevel === 2 ? canonicalSpelling.get(normalizeTitle(block.title)) : undefined;
      unit = {
        kind: block.headingLevel === 1 ? 'title' : 'section',
        title: spelled ?? block.title,
        level: Math.min(block.headingLevel, 6),
        parts: ownContent ? [ownContent] : [],
      };
      units.push(unit);
    } else {
      const heading = `${'#'.repeat(Math.min(block.headingLevel, 6))} ${block.title}`;
      unit.parts.push(ownContent ? `${heading}\n\n${ownContent}` : heading);
    }
  }

  const titleUnit = units.find((candidate) => candidate.kind === 'title') ?? null;
  const sectionUnits = units.filter((candidate) => candidate !== titleUnit && candidate.level === 2);
  const otherUnits = units.filter((candidate) => candidate !== titleUnit && candidate.level !== 2);

  const order = sectionOrder;
  const orderIndex = new Map(order.map((title, index) => [normalizeTitle(title), index]));
  // Stable sort: canonical sections into canonical order; unknown sections
  // after them, preserving their original relative order.
  const sorted = sectionUnits
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const rankA = orderIndex.get(normalizeTitle(a.candidate.title)) ?? order.length + a.index;
      const rankB = orderIndex.get(normalizeTitle(b.candidate.title)) ?? order.length + b.index;
      return rankA - rankB || a.index - b.index;
    })
    .map((entry) => entry.candidate);

  const rendered: string[] = [];
  const preambleText = canonicalizeBlockText(preamble, 1, codeLines);
  if (preambleText) rendered.push(preambleText);
  for (const candidate of titleUnit ? [titleUnit, ...sorted, ...otherUnits] : [...sorted, ...otherUnits]) {
    const heading = `${'#'.repeat(candidate.level)} ${candidate.title}`;
    rendered.push([heading, ...candidate.parts].join('\n\n'));
  }
  return `${rendered.join('\n\n')}\n`;
}
