import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { auditPath } from './core/audit.ts';
import { cacheRoot, markdownStoreDir, trackerConfigPath } from './config.ts';
import { initTrackerProject } from './presetCatalog.ts';
import { createTrackerClient } from './sdk.ts';
import { loadVisualizerPayload } from './visualizerPayload.ts';

const repo = resolve(import.meta.dir, '..');
const roots: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'ztrack-visualizer-payload-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(repo, join(root, 'node_modules', 'ztrack'));
  initTrackerProject(root, 'ZT', { board: 'branch' });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('loadVisualizerPayload', () => {
  test('builds the configured preset board and returns every file boundary a host must watch', async () => {
    const root = project();
    const client = createTrackerClient({ projectRoot: root });
    await client.issue.create({ title: 'First issue', assignee: 'me', labels: ['type:case'] });

    const { payload, watchPaths } = await loadVisualizerPayload({ projectRoot: root });
    expect(payload.preset).toBe('simple-sdlc');
    expect(payload.issues.map((issue) => issue.id)).toEqual(['ZT-1']);
    expect(payload.projectDir).toBe(resolve(root));
    expect(payload.fetchedAt).toBeTruthy();
    expect(payload.trackerChangedAt).toBeTruthy();
    expect(watchPaths).toContain(trackerConfigPath(root));
    expect(watchPaths).toContain(markdownStoreDir(root));
    expect(watchPaths).toContain(join(markdownStoreDir(root), 'ZT-1.md'));
    expect(watchPaths).toContain(auditPath(cacheRoot(root)));
    expect(watchPaths).toContain(resolve(root, '.volter/tracker/validation/preset.mts'));
  });

  test('uses the same builder for a declared document source and reports that document as watched', async () => {
    const root = project();
    const documentPath = join(root, 'tasks.md');
    writeFileSync(documentPath, '# Tasks\n\n## DOC-1 — Document issue\n\nSummary: from a document source.\n');
    const config = JSON.parse(readFileSync(trackerConfigPath(root), 'utf8')) as Record<string, unknown>;
    config.sources = [{ path: 'tasks.md', format: 'document', readonly: true }];
    writeFileSync(trackerConfigPath(root), `${JSON.stringify(config, null, 2)}\n`);

    const { payload, watchPaths } = await loadVisualizerPayload({ projectRoot: root });
    expect(payload.issues.map((issue) => issue.id)).toContain('DOC-1');
    expect(watchPaths).toContain(documentPath);
  });

  test('invalid visualizer data degrades to null with a precise error', async () => {
    const root = project();
    const presetPath = join(root, '.volter/tracker/validation/preset.mts');
    const source = readFileSync(presetPath, 'utf8');
    writeFileSync(presetPath, source.replace(
      "acUnitLabel: 'Dev ACs',",
      "acUnitLabel: 'Dev ACs',\n    unknownRenderer: 'nope',",
    ));
    const { payload } = await loadVisualizerPayload({ projectRoot: root });
    expect(payload.visualizer).toBeNull();
    expect(payload.visualizerError).toContain('unknownRenderer');
  });
});
