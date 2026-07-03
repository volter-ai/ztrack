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
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });

describe('issue create defaults conform to the installed preset (markdown backend)', () => {
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-create-defaults-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the preset imports 'ztrack/preset-kit'
    // The default assignee IS `git config user.name` (markdownBackend.defaultAssignee), so the
    // fixture must pin its own repo-local identity — otherwise the test silently depends on the
    // runner's GLOBAL git config (present on a dev machine, absent on a CI runner, where the
    // default resolves to '' and the create is nonconforming).
    gitIn(root, 'init', '-q');
    gitIn(root, 'config', 'user.email', 't@t.co');
    gitIn(root, 'config', 'user.name', 't');
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

// ZTB-18 dev/40: `issue create` without --title used to mint a record with title '' —
// markdownBackend.ts:327 — which the installed preset's `wellformed_shape` immediately rejects
// ("title: Too small") the moment `ztrack check` runs. Never mint a record the preset rejects for
// a missing title: derive it from the body's first `# Heading` line, or refuse at create time.
describe('issue create: title derivation / refusal when --title is omitted (ZTB-18 dev/40)', () => {
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-create-title-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    gitIn(root, 'init', '-q');
    gitIn(root, 'config', 'user.email', 't@t.co');
    gitIn(root, 'config', 'user.name', 't');
    ztrackIn(root, ['init', '--team', 'ZT']);
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('body with a `# Heading` and no --title → title is derived from it; check is green', () => {
    const created = ztrackIn(root, ['issue', 'create', '--body', '# From The Body\n\n## Summary\n\nok']); // ZT-1
    expect(created.code).toBe(0);
    expect(created.out).toMatch(/"title": "From The Body"/);
    expect(ztrackIn(root, ['check', 'ZT-1']).code).toBe(0);
  }, 30_000);

  test('body with no heading and no --title → create refuses, exit 1, nothing minted', () => {
    const listBefore = ztrackIn(root, ['issue', 'list', '--json', 'identifier']);
    const created = ztrackIn(root, ['issue', 'create', '--body', 'just some prose, no heading at all']);
    expect(created.code).toBe(1);
    expect(created.out).toMatch(/no --title given and the body has no '# Heading' line/);
    const listAfter = ztrackIn(root, ['issue', 'list', '--json', 'identifier']);
    expect(listAfter.out).toBe(listBefore.out); // no new issue was minted
  }, 30_000);

  test('no body at all and no --title → create refuses the same way (empty body has no heading)', () => {
    const created = ztrackIn(root, ['issue', 'create']);
    expect(created.code).toBe(1);
    expect(created.out).toMatch(/no --title given and the body has no '# Heading' line/);
  }, 30_000);

  test('an explicit --title is unchanged: heading present is NOT used when --title is also given', () => {
    const created = ztrackIn(root, ['issue', 'create', '--title', 'Explicit', '--body', '# Heading Wins Nothing Here']); // ZT-2ish
    expect(created.code).toBe(0);
    expect(created.out).toMatch(/"title": "Explicit"/);
  }, 30_000);

  test('an explicit --title \'\' is unchanged (still minted, as before — only the omitted-flag case changed)', () => {
    const created = ztrackIn(root, ['issue', 'create', '--title', '', '--body', '# Would Have Derived']);
    expect(created.code).toBe(0);
    expect(created.out).toMatch(/"title": ""/);
  }, 30_000);
});
