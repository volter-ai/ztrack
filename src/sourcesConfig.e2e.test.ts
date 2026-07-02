// ZTB-3 e2e: config-declared `sources` — a real black-box CLI drive (spawns `bun run cli.ts`,
// same style as sharedBoard.e2e.test.ts). Two plain directories declared via tracker-config.json
// `sources` (neither is the implicit default store, so board/worktree-index machinery never
// enters this test): disjoint ids union in `issue list`; a planted duplicate id across the two
// sources fails `check` with `issue_id_conflict` naming both; a `readonly: true` source rejects
// writes with the read-only error naming it; the other source still writes normally.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const runIn = (cwd: string, cmd: string, args: string[]) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const gitIn = (cwd: string, ...a: string[]) => runIn(cwd, 'git', a);
const ztIn = (cwd: string, ...a: string[]) => { const r = runIn(cwd, 'bun', ['run', CLI, ...a]); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const configPath = (root: string) => join(root, '.volter', 'tracker-config.json');
const setSources = (root: string, sources: Array<{ path: string; readonly?: boolean }>) => {
  const cfg = JSON.parse(readFileSync(configPath(root), 'utf8')) as Record<string, unknown>;
  cfg.sources = sources;
  writeFileSync(configPath(root), `${JSON.stringify(cfg, null, 2)}\n`);
};
const acBody = (title: string) => `Summary: ${title}\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 ${title} works.\n  - status: pending\n`;
const idOf = (out: string): string => /\b([A-Z]+-\d+)\b/.exec(out)?.[1] ?? `NO_ID: ${out}`;

let root = '';

describe('config-declared sources (ZTB-3): union list, cross-source id conflict, readonly writes', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-sources-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    gitIn(root, 'init', '-q'); gitIn(root, 'config', 'user.email', 't@t.co'); gitIn(root, 'config', 'user.name', 't');
    expect(ztIn(root, 'init', '--team', 'APP').code).toBe(0);
    // Two plain declared sources, neither at the implicit default store path — no board/worktree
    // index machinery is exercised here (that's covered by sharedBoard.e2e.test.ts).
    setSources(root, [{ path: 'issues-a' }, { path: 'issues-b' }]);
  }, 60_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('1. issue create mints into the FIRST writable declared source (declared order)', () => {
    const fileA = join(root, 'a.md');
    writeFileSync(fileA, acBody('Alpha'));
    const created = ztIn(root, 'issue', 'create', '--title', 'Alpha', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', fileA);
    expect(created.code).toBe(0);
    const idA = idOf(created.out);
    expect(idA).toBe('APP-1');
    expect(() => readFileSync(join(root, 'issues-a', `${idA}.md`), 'utf8')).not.toThrow(); // minted into issues-a, not issues-b
  });

  test('2. reordering `sources` retargets minting to the new first writable source; the global id counter still spans both', () => {
    setSources(root, [{ path: 'issues-b' }, { path: 'issues-a' }]); // issues-b now first
    const fileB = join(root, 'b.md');
    writeFileSync(fileB, acBody('Beta'));
    const created = ztIn(root, 'issue', 'create', '--title', 'Beta', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', fileB);
    expect(created.code).toBe(0);
    const idB = idOf(created.out);
    expect(idB).toBe('APP-2'); // global counter, not per-source
    expect(() => readFileSync(join(root, 'issues-b', `${idB}.md`), 'utf8')).not.toThrow();
    setSources(root, [{ path: 'issues-a' }, { path: 'issues-b' }]); // restore declared order for the rest
  });

  test('3. `issue list` unions disjoint ids across both declared sources', () => {
    const list = ztIn(root, 'issue', 'list', '--json', 'identifier');
    const ids = (JSON.parse(list.out) as Array<{ identifier: string }>).map((r) => r.identifier).sort();
    expect(ids).toEqual(['APP-1', 'APP-2']);
  });

  test('4. the same id planted in BOTH sources fails `check` with issue_id_conflict naming both paths', () => {
    copyFileSync(join(root, 'issues-a', 'APP-1.md'), join(root, 'issues-b', 'APP-1.md')); // plant the conflict
    const result = ztIn(root, 'check');
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('issue_id_conflict');
    expect(result.out).toContain(join(root, 'issues-a', 'APP-1.md'));
    expect(result.out).toContain(join(root, 'issues-b', 'APP-1.md'));
    rmSync(join(root, 'issues-b', 'APP-1.md')); // un-plant — restore the disjoint state for the rest
  });

  test('5. `ac patch` on a readonly-source issue is rejected with the read-only error naming the source', () => {
    setSources(root, [{ path: 'issues-a', readonly: true }, { path: 'issues-b' }]);
    const result = ztIn(root, 'ac', 'patch', 'APP-1', 'dev/01', '--json', '{"checked":true}');
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('read-only');
    expect(result.out).toContain(join(root, 'issues-a'));
    expect(readFileSync(join(root, 'issues-a', 'APP-1.md'), 'utf8')).not.toContain('[x]'); // unwritten
  });

  test('6. `ac patch` on the other (writable) source succeeds and writes to the correct dir', () => {
    const result = ztIn(root, 'ac', 'patch', 'APP-2', 'dev/01', '--json', '{"checked":true}');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ issue: 'APP-2', acId: 'dev/01', changed: true });
    expect(readFileSync(join(root, 'issues-b', 'APP-2.md'), 'utf8')).toContain('[x]');
  });
});
