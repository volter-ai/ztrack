import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownBackend } from './backends/markdownBackend.ts';
import { serializeIssue, type CanonicalIssue } from './backends/markdown.ts';
import { markdownStoreDir } from './config.ts';
import { collectConfiguredIds } from './importDriver.ts';
import { IdAllocator } from './idAllocator.ts';

const rawIssue = (identifier: string): CanonicalIssue => ({
  identifier, title: 't', body: 'b', state: 'Backlog', stateType: 'open', assignees: [], labels: [],
  project: null, parent: null, children: [], branchName: '', priority: 0, devProgress: '',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', completedAt: null, canceledAt: null, url: '',
  comments: [],
});

// ZTB-28 dev/02: both `backends/markdownBackend.ts`'s `issue create` handler and
// `importBacklog.ts`'s batch importer mint ids through the ONE shared `IdAllocator`
// (idAllocator.ts) now — this pins that, given the SAME tracker state, both paths mint the
// SAME next id. Before this work order they were two independently-maintained copies of the
// same rule (a live inline reduce in markdownBackend.ts, this class in importBacklog.ts).
describe('id minting: markdownBackend and the import allocator agree', () => {
  test('same next id for a tracker with mixed-prefix, non-sequential existing ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idalloc-'));
    const be = createMarkdownBackend(dir, 'PH');

    // Seed the store: PH-1 (via the real create path) plus a higher-numbered, DIFFERENT-prefix
    // issue written directly (simulating a doc/registered source) — proves the rule is "max
    // suffix across every prefix", not scoped to the mint target's own teamKey.
    const created1 = JSON.parse((await be.command(['issue', 'create', '--title', 'A'])).stdout);
    expect(created1.identifier).toBe('PH-1');
    writeFileSync(join(markdownStoreDir(dir), 'APP-50.md'), serializeIssue(rawIssue('APP-50')));

    // Path 2 first: predict, from the pre-mint tracker state (PH-1 + APP-50), what the importer's
    // allocator would mint next for prefix 'PH'.
    const allocator = new IdAllocator();
    for (const id of collectConfiguredIds(dir, {})) allocator.note(id);
    const predicted = allocator.next('PH');

    // Path 1: the real `issue create` mint, from that same pre-mint state.
    const created2 = JSON.parse((await be.command(['issue', 'create', '--title', 'B'])).stdout);

    expect(created2.identifier).toBe('PH-51'); // max suffix seen (50, from APP-50) + 1
    expect(predicted).toBe(created2.identifier);
  });
});
