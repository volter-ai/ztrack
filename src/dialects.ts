// Dialects (docs/DIALECTS.md): read a repo's OWN task-list idiom as issues, without rewriting
// the file. A dialect is pure DATA — a declarative description of how one file surface encodes
// issues (boundary, id, title, status vocabulary, hierarchy) — interpreted by the ONE engine
// below (`parseWithDialect`). Adding a dialect adds a registry entry + conformance fixtures
// (src/dialects.fixtures/), never an `if` in the engine; a registry-driven test pins that.
//
// This is parser 1 only (file -> record fields). The invariant that keeps the two-parser
// architecture clean: a dialect may only produce what a backend could have produced — id,
// title, status, hierarchy, body — and only presets decide what a body MEANS. Process grammar
// (ACs, evidence) is never parsed here; a lens-sourced issue simply doesn't claim any.
//
// The file-level sibling of `GrammarPack` (markdownDocument.ts): GrammarPack teaches the section
// vocabulary INSIDE an issue as data; a dialect teaches the file structure AROUND issues as
// data. Same registry discipline: unknown names ERROR, no silent fallback.
import { z } from 'zod';
import { parseMarkdownDocument, type MarkdownDocument, type MarkdownSection } from './markdownDocument.ts';

// ── the dialect shape (data, validated) ──────────────────────────────────────

/** Where issues live in the file. `heading`: every heading (any depth) whose title starts with an
 *  id token is an issue — same boundary rule as the native document grammar, with the id pattern
 *  swapped. `checkbox-item`: every GFM checkbox list item whose text opens with a bold lead
 *  (`**WS-A: title** — …`) carrying an id token is an issue; the checkbox is its status. */
const IssueBoundarySchema = z.enum(['heading', 'checkbox-item']);

/** How an issue's status is read. `field-bullet`: a `**<label>**: <value>` line in the issue's own
 *  direct content, `value` scanned for the vocabulary's tokens (first occurrence wins).
 *  `checkbox`: the boundary checkbox itself, mapped through `vocabulary.checked`/`.unchecked`. */
const StatusRuleSchema = z.union([
  z.object({
    at: z.literal('field-bullet'),
    label: z.string().min(1),
    /** surface token (e.g. "🟢") -> tracker state name (e.g. "done"). Tokens are matched as
     *  substrings of the field value, earliest occurrence first — emoji don't word-break. */
    vocabulary: z.record(z.string().min(1), z.string().min(1)),
  }).strict(),
  z.object({
    at: z.literal('checkbox'),
    vocabulary: z.object({ checked: z.string().min(1), unchecked: z.string().min(1) }).strict(),
  }).strict(),
]);

export const DialectSchema = z.object({
  issueBoundary: IssueBoundarySchema,
  /** Regex SOURCE for the id token, matched at the boundary's id position (heading start /
   *  bold-lead start). Anchoring and the following separator (`—`/`·`/`:` or whitespace) are the
   *  engine's job — the pattern describes the token only. Built-ins deliberately require a digit
   *  or an interior hyphen so prose ("Follow-up") can never be an id. */
  idPattern: z.string().min(1),
  status: StatusRuleSchema,
  /** `heading-nesting`: heading hierarchy between issue sections becomes parent/children (only
   *  meaningful with the `heading` boundary). `flat`: no hierarchy. */
  hierarchy: z.enum(['heading-nesting', 'flat']),
}).strict();

export type Dialect = z.infer<typeof DialectSchema>;

// ── built-in registry ────────────────────────────────────────────────────────

/** `### KQ3 — title` sections with a `- **Status**: 🟢 …` bullet — the kill-question/experiment
 *  register shape. Id must carry a digit (`KQ3`, `TF-1001`); a merely-hyphenated word
 *  ("Follow-up") never matches. */
const EMOJI_REGISTER: Dialect = {
  hierarchy: 'heading-nesting',
  idPattern: '[A-Za-z][A-Za-z0-9-]*\\d[A-Za-z0-9]*',
  issueBoundary: 'heading',
  status: {
    at: 'field-bullet',
    label: 'Status',
    vocabulary: { '🔴': 'ready', '🟡': 'in-progress', '🟢': 'done' },
  },
};

/** `- [x] **WS-A: title** — description` rosters — the build-checklist shape. Ids are uppercase
 *  and must be hyphenated or digit-bearing (`WS-A`, `B3`), so a bold prose lead never matches. */
const CHECKBOX_ROSTER: Dialect = {
  hierarchy: 'flat',
  idPattern: '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z][A-Z0-9]*\\d[A-Z0-9]*',
  issueBoundary: 'checkbox-item',
  status: { at: 'checkbox', vocabulary: { checked: 'done', unchecked: 'ready' } },
};

export const DIALECTS: Record<string, Dialect> = {
  'checkbox-roster': CHECKBOX_ROSTER,
  'emoji-register': EMOJI_REGISTER,
};

/** Resolve a config `dialect` value: a NAME looks up the registry (unknown names ERROR, the
 *  GrammarPack discipline), an inline object validates against the schema. */
export function resolveDialect(value: string | Dialect): { dialect: Dialect; name: string } {
  if (typeof value === 'string') {
    const dialect = DIALECTS[value];
    if (!dialect) throw new Error(`unknown dialect '${value}' (available: ${Object.keys(DIALECTS).join(', ')})`);
    return { dialect, name: value };
  }
  return { dialect: DialectSchema.parse(value), name: 'inline' };
}

// ── engine output ────────────────────────────────────────────────────────────

export interface DialectIssue {
  id: string;
  title: string;
  /** Tracker state name. Never absent: an issue with no readable status token defaults to
   *  `draft` with `statusExplicit: false` — nothing claimed, nothing gated. */
  status: string;
  /** True iff the status came from an actual surface token (vocabulary hit / checkbox), false
   *  when defaulted. Detection counts only explicit ones — the false-positive floor. */
  statusExplicit: boolean;
  parent: string | null;
  children: string[];
  body: string;
  lineStart: number;
  lineEnd: number;
}

export interface DialectDiagnostic {
  kind: 'duplicate_id' | 'status_unrecognized';
  id: string;
  line: number;
  message: string;
}

export interface DialectParseResult {
  issues: DialectIssue[];
  diagnostics: DialectDiagnostic[];
}

// ── the engine ───────────────────────────────────────────────────────────────

function idHeadRe(idPattern: string): RegExp {
  // Mirrors the native grammar's ID_HEADING_RE shape (documentParser.ts) with the id token
  // swapped: token, word boundary, optional separator (em dash / middot / colon), remainder.
  return new RegExp(`^(${idPattern})\\b\\s*(?:[—·:]\\s*)?(.*)$`);
}

/** The lines of a heading section that belong to IT and not to a descendant ISSUE — the span from
 *  its own body start to the first issue-descendant's heading. Keeps a parent's status scan from
 *  stealing a child issue's `**Status**:` bullet. */
function ownContent(section: MarkdownSection, sectionIndex: number, doc: MarkdownDocument, isIssue: (index: number) => boolean): string {
  // `lineStart`/`lineEnd` are 1-based and inclusive; `body`'s first line is the file line just
  // after the heading (lineStart + 1). Own content ends the line before the first
  // issue-descendant's heading.
  let end = section.lineEnd;
  for (let index = sectionIndex + 1; index < doc.sections.length; index++) {
    const candidate = doc.sections[index]!;
    if (candidate.lineStart > section.lineEnd) break;
    if (isIssue(index)) { end = Math.min(end, candidate.lineStart - 1); break; }
  }
  const ownLineCount = Math.max(0, end - section.lineStart);
  return section.body.split('\n').slice(0, ownLineCount).join('\n');
}

function fieldBulletStatus(content: string, label: string, vocabulary: Record<string, string>):
  { status: string; explicit: boolean; unrecognized?: { line: number; value: string } } {
  const re = new RegExp(`^\\s*(?:[-*+]\\s+)?\\*\\*${label}\\*\\*\\s*:?\\s*(.+)$`, 'i');
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const match = re.exec(lines[index]!);
    if (!match) continue;
    const value = match[1]!;
    let best: { at: number; state: string } | null = null;
    for (const [token, state] of Object.entries(vocabulary)) {
      const at = value.indexOf(token);
      if (at >= 0 && (best === null || at < best.at)) best = { at, state };
    }
    if (best) return { explicit: true, status: best.state };
    return { explicit: false, status: 'draft', unrecognized: { line: index, value: value.trim() } };
  }
  return { explicit: false, status: 'draft' };
}

function parseHeadingBoundary(text: string, dialect: Dialect): DialectParseResult {
  const doc = parseMarkdownDocument(text);
  const re = idHeadRe(dialect.idPattern);
  const matches = doc.sections.map((section) => re.exec(section.title));
  const isIssue = (index: number): boolean => matches[index] !== null && matches[index] !== undefined;
  const issues: DialectIssue[] = [];
  const diagnostics: DialectDiagnostic[] = [];
  const seen = new Map<string, number>();
  const idOfSection = new Map<number, string>();

  doc.sections.forEach((section, index) => {
    const match = matches[index];
    if (!match) return;
    const id = match[1]!;
    if (seen.has(id)) {
      diagnostics.push({ id, kind: 'duplicate_id', line: section.lineStart, message: `duplicate id ${id} (first at line ${seen.get(id)! + 1}); section skipped` });
      return;
    }
    seen.set(id, section.lineStart);
    idOfSection.set(index, id);
    const content = ownContent(section, index, doc, isIssue);
    const status = dialect.status.at === 'field-bullet'
      ? fieldBulletStatus(content, dialect.status.label, dialect.status.vocabulary)
      : { explicit: false as const, status: 'draft' };
    if ('unrecognized' in status && status.unrecognized) {
      diagnostics.push({
        id, kind: 'status_unrecognized', line: section.lineStart + 1 + status.unrecognized.line,
        message: `status line for ${id} has no recognized token (${JSON.stringify(status.unrecognized.value.slice(0, 40))}); defaulting to draft`,
      });
    }
    issues.push({
      body: content, children: [], id, lineEnd: section.lineEnd, lineStart: section.lineStart,
      parent: null, status: status.status, statusExplicit: status.explicit, title: (match[2] ?? '').trim() || id,
    });
  });

  if (dialect.hierarchy === 'heading-nesting') {
    const issueByIndex = new Map<number, DialectIssue>();
    let cursor = 0;
    doc.sections.forEach((section, index) => {
      if (!idOfSection.has(index)) return;
      issueByIndex.set(index, issues[cursor]!);
      cursor += 1;
    });
    for (const [index] of idOfSection) {
      let parentIndex = doc.sections[index]!.parentIndex;
      while (parentIndex !== null && !idOfSection.has(parentIndex)) parentIndex = doc.sections[parentIndex]!.parentIndex;
      if (parentIndex === null) continue;
      const child = issueByIndex.get(index)!;
      const parent = issueByIndex.get(parentIndex)!;
      child.parent = parent.id;
      parent.children.push(child.id);
    }
  }
  return { diagnostics, issues };
}

function parseCheckboxBoundary(text: string, dialect: Dialect): DialectParseResult {
  const doc = parseMarkdownDocument(text);
  // Bold lead: `**<id><sep> <title>** <rest…>` at the very start of the item body.
  const leadRe = new RegExp(`^\\*\\*(${dialect.idPattern})\\b\\s*(?:[—·:]\\s*)?([^*]*)\\*\\*\\s*(?:[—·:–-]\\s*)?`);
  const issues: DialectIssue[] = [];
  const diagnostics: DialectDiagnostic[] = [];
  const seen = new Map<string, number>();
  // A section's `checkboxItems` are parsed from its whole-subtree body, so an item under
  // `## Workstreams` appears again in `# Title`'s items. Keep one copy per identity, preferring
  // the DEEPEST containing section (nearest heading — its line numbers are the accurate ones).
  // Byte-identical items (same checked state, same body) collapse to one; that also means a
  // perfect copy-paste duplicate reads as one item rather than a duplicate_id — acceptable, since
  // the two are indistinguishable from a nested re-parse.
  const byIdentity = new Map<string, { item: MarkdownSection['checkboxItems'][number]; depth: number }>();
  for (const section of doc.sections) {
    for (const item of section.checkboxItems) {
      const key = `${item.checked}|${item.body}`;
      const previous = byIdentity.get(key);
      if (!previous || section.lineStart > previous.depth) byIdentity.set(key, { depth: section.lineStart, item });
    }
  }
  const items = [...byIdentity.values()].map((entry) => entry.item).sort((a, b) => a.lineStart - b.lineStart);
  {
    for (const item of items) {
      const match = leadRe.exec(item.body);
      if (!match) continue;
      const id = match[1]!;
      if (seen.has(id)) {
        diagnostics.push({ id, kind: 'duplicate_id', line: item.lineStart, message: `duplicate id ${id} (first at line ${seen.get(id)! + 1}); item skipped` });
        continue;
      }
      seen.set(id, item.lineStart);
      const vocabulary = dialect.status.at === 'checkbox' ? dialect.status.vocabulary : { checked: 'done', unchecked: 'ready' };
      issues.push({
        body: item.body.slice(match[0].length), children: [], id, lineEnd: item.lineEnd, lineStart: item.lineStart,
        parent: null, status: item.checked ? vocabulary.checked : vocabulary.unchecked, statusExplicit: true,
        title: (match[2] ?? '').trim() || id,
      });
    }
  }
  return { diagnostics, issues };
}

/** THE engine: apply one dialect to one file's text. No dialect-specific branches — only
 *  boundary-kind dispatch over the declared data. */
export function parseWithDialect(text: string, dialect: Dialect): DialectParseResult {
  return dialect.issueBoundary === 'heading' ? parseHeadingBoundary(text, dialect) : parseCheckboxBoundary(text, dialect);
}

// ── detection ────────────────────────────────────────────────────────────────

export interface DialectDetection {
  name: string;
  dialect: Dialect;
  /** Ids of the issues that made the floor (explicit status only). */
  ids: string[];
}

/** Try every built-in dialect speculatively; a match needs >= 2 issues with an id AND an
 *  EXPLICIT status (the false-positive floor — prose never volunteers both). A tie between
 *  dialects is a null: guessing wrong is worse than staying quiet. */
export function detectDialect(text: string): DialectDetection | null {
  let best: DialectDetection | null = null;
  let bestScore = 0;
  let tie = false;
  for (const [name, dialect] of Object.entries(DIALECTS)) {
    let issues: DialectIssue[];
    try { issues = parseWithDialect(text, dialect).issues; } catch { continue; }
    const explicit = issues.filter((issue) => issue.statusExplicit);
    if (explicit.length < 2) continue;
    if (explicit.length > bestScore) {
      best = { dialect, ids: explicit.map((issue) => issue.id), name };
      bestScore = explicit.length;
      tie = false;
    } else if (explicit.length === bestScore) tie = true;
  }
  return tie ? null : best;
}
