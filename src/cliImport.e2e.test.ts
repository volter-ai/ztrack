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
    // Import never guesses ownership. Assign every materialized task through the tracker service;
    // APP-1 also has id-bearing children, proving metadata-only writes remain safe on parents.
    for (const id of ['APP-1', 'APP-2', 'APP-3']) {
      const assigned = ztIn(root, 'issue', 'edit', id, '--assignee', 'me');
      expect(assigned.code, `${id}: ${assigned.out}`).toBe(0);
    }

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

// ── headingless multi-list regression (defect: only the FIRST top-level list was processed) ─────
// The old output relocated later lists' items as the FIRST issue's ACs on a second pass
// (non-idempotent, mis-attributed) and left root-level prose INSIDE the AC section — which the
// preset (post-ZTB-15) flags ac_prose_in_section and modelEdit's fail-closed guard then REFUSES
// to `ac patch`. The importer must never emit output the write path refuses; this proves it
// end-to-end with the real CLI.
describe('ztrack import: headingless multi-list file with interleaved prose is writable output', () => {
  let mlRoot = '';
  let mlRootReal = '';
  const p2Path = () => join(mlRootReal, 'p2.md');
  const P2 = [
    '- [ ] build auth',
    '  - [ ] login page',
    '  - [ ] logout',
    '',
    'Some notes in between.',
    '',
    '- [ ] payments',
    '  - [ ] stripe integration',
    '',
  ].join('\n');

  beforeAll(() => {
    mlRoot = mkdtempSync(join(tmpdir(), 'ztrk-import-ml-'));
    mlRootReal = realpathSync(mlRoot);
    mkdirSync(join(mlRoot, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(mlRoot, 'node_modules', 'ztrack'));
    gitIn(mlRoot, 'init', '-q'); gitIn(mlRoot, 'config', 'user.email', 't@t.co'); gitIn(mlRoot, 'config', 'user.name', 't');
    expect(ztIn(mlRoot, 'init', '--team', 'APP').code).toBe(0);
    writeFileSync(p2Path(), P2);
    gitIn(mlRoot, 'add', '-A'); gitIn(mlRoot, 'commit', '-q', '-m', 'seed');
  }, 60_000);
  afterAll(() => { if (mlRoot) rmSync(mlRoot, { recursive: true, force: true }); });

  test('1. import processes BOTH lists; re-import is byte-idempotent from import1 onward', () => {
    const first = ztIn(mlRoot, 'import', 'p2.md', '--register');
    expect(first.code).toBe(0);
    expect(first.out).toContain('materialized (2 issues, 3 ACs)');
    const after1 = readFileSync(p2Path(), 'utf8');
    expect(after1).toContain('## APP-1 build auth');
    expect(after1).toContain('## APP-2 payments'); // the SECOND list became its own issue
    // prose is issue body: above build auth's AC heading, never inside the AC section
    const lines = after1.split('\n');
    expect(lines.indexOf('Some notes in between.')).toBeLessThan(lines.indexOf('### Acceptance Criteria'));

    const second = ztIn(mlRoot, 'import', 'p2.md');
    expect(second.code).toBe(0);
    expect(second.out).toContain('no-op (already canonical)');
    expect(readFileSync(p2Path(), 'utf8')).toBe(after1);
  });

  test('2. `ztrack check` is green with ZERO ac_prose_in_section once issues are assigned', () => {
    const withAssignees = readFileSync(p2Path(), 'utf8')
      .replace(/^(#{1,6} APP-\d[^\n]*)$/gm, '$1\n\nassignee: me');
    writeFileSync(p2Path(), withAssignees);
    const check = ztIn(mlRoot, 'check');
    expect(check.out).not.toContain('ac_prose_in_section');
    expect(check.code).toBe(0);
  });

  test('3. a real `ac patch` on a minted AC SUCCEEDS (the ZTB-15 fail-closed guard does not fire) and check stays green', () => {
    gitIn(mlRoot, 'add', '-A'); gitIn(mlRoot, 'commit', '-q', '-m', 'assign');
    const headSha = gitIn(mlRoot, 'rev-parse', 'HEAD').stdout.trim();
    const patchJson = JSON.stringify({
      checked: true, status: 'passed',
      evidence: [{ id: 'ev1', commit: headSha, acVersion: 1 }],
      proof: { explanation: 'the assign commit covers the login page', evidenceRefs: ['ev1'] },
    });
    const patch = ztIn(mlRoot, 'ac', 'patch', 'APP-1', 'dev/01', '--json', patchJson);
    expect(patch.code).toBe(0);
    expect(J(patch)).toMatchObject({ issue: 'APP-1', acId: 'dev/01', changed: true });
    expect(readFileSync(p2Path(), 'utf8')).toContain('- [x] dev/01 v1 login page');
    const check = ztIn(mlRoot, 'check');
    expect(check.out).not.toContain('ac_prose_in_section');
    expect(check.code).toBe(0);
  });
});

// ── ZTB-37: waiver survival across `import` on a document source ───────────────────────────────
// Regression: the importer only recognized `Acceptance Criteria` as reserved document-source
// structure, so a bare `### Waivers` heading was treated as freeform and minted an id into it
// (`### Waivers` -> `### ZT-2 Waivers`), creating a junk issue AND excising the waiver rows out of
// the parent issue's body. Downstream, documentSource.ts's heading-shift (which is what makes
// `## Waivers`/`### Waivers` readable as waivers at all) then has no waivers heading left on the
// parent, so the acknowledged finding resurfaces as an error. This proves the money shot
// end-to-end with the real CLI + a real document source (freshRepo pattern per cliWaiver.e2e.test.ts;
// source registration per documentSource.e2e.test.ts's `setSources`): `check` passes with the
// waiver acknowledged BEFORE import, `import` is a no-op, and `check` still passes AFTER.
describe('ztrack import: end-to-end waiver survival on a document source (ZTB-37)', () => {
  const FAKE_SHA = 'aaaaaaa1111111111111111111111111111111a1';
  const BOARD = [
    'Title: Demo board', 'Assignee: me', '',
    '## ZT-1 — First feature', '',
    'assignee: me', '',
    'Summary: a materialized issue with a waiver.', '',
    '### Acceptance Criteria', '',
    '- [x] dev/01 v1 does the thing',
    '  - status: passed',
    `  - evidence ev1: commit=${FAKE_SHA} acv=1`,
    '  - proof: "ev1 shows it" -> ev1', '',
    '### Waivers', '',
    `- code: evidence_commit_not_found ref: ${FAKE_SHA} reason: destroyed in the incident by: Tess (t@t.co)`, '',
  ].join('\n');

  let wvRoot = '';
  let wvRootReal = '';
  const boardPath = () => join(wvRootReal, 'board.md');
  const setSources = (r: string) => {
    const cfg = JSON.parse(readFileSync(configPath(r), 'utf8')) as Record<string, unknown>;
    cfg.sources = [{ path: '.volter/tracker/markdown' }, { path: 'board.md', format: 'document' }];
    writeFileSync(configPath(r), `${JSON.stringify(cfg, null, 2)}\n`);
  };

  beforeAll(() => {
    wvRoot = mkdtempSync(join(tmpdir(), 'ztrk-import-waivers-e2e-'));
    wvRootReal = realpathSync(wvRoot);
    mkdirSync(join(wvRoot, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(wvRoot, 'node_modules', 'ztrack'));
    gitIn(wvRoot, 'init', '-q'); gitIn(wvRoot, 'config', 'user.email', 't@t.co'); gitIn(wvRoot, 'config', 'user.name', 't');
    expect(ztIn(wvRoot, 'init', '--team', 'ZT').code).toBe(0);
    writeFileSync(boardPath(), BOARD);
    setSources(wvRoot);
    gitIn(wvRoot, 'add', '-A'); gitIn(wvRoot, 'commit', '-q', '-m', 'seed');
  }, 60_000);
  afterAll(() => { if (wvRoot) rmSync(wvRoot, { recursive: true, force: true }); });

  test('1. `check` passes BEFORE import, with the evidence_commit_not_found finding acknowledged (not resurfaced)', () => {
    const check = ztIn(wvRoot, 'check');
    expect(check.code).toBe(0);
    expect(check.out).toContain('acknowledged 1');
    expect(check.out).toContain('evidence_commit_not_found');
  });

  test('2. import (dry-run and write mode) is a no-op — no id minted into the Waivers heading, file byte-identical', () => {
    const before = readFileSync(boardPath(), 'utf8');
    const dry = ztIn(wvRoot, 'import', 'board.md', '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('no-op (already canonical)');
    expect(dry.out).not.toContain('Waivers (new)');
    expect(readFileSync(boardPath(), 'utf8')).toBe(before);

    const write = ztIn(wvRoot, 'import', 'board.md');
    expect(write.code).toBe(0);
    expect(write.out).toContain('no-op (already canonical)');
    expect(readFileSync(boardPath(), 'utf8')).toBe(before); // byte-identical — nothing written
  });

  test('3. `check` still passes AFTER import, with the SAME waiver still acknowledging the finding', () => {
    const check = ztIn(wvRoot, 'check');
    expect(check.code).toBe(0);
    expect(check.out).toContain('acknowledged 1');
    expect(check.out).toContain('evidence_commit_not_found');
    // no junk "Waivers" issue ever surfaced
    const list = ztIn(wvRoot, 'issue', 'list', '--json', 'identifier,title');
    const rows = J(list) as Array<{ identifier: string; title: string }>;
    expect(rows.some((r) => r.title === 'Waivers')).toBe(false);
  });
});
