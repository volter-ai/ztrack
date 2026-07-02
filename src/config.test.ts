// ZTB-3: config parsing used to be entirely unvalidated (JSON.parse + spread) — a typo'd key
// (`source:` for `sources:`) silently preserved and ignored. These pin the fail-closed contract:
// every real config shape this repo produces still loads; any unrecognized key (top-level or
// nested) is a thrown config error naming the key.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTrackerConfig, markdownStoreDir, stateDirName, trackerConfigPath } from './config.ts';
import { resolveSources } from './sources.ts';

function project(config: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-cfg-'));
  mkdirSync(join(root, stateDirName()), { recursive: true });
  writeFileSync(trackerConfigPath(root), JSON.stringify(config, null, 2));
  return root;
}

describe('loadTrackerConfig — shape validation (ZTB-3)', () => {
  test('the exact shape `ztrack init` writes (backend/local/validation/organization.check) loads', () => {
    const root = project({
      backend: 'markdown',
      local: { teamKey: 'APP' },
      validation: { entrypoint: '.volter/tracker/validation/preset.mts', installedFrom: 'simple-sdlc' },
      organization: { check: { categories: { sourced: 1, code: 2 } } },
      board: 'shared',
    });
    expect(loadTrackerConfig(root)).toMatchObject({ backend: 'markdown', local: { teamKey: 'APP' }, board: 'shared' });
  });

  test('a linked (--sync) config loads, ignoring `board` semantics but not the key', () => {
    const root = project({
      backend: 'markdown',
      local: { teamKey: 'APP' },
      validation: { entrypoint: 'x', installedFrom: 'simple-sdlc' },
      organization: { check: { categories: { sourced: 1 } } },
      sync: { provider: 'github', repo: 'owner/name', policy: 'merge' },
    });
    expect(loadTrackerConfig(root).sync).toEqual({ provider: 'github', repo: 'owner/name', policy: 'merge' });
  });

  test('every documented field (types.ts inventory) validates together', () => {
    const root = project({
      backend: 'markdown',
      local: { teamKey: 'APP', database: '.volter/tracker/tracker.sqlite', store: '.volter/tracker/markdown' },
      sources: [
        { path: '.volter/tracker/markdown' },
        { path: 'imported-issues', readonly: true },
        { path: 'other-issues', format: 'issue-per-file' },
      ],
      board: 'branch',
      evidence: { store: 'commit', dir: '.volter/evidence' },
      relevance: 'required',
      validation: { entrypoint: 'x', installedFrom: 'simple-sdlc' },
      organization: {
        validationPreset: 'legacy',
        externalBrowseUrls: { jira: 'https://example.atlassian.net/browse/{id}' },
        caseTypeLabels: ['type:case'],
        grammar: { extends: 'simple-sdlc', slotAliases: { acceptanceCriteria: ['Done When'] } },
        check: {
          categories: { sourced: 1, code: 2 },
          profiles: ['strict'],
          verify: [{ matchTypes: ['bug'], matchLabels: ['P0'], inspect: false, categories: { sourced: 2 } }],
        },
      },
    });
    expect(loadTrackerConfig(root).sources).toHaveLength(3);
  });

  test('missing `backend` (never written by legacy configs) still coerces to markdown', () => {
    const root = project({ local: { teamKey: 'APP' } });
    expect(loadTrackerConfig(root).backend).toBe('markdown');
  });

  test('a top-level typo\'d key throws, naming the key and the nearest valid one', () => {
    const root = project({ backend: 'markdown', source: [{ path: 'x' }] });
    expect(() => loadTrackerConfig(root)).toThrow(/unknown key "source"/);
    expect(() => loadTrackerConfig(root)).toThrow(/did you mean "sources"/);
  });

  test('a nested typo\'d key throws, naming the key at its nested path', () => {
    const root = project({ backend: 'markdown', local: { teamKy: 'APP' } });
    expect(() => loadTrackerConfig(root)).toThrow(/unknown key "teamKy" at "local"/);
    expect(() => loadTrackerConfig(root)).toThrow(/did you mean "teamKey"/);
  });

  test('a typo inside a sources[] entry is named at the "sources[]" template path', () => {
    const root = project({ backend: 'markdown', sources: [{ path: 'x', raedonly: true }] });
    expect(() => loadTrackerConfig(root)).toThrow(/unknown key "raedonly" at "sources\[\]"/);
  });

  test('a typo inside organization.check.verify[] is named at its nested template path', () => {
    const root = project({ backend: 'markdown', organization: { check: { verify: [{ matchTyps: ['bug'] }] } } });
    expect(() => loadTrackerConfig(root)).toThrow(/unknown key "matchTyps" at "organization\.check\.verify\[\]"/);
  });

  test('an invalid enum value is reported too (not just unrecognized keys)', () => {
    const root = project({ backend: 'markdown', board: 'nope' });
    expect(() => loadTrackerConfig(root)).toThrow(/board/);
  });
});

describe('resolveSources (ZTB-3)', () => {
  test('absent `sources` resolves to exactly the implicit default — byte-identical to markdownStoreDir()', () => {
    const root = project({ backend: 'markdown', local: { teamKey: 'APP' } });
    const resolved = resolveSources(root, loadTrackerConfig(root));
    expect(resolved).toEqual([{ dir: markdownStoreDir(root), format: 'issue-per-file', readonly: false, isDefault: true }]);
  });

  test('declared sources resolve project-root-relative paths to absolute dirs, and mark the default-path entry isDefault', () => {
    const root = project({
      backend: 'markdown',
      sources: [{ path: '.volter/tracker/markdown' }, { path: 'external', readonly: true }],
    });
    const resolved = resolveSources(root, loadTrackerConfig(root));
    expect(resolved).toEqual([
      { dir: markdownStoreDir(root), format: 'issue-per-file', readonly: false, isDefault: true },
      { dir: join(root, 'external'), format: 'issue-per-file', readonly: true, isDefault: false },
    ]);
  });

  // ZTB-4 dev/08: `document` sources resolve (the read path is implemented) instead of failing
  // closed — see src/documentParser.ts / src/backends/documentSource.ts. Write-back is dev/09.
  test('a `.md` file source defaults to format "document" and resolves (ZTB-4) — `dir` names the FILE', () => {
    const root = project({ backend: 'markdown', sources: [{ path: 'BACKLOG.md' }] });
    const resolved = resolveSources(root, loadTrackerConfig(root));
    expect(resolved).toEqual([{ dir: join(root, 'BACKLOG.md'), format: 'document', readonly: false, isDefault: false }]);
  });

  test('an explicit format: "document" on a non-.md path resolves the same way (declared, not inferred)', () => {
    const root = project({ backend: 'markdown', sources: [{ path: 'somedir', format: 'document' }] });
    const resolved = resolveSources(root, loadTrackerConfig(root));
    expect(resolved).toEqual([{ dir: join(root, 'somedir'), format: 'document', readonly: false, isDefault: false }]);
  });
});
