// ZTB-14 dev/33: e2e proof with the REAL CLI (spawnSync, mktemp project — same style as
// documentSource.e2e.test.ts / sourcesConfig.e2e.test.ts): import a messy fixture, register it as
// a source, load as the expected hierarchy, `ztrack check` green, and `ac patch` on an imported AC
// splice-writes correctly with check staying green — proving the materialized output is a
// first-class document source, not a special case.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const runIn = (cwd: string, cmd: string, args: string[]) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const gitIn = (cwd: string, ...a: string[]) => runIn(cwd, 'git', a);
const ztIn = (cwd: string, ...a: string[]) => { const r = runIn(cwd, 'bun', ['run', CLI, ...a]); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const configPath = (root: string) => join(root, '.volter', 'tracker-config.json');
const J = (r: { out: string }): unknown => JSON.parse(r.out);

const MESSY_BACKLOG = readFileSync(join(REPO, 'src', 'importBacklog.fixtures', 'mixed-prose-checkboxes.input.md'), 'utf8');

let root = '';
let rootReal = '';
const backlogPath = () => join(rootReal, 'backlog.md');

describe('ztrack import (ZTB-14 dev/33): the real CLI, a mktemp project, first-class document-source proof', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-import-e2e-'));
    rootReal = realpathSync(root);
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    gitIn(root, 'init', '-q'); gitIn(root, 'config', 'user.email', 't@t.co'); gitIn(root, 'config', 'user.name', 't');
    expect(ztIn(root, 'init', '--team', 'APP').code).toBe(0);
    writeFileSync(backlogPath(), MESSY_BACKLOG);
    gitIn(root, 'add', '-A'); gitIn(root, 'commit', '-q', '-m', 'seed');
  }, 60_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('1. --dry-run writes nothing', () => {
    const before = readFileSync(backlogPath(), 'utf8');
    const dry = ztIn(root, 'import', 'backlog.md', '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('materialized');
    expect(readFileSync(backlogPath(), 'utf8')).toBe(before);
  });

  test('2. a real import (no --register) materializes the file but leaves tracker-config.json byte-untouched', () => {
    const cfgBefore = readFileSync(configPath(root), 'utf8');
    const result = ztIn(root, 'import', 'backlog.md');
    expect(result.code).toBe(0);
    expect(result.out).toContain('materialized (3 issues, 4 ACs)');
    expect(readFileSync(configPath(root), 'utf8')).toBe(cfgBefore); // no --register -> config untouched
    const materialized = readFileSync(backlogPath(), 'utf8');
    expect(materialized).toMatch(/^# APP-1 Team backlog/);
    expect(materialized).toContain('## APP-2 Improve onboarding flow');
    expect(materialized).toContain('## APP-3 Speed up CI');
    expect(materialized).toContain('- [ ] dev/01 v1 Add a welcome email');
    // the pre-checked source item imported UNCHECKED, with the preserved-claim marker
    expect(materialized).toContain('- [ ] dev/03 v1 Write the onboarding doc (imported: previously marked done — needs evidence)');
    expect(materialized).not.toMatch(/- \[x\]/);
  });

  test('3. re-running import on the now-materialized file is a no-op (idempotent through the real CLI too)', () => {
    const before = readFileSync(backlogPath(), 'utf8');
    const result = ztIn(root, 'import', 'backlog.md');
    expect(result.code).toBe(0);
    expect(result.out).toContain('no-op (already canonical)');
    expect(readFileSync(backlogPath(), 'utf8')).toBe(before);
  });

  test('4. --register appends exactly the printed sources entry and is itself idempotent (no duplicate on a second run)', () => {
    const result = ztIn(root, 'import', 'backlog.md', '--register');
    expect(result.code).toBe(0);
    expect(result.out).toContain('registered');
    const cfg = J({ out: readFileSync(configPath(root), 'utf8') }) as { sources?: Array<{ path: string; format?: string }> };
    expect(cfg.sources).toContainEqual({ path: 'backlog.md', format: 'document' });
    // default store made explicit too (sources was previously absent) — see importDriver.ts's
    // planRegister safety note: registering must never silently stop reading the pre-existing store.
    expect(cfg.sources!.some((s) => s.path.includes('tracker/markdown'))).toBe(true);

    const again = ztIn(root, 'import', 'backlog.md', '--register');
    expect(again.code).toBe(0);
    const cfgAfter = J({ out: readFileSync(configPath(root), 'utf8') }) as { sources: unknown[] };
    expect(cfgAfter.sources).toEqual(cfg.sources!); // no duplicate entries from re-registering
  });

  test('5. the materialized file loads as a first-class document source with the expected hierarchy', () => {
    const list = ztIn(root, 'issue', 'list', '--json', 'identifier,title,parent', '--limit', '50');
    expect(list.code).toBe(0);
    const rows = J(list) as Array<{ identifier: string; title: string; parent: string | null }>;
    const byId = new Map(rows.map((r) => [r.identifier, r]));
    expect(byId.get('APP-1')).toMatchObject({ title: 'Team backlog', parent: '' });
    expect(byId.get('APP-2')).toMatchObject({ title: 'Improve onboarding flow', parent: 'APP-1' });
    expect(byId.get('APP-3')).toMatchObject({ title: 'Speed up CI', parent: 'APP-1' });
  });

  test('6. `ztrack check` is green after import + register, once each issue is assigned', () => {
    // A document source's assignee is NOT ztrack-writable (docs/SOURCES.md: "the sanctioned way
    // to change an item's state or assignee is to edit the document directly") — a freeform
    // backlog carries no assignee at all, so the importer correctly mints none (never guessed).
    // This is the SAME step any newly created issue needs (issue_missing_assignee fires
    // unconditionally regardless of source), not something import should paper over. Simulate the
    // realistic next step: a human adds an `assignee:` header line per item, directly in the file.
    const withAssignees = readFileSync(backlogPath(), 'utf8')
      .replace(/^(#{1,6} APP-\d[^\n]*)$/gm, '$1\n\nassignee: me');
    writeFileSync(backlogPath(), withAssignees);

    const check = ztIn(root, 'check');
    expect(check.code).toBe(0);
  });

  test('7. `ac patch` on an imported AC splice-writes correctly and check stays green', () => {
    const headSha = gitIn(root, 'rev-parse', 'HEAD').stdout.trim();
    expect(headSha).toMatch(/^[0-9a-f]{7,40}$/);
    const before = readFileSync(backlogPath(), 'utf8');
    const patchJson = JSON.stringify({
      checked: true, status: 'passed',
      evidence: [{ id: 'ev1', commit: headSha, acVersion: 1 }],
      proof: { explanation: 'the seed commit adds the welcome email', evidenceRefs: ['ev1'] },
    });
    const patch = ztIn(root, 'ac', 'patch', 'APP-2', 'dev/01', '--json', patchJson);
    expect(patch.code).toBe(0);
    expect(J(patch)).toMatchObject({ issue: 'APP-2', acId: 'dev/01', changed: true });

    const after = readFileSync(backlogPath(), 'utf8');
    expect(after).not.toBe(before);
    expect(after).toContain('- [x] dev/01 v1 Add a welcome email');

    const check = ztIn(root, 'check');
    expect(check.code).toBe(0);
  });
});
