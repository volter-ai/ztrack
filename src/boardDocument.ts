/** A board's document codec, shared by ztrack and supercode's document backing.
 * Callers own the file's hash/transaction; this module only parses and renders text. */
import { parseMarkdownDocumentSource } from './documentParser.ts';
import { decomposeSection, shiftHeadings } from './documentWriteBack.ts';
import type { IssueRecord } from './core/engine.ts';

export function parseBoardDocument(text: string, path = 'arcs.md'): IssueRecord[] {
  return parseMarkdownDocumentSource(text, path).map((item) => {
    if (!item.raw || !item.level || item.children.length) throw new Error(`board card ${item.id} must be one flat document section`);
    const section = decomposeSection(item.raw);
    if (section.discardedHeaderLine) throw new Error(`malformed header for ${item.id}: ${section.discardedHeaderLine}`);
    return { id: item.id, title: item.title, status: section.header?.status ?? 'todo',
      ...(section.header?.assignee ? { assignee: section.header.assignee } : {}),
      body: shiftHeadings(section.middle, 1 - item.level) };
  });
}

/** Replace supplied cards, remove absent cards, preserve all text outside their spans.
 * Unchanged cards retain their exact bytes. Archived cards are omitted by the caller. */
export function renderBoardDocument(text: string, records: IssueRecord[], path = 'arcs.md', preserveIds: string[] = []): string {
  const parsed = parseMarkdownDocumentSource(text, path);
  const before = new Map(inspectBoardDocument(text, path).records.map((r) => [r.id, r]));
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
    result = result.slice(0, start) + (record ? renderCard(record, item.level!) : '') + result.slice(start + item.raw!.length);
  }
  for (const record of wanted.values()) result += `${result.endsWith('\n\n') || !result ? '' : '\n'}${renderCard(record, 2)}`;
  // Refuse malformed headings or prose which accidentally creates another card.
  const reread = inspectBoardDocument(result, path).records.filter(r => !preserve.has(r.id));
  const expected = records.filter(r => !preserve.has(r.id));
  if (reread.length !== expected.length || reread.some((r) => !expected.some((want) => want.id === r.id))) throw new Error('board rendering changed card identities');
  return result;
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
      const parsed = parseBoardDocument(item.raw ?? '', path);
      if (parsed.length !== 1) throw new Error('card must occupy one flat section');
      records.push(parsed[0]!);
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
