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
  template: IssueMarkdownTemplate;
  diagnostics: MarkdownDiagnostic[];
  sections: {
    peakLiteCase: MarkdownSection | null;
    summary: MarkdownSection | null;
    caseManagerAcceptanceCriteria: MarkdownSection | null;
    developmentAcceptanceCriteria: MarkdownSection | null;
    repoCoverage: MarkdownSection | null;
    externalAcceptanceCriteria: MarkdownSection | null;
    proceduralAcceptanceCriteria: MarkdownSection | null;
    sources: MarkdownSection | null;
    evidence: MarkdownSection | null;
    clientChannel: MarkdownSection | null;
    operatorChannel: MarkdownSection | null;
  };
};

// 'generic' is the default: a permissive grammar with NO required section canon —
// fmt only normalizes whitespace/heading style and lint only checks the title, so a
// project's own section names are never flagged. 'parent-case'/'stakeholder-subcase'
// are example templates that DO enforce a fixed section set (a richer SDLC opts in by
// passing the template, or a custom GrammarPack / section order).
export type IssueMarkdownTemplate = 'generic' | 'parent-case' | 'stakeholder-subcase';

export type CanonicalIssueMarkdown = {
  title?: string;
  sections: Partial<Record<CanonicalSectionTitle, string>>;
  trailingNewline?: boolean;
};

export type CanonicalSectionTitle =
  | 'Peak Lite Case'
  | 'Summary'
  | 'Case Manager Acceptance Criteria'
  | 'Development Acceptance Criteria'
  | 'Repo Coverage'
  | 'External Acceptance Criteria'
  | 'Procedural Acceptance Criteria'
  | 'Sources'
  | 'Evidence'
  | 'Client Channel'
  | 'Operator Channel';

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const CHECKBOX_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/;
const PARENT_CASE_SECTION_ORDER: CanonicalSectionTitle[] = [
  'Peak Lite Case',
  'Summary',
  'Case Manager Acceptance Criteria',
  'Development Acceptance Criteria',
  'Repo Coverage',
  'External Acceptance Criteria',
  'Procedural Acceptance Criteria',
  'Sources',
  'Evidence',
  'Client Channel',
  'Operator Channel',
];
const STAKEHOLDER_SUBCASE_SECTION_ORDER: CanonicalSectionTitle[] = [
  'Case Manager Acceptance Criteria',
  'Procedural Acceptance Criteria',
  'Sources',
];
const CANONICAL_SECTION_TITLES = new Set<string>(PARENT_CASE_SECTION_ORDER.map(normalizeTitle));
const LEGACY_SECTION_ALIASES = new Map<string, string>([
  ['acceptance criteria', 'Development Acceptance Criteria'],
  ['developer acceptance criteria', 'Development Acceptance Criteria'],
  ['implementation acceptance criteria', 'Development Acceptance Criteria'],
  ['non-development acceptance criteria', 'Case Manager Acceptance Criteria'],
  ['source', 'Sources'],
]);

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

function canonicalSectionOrder(template: IssueMarkdownTemplate): CanonicalSectionTitle[] {
  if (template === 'generic') return []; // no required/canonical section set
  return template === 'stakeholder-subcase' ? STAKEHOLDER_SUBCASE_SECTION_ORDER : PARENT_CASE_SECTION_ORDER;
}

function exactSection(document: MarkdownDocument, title: CanonicalSectionTitle): MarkdownSection | null {
  const normalized = normalizeTitle(title);
  return document.sections.find((section) => section.normalizedTitle === normalized) ?? null;
}

// --- Pluggable grammar (roadmap G5) ---------------------------------------
// The normalized-model SLOTS the exporter reads (developmentAcceptanceCriteria,
// sources, evidence, …) are fixed; how an issue's HEADINGS map to them is
// pluggable. A GrammarPack declares, per slot, the accepted heading titles
// (canonical first, then aliases). The default `markdown-ac` pack accepts only
// each slot's canonical title — byte-identical to the prior exact-match
// behavior — so a team can keep our format or teach the tracker its own
// (e.g. map "Done When" → the developmentAcceptanceCriteria slot) as DATA.
export type GrammarSlot =
  | 'peakLiteCase' | 'summary' | 'caseManagerAcceptanceCriteria' | 'developmentAcceptanceCriteria'
  | 'repoCoverage' | 'externalAcceptanceCriteria' | 'proceduralAcceptanceCriteria'
  | 'sources' | 'evidence' | 'clientChannel' | 'operatorChannel';

export type GrammarPack = { name: string; slotTitles: Record<GrammarSlot, string[]> };

const SLOT_CANONICAL_TITLE: Record<GrammarSlot, CanonicalSectionTitle> = {
  peakLiteCase: 'Peak Lite Case', summary: 'Summary',
  caseManagerAcceptanceCriteria: 'Case Manager Acceptance Criteria',
  developmentAcceptanceCriteria: 'Development Acceptance Criteria',
  repoCoverage: 'Repo Coverage', externalAcceptanceCriteria: 'External Acceptance Criteria',
  proceduralAcceptanceCriteria: 'Procedural Acceptance Criteria',
  sources: 'Sources', evidence: 'Evidence', clientChannel: 'Client Channel', operatorChannel: 'Operator Channel',
};

// Default pack: each slot accepts exactly its canonical title (current behavior).
export const MARKDOWN_AC_PACK: GrammarPack = {
  name: 'markdown-ac',
  slotTitles: Object.fromEntries(
    (Object.keys(SLOT_CANONICAL_TITLE) as GrammarSlot[]).map((slot) => [slot, [SLOT_CANONICAL_TITLE[slot]]]),
  ) as Record<GrammarSlot, string[]>,
};

// A premade pack for teams whose issues use GitHub-style section names — built
// by EXTENDING markdown-ac with common aliases, the way a team would (data,
// not code). Demonstrates the registry; serves as a real adapter starting point.
const GITHUB_FLAVORED_PACK: GrammarPack = {
  name: 'github-flavored',
  slotTitles: {
    ...MARKDOWN_AC_PACK.slotTitles,
    developmentAcceptanceCriteria: ['Development Acceptance Criteria', 'Acceptance Criteria', 'Done When', 'Definition of Done', 'Tasks'],
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
        slot, [...base.slotTitles[slot], ...((opts.slotAliases as Record<string, string[]>)[slot] ?? [])],
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

function issueMarkdownDiagnostics(document: MarkdownDocument, template: IssueMarkdownTemplate): MarkdownDiagnostic[] {
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

  // Generic grammar declares no section canon: stop after the title/preamble checks
  // so a project's own section names are never flagged as missing/unknown/out-of-order.
  if (canonicalSectionOrder(template).length === 0) return diagnostics;

  const expected = canonicalSectionOrder(template);
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
        expected,
        actual: actualSections.map((section) => section.title),
      });
    }
  }

  for (const section of actualSections) {
    const aliasTarget = LEGACY_SECTION_ALIASES.get(section.normalizedTitle);
    if (aliasTarget) {
      diagnostics.push({
        level: 'error',
        code: 'issue_markdown_legacy_section_alias',
        message: `Issue body uses legacy section ## ${section.title}; use ## ${aliasTarget}.`,
        section: section.title,
        line: section.lineStart,
      });
      continue;
    }
    if (!CANONICAL_SECTION_TITLES.has(section.normalizedTitle)) {
      diagnostics.push({
        level: 'error',
        code: 'issue_markdown_unknown_section',
        message: `Issue body contains non-canonical section ## ${section.title}.`,
        section: section.title,
        line: section.lineStart,
        expected,
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
      expected,
      actual: actualCanonicalTitles,
    });
  }

  return diagnostics;
}

export function parseIssueMarkdown(text: string, template: IssueMarkdownTemplate = 'generic', pack: GrammarPack = MARKDOWN_AC_PACK): ParsedIssueMarkdown {
  const document = parseMarkdownDocument(text);
  const slot = (name: GrammarSlot): MarkdownSection | null => slotSection(document, name, pack);
  return {
    document,
    template,
    diagnostics: issueMarkdownDiagnostics(document, template),
    sections: {
      peakLiteCase: slot('peakLiteCase'),
      summary: slot('summary'),
      caseManagerAcceptanceCriteria: slot('caseManagerAcceptanceCriteria'),
      developmentAcceptanceCriteria: slot('developmentAcceptanceCriteria'),
      repoCoverage: slot('repoCoverage'),
      externalAcceptanceCriteria: slot('externalAcceptanceCriteria'),
      proceduralAcceptanceCriteria: slot('proceduralAcceptanceCriteria'),
      sources: slot('sources'),
      evidence: slot('evidence'),
      clientChannel: slot('clientChannel'),
      operatorChannel: slot('operatorChannel'),
    },
  };
}

export function renderCanonicalIssueMarkdown(issue: CanonicalIssueMarkdown, template: IssueMarkdownTemplate = 'generic'): string {
  const parts: string[] = [];
  if (issue.title) parts.push(`# ${issue.title.trim()}`);
  for (const title of canonicalSectionOrder(template)) {
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

const CANONICAL_SPELLING = new Map<string, CanonicalSectionTitle>(
  PARENT_CASE_SECTION_ORDER.map((title) => [normalizeTitle(title), title] as const),
);

function canonicalizeBlockText(text: string): string {
  const lines = text.split('\n').map((line) => {
    const checkbox = CHECKBOX_RE.exec(line);
    if (checkbox) {
      const indent = checkbox[1] ?? '';
      const marker = (checkbox[2] ?? ' ').toLowerCase() === 'x' ? 'x' : ' ';
      return `${indent}- [${marker}] ${(checkbox[3] ?? '').replace(/\s+$/, '')}`;
    }
    return line.replace(/\s+$/, '');
  });
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === '' && collapsed[collapsed.length - 1] === '') continue;
    collapsed.push(line);
  }
  while (collapsed[0] === '') collapsed.shift();
  while (collapsed[collapsed.length - 1] === '') collapsed.pop();
  return collapsed.join('\n');
}

type FmtBlock = { headingLevel: number; title: string; content: string[] };

export function canonicalizeIssueMarkdown(text: string, template: IssueMarkdownTemplate = 'generic'): string {
  const lines = text.split('\n');
  // Real ATX heading lines per mdast (CommonMark): a `#` inside a fenced code
  // block is NOT a heading, so fmt must not split a block there (it would
  // corrupt code containing `## ...`). Gate the HEADING_RE block-split on this
  // set so fmt agrees with the parser on what a heading is. (ATX only — setext
  // would change the line-array block model; fmt emits ATX regardless.)
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const headingLines = new Set<number>();
  const markHeadings = (node: any): void => {
    if (node.type === 'heading' && node.position) headingLines.add(node.position.start.line as number);
    for (const c of node.children ?? []) markHeadings(c);
  };
  markHeadings(tree);
  // Split into preamble + heading-led blocks (a block owns the lines up to
  // the next heading of ANY level, unlike MarkdownSection.body).
  const blocks: FmtBlock[] = [];
  const preamble: string[] = [];
  let current: FmtBlock | null = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const heading = headingLines.has(lineIndex + 1) ? HEADING_RE.exec(line) : null;
    if (heading) {
      current = { headingLevel: (heading[1] ?? '').length, title: (heading[2] ?? '').trim(), content: [] };
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
    const ownContent = canonicalizeBlockText(block.content.join('\n'));
    if (block.headingLevel <= 2 || !unit) {
      const spelled = block.headingLevel === 2 ? CANONICAL_SPELLING.get(normalizeTitle(block.title)) : undefined;
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

  const order = canonicalSectionOrder(template);
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
  const preambleText = canonicalizeBlockText(preamble.join('\n'));
  if (preambleText) rendered.push(preambleText);
  for (const candidate of titleUnit ? [titleUnit, ...sorted, ...otherUnits] : [...sorted, ...otherUnits]) {
    const heading = `${'#'.repeat(candidate.level)} ${candidate.title}`;
    rendered.push([heading, ...candidate.parts].join('\n\n'));
  }
  return `${rendered.join('\n\n')}\n`;
}
