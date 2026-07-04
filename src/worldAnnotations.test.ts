import { beforeEach, describe, expect, test, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __resetTwinWorldRuntimeCacheForTest } from './worldTwinRuntime.ts';

// The world adapters read the mirrored world through @volter-ai-dev/twin's generic surface.
// twin is an OPTIONAL peer (absent in this standalone repo), so stub its surface to
// exercise the adapters' own logic (annotation CRUD + integrity validation). This proves
// "surviving functionality still works with the peer present" (ZTB-27 dev/01) — the peer is
// loaded lazily now (see worldTwinRuntime.ts), so every call below is async.
type Ev = { id: string; service: string; type: string; origin: string; occurredAt: string; subject?: unknown; data?: Record<string, unknown>; external?: { id?: string; url?: string }; raw?: unknown };
let EVENTS: Ev[] = [];
mock.module('@volter-ai-dev/twin', () => ({
  DELTA_TYPE_SUFFIX: '.delta',
  isEgressEventType: (t: string) => t.endsWith('.egress'),
  worldStateRoot: (root?: string) => root ?? process.cwd(), // annotations live at <root>/<service>/annotations.jsonl
  listEvents: (service: string, _root?: string) => EVENTS.filter((e) => e.service === service),
  loadWorldConfig: (_root?: string) => ({ services: { slack: {} } }),
}));

const { createAnnotation, addAnnotation, listAnnotations, validateServiceAnnotations } = await import('./worldAnnotations.ts');

// `loadTwinWorldRuntime()` memoizes the twin module after its first successful load — process-
// wide, since ES modules are singletons. Reset it before every test so this file's `EVENTS`
// closure is always the one actually consulted, regardless of what other test files (also
// mocking or exercising `@volter-ai-dev/twin`) ran first in the same `bun test` process.
beforeEach(() => { __resetTwinWorldRuntimeCacheForTest(); });

function tempWorld(): string {
  const root = mkdtempSync(join(tmpdir(), 'zt-world-'));
  mkdirSync(join(root, 'slack'), { recursive: true });
  return root;
}
const ann = (over: Record<string, unknown> = {}) => createAnnotation({ id: 'a1', service: 'slack', eventId: 'e1', classification: 'source', annotator: 'agent', ...over });

describe('worldAnnotations CRUD', () => {
  test('addAnnotation appends, is idempotent on id, and refuses a missing event', async () => {
    const root = tempWorld();
    EVENTS = [{ id: 'e1', service: 'slack', type: 'message', origin: 'external', occurredAt: '2026-01-01T00:00:00Z', data: {} }];
    await addAnnotation(ann(), root);
    await addAnnotation(ann(), root); // idempotent
    expect(await listAnnotations('slack', root)).toHaveLength(1);
    await expect(addAnnotation(ann({ id: 'a2', eventId: 'missing' }), root)).rejects.toThrow(/missing/i);
  });
});

describe('validateServiceAnnotations', () => {
  test('clean: annotated event with a resolvable quote → no errors', async () => {
    const root = tempWorld();
    EVENTS = [{ id: 'e1', service: 'slack', type: 'message', origin: 'external', occurredAt: '2026-01-01T00:00:00Z', data: { text: 'please add a logout button' } }];
    writeFileSync(join(root, 'slack', 'annotations.jsonl'), JSON.stringify(ann({ quote: 'logout button', createdAt: '2026-01-01T00:00:00Z' })) + '\n');
    const findings = await validateServiceAnnotations(root, 'slack');
    expect(findings.filter((f) => f.level === 'error')).toEqual([]);
  });

  test('an unannotated event yields a warning, not an error', async () => {
    const root = tempWorld();
    EVENTS = [{ id: 'e1', service: 'slack', type: 'message', origin: 'external', occurredAt: '2026-01-01T00:00:00Z', data: { text: 'x' } }];
    writeFileSync(join(root, 'slack', 'annotations.jsonl'), '');
    const findings = await validateServiceAnnotations(root, 'slack');
    expect(findings.some((f) => f.code === 'event_unannotated' && f.level === 'warning')).toBe(true);
  });

  test('an annotation referencing a missing event is an error', async () => {
    const root = tempWorld();
    EVENTS = [];
    writeFileSync(join(root, 'slack', 'annotations.jsonl'), JSON.stringify(ann({ eventId: 'gone', createdAt: '2026-01-01T00:00:00Z' })) + '\n');
    const findings = await validateServiceAnnotations(root, 'slack');
    expect(findings.some((f) => f.code === 'annotation_event_missing')).toBe(true);
  });

  test('a quote not present in the event payload is an error', async () => {
    const root = tempWorld();
    EVENTS = [{ id: 'e1', service: 'slack', type: 'message', origin: 'external', occurredAt: '2026-01-01T00:00:00Z', data: { text: 'hello world' } }];
    writeFileSync(join(root, 'slack', 'annotations.jsonl'), JSON.stringify(ann({ quote: 'not in payload', createdAt: '2026-01-01T00:00:00Z' })) + '\n');
    const findings = await validateServiceAnnotations(root, 'slack');
    expect(findings.some((f) => f.code === 'annotation_quote_missing_from_event')).toBe(true);
  });

  test('a malformed JSONL line is reported, not crashed on', async () => {
    const root = tempWorld();
    EVENTS = [{ id: 'e1', service: 'slack', type: 'message', origin: 'external', occurredAt: '2026-01-01T00:00:00Z', data: {} }];
    writeFileSync(join(root, 'slack', 'annotations.jsonl'), '{ this is not json\n');
    const findings = await validateServiceAnnotations(root, 'slack');
    expect(findings.some((f) => f.code === 'annotation_malformed_json')).toBe(true);
  });
});
