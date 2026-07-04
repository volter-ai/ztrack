import { beforeEach, describe, expect, test, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __resetTwinWorldRuntimeCacheForTest } from './worldTwinRuntime.ts';

// worldSourceBooks.ts had NO test file before ZTB-27 — closing that gap while also proving
// "surviving functionality still works with the peer present" (dev/01) now that
// `@volter-ai-dev/twin` is loaded lazily (see worldTwinRuntime.ts) instead of statically.
type Ev = { id: string; service: string; type: string; origin: string; occurredAt: string; subject: { id: string }; data?: Record<string, unknown>; external?: { id?: string; url?: string; provider?: string }; raw?: unknown; actor?: { id?: string; name?: string } };
let EVENTS: Ev[] = [];
mock.module('@volter-ai-dev/twin', () => ({
  DELTA_TYPE_SUFFIX: '.delta',
  isEgressEventType: (t: string) => t.endsWith('.egress'),
  worldStateRoot: (root?: string) => root ?? process.cwd(),
  listEvents: (service: string, _root?: string) => EVENTS.filter((e) => e.service === service),
  loadWorldConfig: (_root?: string) => ({ services: { slack: {} } }),
}));

const { loadWorldSourceBooks } = await import('./worldSourceBooks.ts');
const { createAnnotation } = await import('./worldAnnotations.ts');

// See worldAnnotations.test.ts for why this reset is needed: loadTwinWorldRuntime() memoizes
// the twin module process-wide, so another test file's successful load (with ITS OWN `EVENTS`
// closure) would otherwise leak into this file's assertions.
beforeEach(() => { __resetTwinWorldRuntimeCacheForTest(); });

function tempWorld(services: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'zt-world-sb-'));
  for (const service of services) mkdirSync(join(root, service), { recursive: true });
  return root;
}

describe('loadWorldSourceBooks', () => {
  test('a "source"-classified event becomes a message; its annotation folds into the source book', async () => {
    const root = tempWorld(['slack']);
    EVENTS = [
      { id: 'e1', service: 'slack', type: 'message', origin: 'external', occurredAt: '2026-01-01T00:00:00Z', subject: { id: 'e1' }, data: { text: 'please add a logout button', channel: 'C1', ts: '100.1' } },
    ];
    const annotation = createAnnotation({ id: 'a1', service: 'slack', eventId: 'e1', classification: 'source', annotator: 'agent', quote: 'logout button' });
    writeFileSync(join(root, 'slack', 'annotations.jsonl'), `${JSON.stringify(annotation)}\n`);

    const books = await loadWorldSourceBooks(root);
    expect(books.messages).toHaveLength(1);
    expect(books.messages[0]).toMatchObject({ text: 'please add a logout button', channel: 'C1', source: 'slack' });
    expect(books.annotations).toHaveLength(1);
    expect(books.annotations[0]).toMatchObject({ classification: 'source', world_annotation_id: 'a1', world_event_id: 'e1' });
  });

  test('a "noise"-classified event is excluded from the source book', async () => {
    const root = tempWorld(['slack']);
    EVENTS = [
      { id: 'e1', service: 'slack', type: 'message', origin: 'external', occurredAt: '2026-01-01T00:00:00Z', subject: { id: 'e1' }, data: { text: 'lol nice', channel: 'C1', ts: '100.1' } },
    ];
    const annotation = createAnnotation({ id: 'a1', service: 'slack', eventId: 'e1', classification: 'noise', annotator: 'agent' });
    writeFileSync(join(root, 'slack', 'annotations.jsonl'), `${JSON.stringify(annotation)}\n`);

    const books = await loadWorldSourceBooks(root);
    expect(books.messages).toEqual([]);
    expect(books.annotations).toEqual([]);
  });

  test('an unrelated service with no world dir contributes nothing (no crash)', async () => {
    const root = tempWorld([]);
    EVENTS = [];
    const books = await loadWorldSourceBooks(root);
    expect(books).toEqual({ messages: [], annotations: [] });
  });
});
