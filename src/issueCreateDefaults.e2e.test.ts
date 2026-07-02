// Black-box e2e for ZTB-7's `issue create` defaults: on the markdown backend, a bare create
// (no --state/--assignee) must mint a record the INSTALLED preset accepts, not one it rejects.
// Regression coverage for markdownBackend.ts's create handler, which used to hardcode state
// 'Backlog' and no assignee — simple-sdlc's status enum and `issue_missing_assignee` rule reject
// both outright, so `ztrack init && ztrack issue create --title x && ztrack check` used to fail
// its own workspace's validation.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('issue create defaults conform to the installed preset (markdown backend)', () => {
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-create-defaults-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the preset imports 'ztrack/preset-kit'
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('fresh init + a bare create ("--title x", no --state/--assignee) + check exits 0', () => {
    expect(ztrackIn(root, ['init', '--team', 'ZT']).code).toBe(0);
    const created = ztrackIn(root, ['issue', 'create', '--title', 'x']); // ZT-1
    expect(created.code).toBe(0);
    expect(created.out).not.toMatch(/does not fully conform/); // a conforming default create stays quiet
    expect(ztrackIn(root, ['check']).code).toBe(0);
  }, 30_000);

  test('an explicit flag still overrides the default, and a nonconforming create prints findings (not silent)', () => {
    const created = ztrackIn(root, ['issue', 'create', '--title', 'y', '--assignee', '']); // ZT-2, explicitly unassigned
    expect(created.code).toBe(0); // create itself doesn't fail on a nonconforming record
    expect(created.out).toMatch(/does not fully conform to the installed preset/);
    expect(created.out).toMatch(/issue_missing_assignee/);
    expect(ztrackIn(root, ['check', 'ZT-2']).code).not.toBe(0); // and `ztrack check` catches it for real
  }, 30_000);
});
