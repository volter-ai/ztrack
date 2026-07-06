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

  // ZTB-22 dev/02: `organization.lint.rules` was documented (lint.ts:5-6) and read (lint.ts:92)
  // but absent from this schema — every config using the documented knob was rejected as an
  // unknown key. `rules`' own keys are arbitrary rule names (not enumerated in KNOWN_KEYS).
  test('`organization.lint.rules` (documented in lint.ts) loads without an unknown-key rejection', () => {
    const root = project({
      backend: 'markdown',
      organization: { lint: { rules: { 'todo-marker': 'off' } } },
    });
    expect(loadTrackerConfig(root).organization).toEqual({ lint: { rules: { 'todo-marker': 'off' } } });
  });

  test('an unrecognized key under `organization.lint` still throws', () => {
    const root = project({ backend: 'markdown', organization: { lint: { wat: true } } });
    expect(() => loadTrackerConfig(root)).toThrow(/unknown key "wat" at "organization\.lint"/);
  });
});

describe('resolveSources (ZTB-3)', () => {
  test('absent `sources` resolves to exactly the implicit default — byte-identical to markdownStoreDir()', () => {
    const root = project({ backend: 'markdown', local: { teamKey: 'APP' } });
    const resolved = resolveSources(root, loadTrackerConfig(root));
    expect(resolved).toEqual([{ dir: markdownStoreDir(root), format: 'issue-per-file', readonly: false, isDefault: true, name: 'default' }]);
  });

  test('declared sources resolve project-root-relative paths to absolute dirs, and mark the default-path entry isDefault', () => {
    const root = project({
      backend: 'markdown',
      sources: [{ path: '.volter/tracker/markdown' }, { path: 'external', readonly: true }],
    });
    const resolved = resolveSources(root, loadTrackerConfig(root));
    expect(resolved).toEqual([
      { dir: markdownStoreDir(root), format: 'issue-per-file', readonly: false, isDefault: true, name: '.volter/tracker/markdown' },
      { dir: join(root, 'external'), format: 'issue-per-file', readonly: true, isDefault: false, name: 'external' },
    ]);
  });

  // ZTB-4 dev/08 + dev/09: `document` sources resolve (both read and write-back are implemented)
  // instead of failing closed — see src/documentParser.ts / src/backends/documentSource.ts.
  test('a `.md` file source defaults to format "document" and resolves (ZTB-4) — `dir` names the FILE', () => {
    const root = project({ backend: 'markdown', sources: [{ path: 'BACKLOG.md' }] });
    const resolved = resolveSources(root, loadTrackerConfig(root));
    expect(resolved).toEqual([{ dir: join(root, 'BACKLOG.md'), format: 'document', readonly: false, isDefault: false, name: 'BACKLOG.md' }]);
  });

  test('an explicit format: "document" on a non-.md path resolves the same way (declared, not inferred)', () => {
    const root = project({ backend: 'markdown', sources: [{ path: 'somedir', format: 'document' }] });
    const resolved = resolveSources(root, loadTrackerConfig(root));
    expect(resolved).toEqual([{ dir: join(root, 'somedir'), format: 'document', readonly: false, isDefault: false, name: 'somedir' }]);
  });

  // ZTB-33 dev/54: each declared source carries a stable `--source` selector name — the config
  // `name` when given, else the declared `path` verbatim, else 'default' for the implicit source.
  test('ResolvedSource.name is the config name when declared, else the path, else "default"', () => {
    const root = project({
      backend: 'markdown',
      sources: [{ path: 'docs/backlog.md', name: 'backlog' }, { path: '.volter/tracker/markdown' }],
    });
    const resolved = resolveSources(root, loadTrackerConfig(root));
    expect(resolved.map((s) => s.name)).toEqual(['backlog', '.volter/tracker/markdown']);
    // and the implicit single source (no `sources`) is 'default'
    const bare = project({ backend: 'markdown' });
    expect(resolveSources(bare, loadTrackerConfig(bare)).map((s) => s.name)).toEqual(['default']);
  });
});

describe('resolveSources — dialect sources (docs/DIALECTS.md)', () => {
  test('a named dialect resolves from the registry and forces readonly', () => {
    const root = project({ backend: 'markdown', sources: [{ dialect: 'emoji-register', path: 'PLAN.md' }] });
    const [source] = resolveSources(root, loadTrackerConfig(root));
    expect(source!.dialectName).toBe('emoji-register');
    expect(source!.dialect?.issueBoundary).toBe('heading');
    expect(source!.readonly).toBe(true);   // implied, not declared
    expect(source!.format).toBe('document');
  });

  test('an inline dialect object validates and resolves as name "inline"', () => {
    const root = project({
      backend: 'markdown',
      sources: [{
        dialect: {
          hierarchy: 'flat', idPattern: 'T\\d+', issueBoundary: 'heading',
          status: { at: 'field-bullet', label: 'State', vocabulary: { OPEN: 'ready' } },
        },
        path: 'PLAN.md',
      }],
    });
    const [source] = resolveSources(root, loadTrackerConfig(root));
    expect(source!.dialectName).toBe('inline');
    expect(source!.dialect?.idPattern).toBe('T\\d+');
  });

  test('an unknown dialect name fails closed, naming the available set', () => {
    const root = project({ backend: 'markdown', sources: [{ dialect: 'klingon', path: 'PLAN.md' }] });
    expect(() => resolveSources(root, loadTrackerConfig(root))).toThrow(/unknown dialect 'klingon'/);
  });

  test('dialect on a non-document source fails closed', () => {
    const root = project({ backend: 'markdown', sources: [{ dialect: 'emoji-register', format: 'issue-per-file', path: 'issues' }] });
    expect(() => resolveSources(root, loadTrackerConfig(root))).toThrow(/dialect requires format "document"/);
  });

  test('explicit readonly: false beside dialect is a contradiction, refused', () => {
    const root = project({ backend: 'markdown', sources: [{ dialect: 'emoji-register', path: 'PLAN.md', readonly: false }] });
    expect(() => resolveSources(root, loadTrackerConfig(root))).toThrow(/always readonly/);
  });

  test('a malformed inline dialect is rejected by the config schema itself', () => {
    const root = project({ backend: 'markdown', sources: [{ dialect: { bogus: true }, path: 'PLAN.md' }] });
    expect(() => loadTrackerConfig(root)).toThrow();
  });
});
