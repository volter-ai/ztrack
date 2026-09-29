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
export function renderBoardDocument(text: string, records: IssueRecord[], path = 'arcs.md'): string {
  const parsed = parseMarkdownDocumentSource(text, path);
  const before = new Map(parseBoardDocument(text, path).map((r) => [r.id, r]));
  const wanted = new Map(records.map((r) => [r.id, r]));
  if (wanted.size !== records.length) throw new Error('duplicate card id in board write');
  const lines = text.split('\n');
  const offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length + 1);
  let result = text;
  for (const item of [...parsed].reverse()) {
    const record = wanted.get(item.id);
    wanted.delete(item.id);
    if (record && JSON.stringify(record) === JSON.stringify(before.get(item.id))) continue;
    const start = offsets[item.lineStart! - 1]!;
    // The parser's raw is the exact span; it includes its trailing blank lines.
    result = result.slice(0, start) + (record ? renderCard(record, item.level!) : '') + result.slice(start + item.raw!.length);
  }
  for (const record of wanted.values()) result += `${result.endsWith('\n\n') || !result ? '' : '\n'}${renderCard(record, 2)}`;
  // Refuse malformed headings or prose which accidentally creates another card.
  const reread = parseBoardDocument(result, path);
  if (reread.length !== records.length || reread.some((r) => !records.some((want) => want.id === r.id))) throw new Error('board rendering changed card identities');
  return result;
}

function renderCard(record: IssueRecord, level: number): string {
  for (const value of [record.id, record.title, record.status, record.assignee ?? '']) {
    if (/[\r\n]/.test(value)) throw new Error('board headings and metadata must be single-line values');
  }
  return `${'#'.repeat(level)} ${record.id} — ${record.title}\nstatus: ${record.status}\n${record.assignee ? `assignee: ${record.assignee}\n` : ''}\n${shiftHeadings(record.body, level - 1).trimEnd()}\n\n`;
}
