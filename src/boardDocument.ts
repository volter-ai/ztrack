/** A board's document codec, shared by ztrack and supercode's document backing.
 * Callers own the file's hash/transaction; this module only parses and renders text. */
import { parseMarkdownDocumentSource, type DocumentParsedIssue } from './documentParserEf4.ts';
import { parseBoardDocument as parseEf4BoardDocument, renderBoardCard as renderEf4BoardCard } from './boardDocumentEf4.ts';
import { boardEncodingSlot, BOARD_ENCODING_MARKER, BOARD_WRITE_MODE } from './boardEncoding.ts';
import { decomposeSection, nestHeadings, unnestHeadings } from './documentWriteBack.ts';
import { decomposeSection as decomposeEf4Section, shiftHeadings as shiftEf4Headings } from './documentWriteBackEf4.ts';
import { parseKanban as parseEf4Kanban } from '../boilerplates/presets/kanbanEf4.ts';
import type { IssueRecord } from './core/engine.ts';

// The four *Ef4 modules are frozen from be866b90b7b36ebf36ff998b510291a167a3ff2e;
// only their local imports were retargeted, keeping the predecessor closure together.
/** Immutable writer selection; the bridge and final writer are separate source commits. */
export const boardDocumentProtocol = Object.freeze({
  envelope: BOARD_ENCODING_MARKER,
  readModes: Object.freeze(['ef4', 'escaped-headings-v1'] as const),
  writer: BOARD_WRITE_MODE,
});

// Keep ef4's exact section grammar for unmarked cards. Only a marked card owns id-shaped body
// headings; physical spans identify ancestors even when malformed input repeats an id.
function cards(text: string, path: string): DocumentParsedIssue[] {
  const items = parseMarkdownDocumentSource(text, path);
  let markedThrough = 0;
  const selected: DocumentParsedIssue[] = [];
  for (const item of items) {
    if (item.lineStart !== undefined && item.lineStart <= markedThrough) continue;
    const slot = boardEncodingSlot(item.raw ?? '');
    if (slot.marker !== undefined) {
      markedThrough = item.lineEnd ?? 0;
      selected.push({ ...item, body: item.raw ?? item.body, children: [] });
    } else selected.push(item);
  }
  return selected;
}

/** Reserved slots, including invalid ones. A legacy predecessor must have none at preparation:
 * even an exact marker could be its literal body text, so it cannot be silently reinterpreted. */
export function inspectBoardEncodingSlots(text: string, path = 'arcs.md'): Array<{ id: string; line: number; marker: string; encoding: 'ef4' | 'escaped-headings-v1'; error?: string }> {
  return cards(text, path).flatMap((item) => {
    const slot = boardEncodingSlot(item.raw ?? '');
    return slot.marker === undefined ? [] : [{ id: item.id, line: (item.lineStart ?? 0) + 1,
      marker: slot.marker, encoding: slot.encoding, ...(slot.error ? { error: slot.error } : {}) }];
  });
}

function recordOf(item: DocumentParsedIssue): IssueRecord {
  if (!item.raw || !item.level || item.children.length) throw new Error(`board card ${item.id} must be one flat document section`);
  const slot = boardEncodingSlot(item.raw);
  if (slot.error) throw new Error(`${item.id}: ${slot.error}`);
  if (slot.encoding === 'ef4') {
    const section = decomposeEf4Section(item.raw);
    if (section.discardedHeaderLine) throw new Error(`malformed header for ${item.id}: ${section.discardedHeaderLine}`);
    return { id: item.id, title: item.title, status: section.header?.status ?? 'todo',
      ...(section.header?.assignee ? { assignee: section.header.assignee } : {}),
      body: shiftEf4Headings(section.middle, 1 - item.level) };
  }
  const at = item.raw.indexOf('\n') + 1;
  const raw = item.raw.slice(0, at) + item.raw.slice(at + BOARD_ENCODING_MARKER.length + 1);
  const section = decomposeSection(raw);
  if (section.discardedHeaderLine) throw new Error(`malformed header for ${item.id}: ${section.discardedHeaderLine}`);
  return { id: item.id, title: item.title, status: section.header?.status ?? 'todo',
    ...(section.header?.assignee ? { assignee: section.header.assignee } : {}),
    body: unnestHeadings(section.middle, item.level - 1) };
}

function sameRecord(a: IssueRecord, b: IssueRecord): boolean {
  return a.id === b.id && a.title === b.title && a.status === b.status &&
    (a.assignee || undefined) === (b.assignee || undefined) &&
    a.body.replace(/\n*$/, '') === b.body.replace(/\n*$/, '');
}
export function parseBoardDocument(text: string, path = 'arcs.md'): IssueRecord[] {
  return cards(text,path).map(recordOf);
}

/** The complete predecessor's board and kanban read path, for a backing's bridge write admission.
 * The standalone preset is frozen from the same ef4 source as the four board modules above;
 * its public preset-kit mechanism is unchanged at runtime. This reader never sees a new envelope. */
export function parseEf4KanbanBoard(text: string, path = 'arcs.md'): unknown {
  return parseEf4Kanban(parseEf4BoardDocument(text, path));
}

/** Replace supplied cards, remove absent cards, preserve all text outside their spans.
 * Unchanged cards retain their exact bytes. Archived cards are omitted by the caller. */
export function renderBoardDocument(text: string, records: IssueRecord[], path = 'arcs.md', preserveIds: string[] = []): string {
  const parsed = cards(text, path);
  const before = new Map<string,IssueRecord>();
  for(const item of parsed) {try {before.set(item.id,recordOf(item));}catch{ /* opaque preserved card */ }}
  const preserve = new Set(preserveIds);
  const wanted = new Map(records.map((r) => [r.id, r]));
  if (wanted.size !== records.length) throw new Error('duplicate card id in board write');
  const lines = text.split('\n');
  const offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length + 1);
  let result = text;
  for (const item of [...parsed].reverse()) {
    if (preserve.has(item.id)) { wanted.delete(item.id); continue; }
    const record = wanted.get(item.id);
    wanted.delete(item.id);
    if (record && JSON.stringify(record) === JSON.stringify(before.get(item.id))) continue;
    const start = offsets[item.lineStart! - 1]!;
    // The parser's raw is the exact span; it includes its trailing blank lines.
    result = result.slice(0, start) + (record ? renderBoardCard(record, item.level!, path) : '') + result.slice(start + item.raw!.length);
  }
  for (const record of wanted.values()) result += `${result.endsWith('\n\n') || !result ? '' : '\n'}${renderBoardCard(record, 2, path)}`;
  return result;
}

/** One card's section text at heading `level`, checked on its own: it reads back as exactly this
 * card, and a heading after it still starts a new section (no unclosed code block or HTML block
 * swallows what follows), so it can be spliced in place of the card's old span. */
export function renderBoardCard(record: IssueRecord, level = 2, path = 'arcs.md'): string {
  if (BOARD_WRITE_MODE === 'ef4') {
    // This whole writer/validation closure is the exact predecessor's. The additional semantic
    // guard refuses an otherwise accepted rendering that would change the record it represents.
    const text = renderEf4BoardCard(record, level, path);
    const read = parseEf4BoardDocument(text, path);
    if (read.length !== 1 || !sameRecord(record, read[0]!)) throw new Error(`board card ${record.id} cannot be represented unchanged by the ef4 writer`);
    if (boardEncodingSlot(text).marker !== undefined) throw new Error('legacy board writer cannot publish a reserved encoding slot');
    return text;
  }
  const text = renderCard(record, level);
  const items = cards(`${text}# end\n`, path);
  if (items.length !== 1 || items[0]!.id !== record.id) throw new Error('board rendering changed card identities');
  const read = recordOf(items[0]!);
  if (!sameRecord(record, read)) throw new Error(`board card ${record.id} would not read back unchanged`);
  if (items[0]!.raw !== text) throw new Error(`board card ${record.id} would run into the next section: its text holds a heading at the card's level or an unclosed code or HTML block`);
  return text;
}

/** A board document tiled into spans: each outermost card section (`id`), and the text between
 * them (`id: null`: the preamble and sections that are not cards). Joined, the spans are the
 * document. A card span starts at a heading, so it reads the same on its own. */
export type BoardChunk = { id: string | null; level: number; text: string };

export function chunkBoardDocument(text: string, path = 'arcs.md'): BoardChunk[] {
  const chunks = tile(text, path);
  if (chunks.map((chunk) => chunk.text).join('') !== text) throw new Error('board document spans do not tile its text');
  return chunks;
}

function tile(text: string, path: string): BoardChunk[] {
  const items = cards(text, path).filter((item) => item.raw !== undefined && item.lineStart !== undefined);
  const offsets = [0];
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) offsets.push(index + 1);
  const spans = items.map((item) => ({ id: item.id, level: item.level!, start: text.indexOf(item.raw!, offsets[item.lineStart! - 1]!), text: item.raw! }))
    .sort((a, b) => a.start - b.start);
  const chunks: BoardChunk[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start < at) continue; // nested inside an outer card's span
    if (span.start > at) chunks.push({ id: null, level: 0, text: text.slice(at, span.start) });
    chunks.push({ id: span.id, level: span.level, text: span.text });
    at = span.start + span.text.length;
  }
  if (at < text.length) chunks.push({ id: null, level: 0, text: text.slice(at) });
  return chunks;
}

/** Re-tile an edited document, parsing only the changed region: the spans holding the first and
 * last changed bytes, one span before them (an edit on a span's first line can join it to the
 * text before), and the first unchanged span after, which must read back unchanged or the region
 * grows. Old spans [from, oldTo) became new spans [from, to). */
export function rechunkBoardDocument(old: BoardChunk[], text: string, path = 'arcs.md'): { chunks: BoardChunk[]; from: number; oldTo: number; to: number } {
  const oldText = old.map((chunk) => chunk.text).join('');
  if (oldText === text) return { chunks: old, from: 0, oldTo: 0, to: 0 };
  if (!old.length) { const chunks = chunkBoardDocument(text, path); return { chunks, from: 0, oldTo: 0, to: chunks.length }; }
  const limit = Math.min(oldText.length, text.length);
  let prefix = 0;
  while (prefix < limit && oldText.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && oldText.charCodeAt(oldText.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)) suffix++;
  const starts: number[] = [];
  let offset = 0;
  for (const chunk of old) { starts.push(offset); offset += chunk.text.length; }
  const containing = (position: number): number => {
    let index = 0;
    while (index + 1 < old.length && starts[index + 1]! <= position) index++;
    return index;
  };
  const from = Math.max(0, containing(prefix) - 1);
  let last = containing(Math.max(prefix, oldText.length - suffix - 1));
  const delta = text.length - oldText.length;
  for (;;) {
    const region = text.slice(starts[from]!, starts[last]! + old[last]!.text.length + delta);
    const next = old[last + 1];
    const read = tile(region + (next?.text ?? ''), path);
    const tail = read.at(-1);
    const settled = !next || (tail !== undefined && tail.id === next.id && tail.level === next.level && tail.text === next.text);
    const replaced = next ? read.slice(0, -1) : read;
    if (!settled || replaced.map((chunk) => chunk.text).join('') !== region) {
      if (!next) throw new Error('board document spans do not tile its text');
      last++;
      continue;
    }
    return { chunks: [...old.slice(0, from), ...replaced, ...old.slice(last + 1)], from, oldTo: last + 1, to: from + replaced.length };
  }
}

function renderCard(record: IssueRecord, level: number): string {
  for (const value of [record.id, record.title, record.status, record.assignee ?? '']) {
    if (/[\r\n]/.test(value)) throw new Error('board headings and metadata must be single-line values');
  }
  return `${'#'.repeat(level)} ${record.id} — ${record.title}\n${BOARD_ENCODING_MARKER}\nstatus: ${record.status}\n${record.assignee ? `assignee: ${record.assignee}\n` : ''}\n${nestHeadings(record.body, level - 1).trimEnd()}\n\n`;
}

/** Read each card independently. A malformed card remains an opaque span for write-back. */
export function inspectBoardDocument(text: string, path = 'arcs.md'): { records: IssueRecord[]; errors: { id: string; reason: string }[] } {
  const records: IssueRecord[] = [], errors: { id: string; reason: string }[] = [];
  const items = cards(text, path);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  for (const item of items) {
    try {
      if (counts.get(item.id)! > 1) throw new Error('duplicate card identity');
      records.push(recordOf(item));
    } catch (error) { errors.push({ id: item.id, reason: String(error instanceof Error ? error.message : error) }); }
  }
  return { records, errors };
}

/** Three-way recovery: retain editor changes, applying only untouched card spans. */
export function mergeBoardDocument(base: string, current: string, desired: string, path = 'arcs.md', blockedIds: string[] = []): { text: string; conflicts: string[] } {
  const blocked = new Set(blockedIds);
  const spans = (text: string) => cards(text, path);
  const before = new Map(spans(base).map(item => [item.id, item.raw ?? '']));
  const wanted = new Map(spans(desired).map(item => [item.id, item.raw ?? '']));
  const currentItems = spans(current);
  const found = new Set(currentItems.map(item => item.id));
  const conflicts: string[] = [];
  const lines = current.split('\n'), offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length + 1);
  let text = current;
  for (const item of [...currentItems].reverse()) {
    if (blocked.has(item.id)) continue;
    const original = before.get(item.id), target = wanted.get(item.id);
    if (original === target || item.raw === target) continue;
    if (item.raw !== original) { conflicts.push(item.id); continue; }
    const start = offsets[item.lineStart! - 1]!;
    text = text.slice(0, start) + (target ?? '') + text.slice(start + item.raw!.length);
  }
  for (const [id, target] of wanted) {
    if (blocked.has(id) || found.has(id) || before.get(id) === target) continue;
    if (before.has(id)) { conflicts.push(id); continue; }
    text += `${text.endsWith('\n\n') || !text ? '' : '\n'}${target}`;
  }
  return { text, conflicts: [...new Set(conflicts)] };
}
