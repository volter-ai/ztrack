/** A board's document codec, shared by ztrack and supercode's document backing.
 * Callers own the file's hash/transaction; this module only parses and renders text. */
import { parseMarkdownDocumentSource, type DocumentParsedIssue } from './documentParser.ts';
import { decomposeSection, shiftHeadings } from './documentWriteBack.ts';
import type { IssueRecord } from './core/engine.ts';

function recordOf(item: DocumentParsedIssue): IssueRecord {
  if (!item.raw || !item.level || item.children.length) throw new Error(`board card ${item.id} must be one flat document section`);
  const section = decomposeSection(item.raw);
  if (section.discardedHeaderLine) throw new Error(`malformed header for ${item.id}: ${section.discardedHeaderLine}`);
  return {id:item.id,title:item.title,status:section.header?.status??'todo',...(section.header?.assignee?{assignee:section.header.assignee}:{}),body:shiftHeadings(section.middle,1-item.level)};
}
export function parseBoardDocument(text: string, path = 'arcs.md'): IssueRecord[] {
  return parseMarkdownDocumentSource(text,path).map(recordOf);
}

/** Replace supplied cards, remove absent cards, preserve all text outside their spans.
 * Unchanged cards retain their exact bytes. Archived cards are omitted by the caller. */
export function renderBoardDocument(text: string, records: IssueRecord[], path = 'arcs.md', preserveIds: string[] = []): string {
  const parsed = parseMarkdownDocumentSource(text, path);
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
  const text = renderCard(record, level);
  const items = parseMarkdownDocumentSource(`${text}# end\n`, path);
  if (items.length !== 1 || items[0]!.id !== record.id) throw new Error('board rendering changed card identities');
  recordOf(items[0]!);
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
  const items = parseMarkdownDocumentSource(text, path).filter((item) => item.raw !== undefined && item.lineStart !== undefined);
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
  return `${'#'.repeat(level)} ${record.id} — ${record.title}\nstatus: ${record.status}\n${record.assignee ? `assignee: ${record.assignee}\n` : ''}\n${shiftHeadings(record.body, level - 1).trimEnd()}\n\n`;
}

/** Read each card independently. A malformed card remains an opaque span for write-back. */
export function inspectBoardDocument(text: string, path = 'arcs.md'): { records: IssueRecord[]; errors: { id: string; reason: string }[] } {
  const records: IssueRecord[] = [], errors: { id: string; reason: string }[] = [];
  const items = parseMarkdownDocumentSource(text, path);
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
  const spans = (text: string) => parseMarkdownDocumentSource(text, path);
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
