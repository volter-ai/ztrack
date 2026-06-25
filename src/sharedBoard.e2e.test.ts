// REAL end-to-end test (not a unit test) for the SHARED-LOCAL board: a black-box CLI driven across
// actual git worktrees, exercising the full lifecycle and its edge cases. Shared mode keeps the board
// committed per-worktree (in git) AND maintains a central symlink index in <git-common-dir>/ztrack/board
// so a coordinator on trunk sees every worktree's live issues, and ids are globally unique — with no
// external tracker. We assert against the real filesystem + real `git worktree` + the real ztrack CLI.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const runIn = (cwd: string, cmd: string, args: string[]) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const gitIn = (cwd: string, ...a: string[]) => runIn(cwd, 'git', a);
const ztIn = (cwd: string, ...a: string[]) => { const r = runIn(cwd, 'bun', ['run', CLI, ...a]); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
// issue ids present in a `ztrack issue list` (shared board), sorted
const ids = (cwd: string): string[] => {
  const r = ztIn(cwd, 'issue', 'list', '--json', 'identifier');
  try { return (JSON.parse(r.out) as Array<{ identifier: string }>).map((x) => x.identifier).sort(); } catch { return [`PARSE_FAIL: ${r.out}`]; }
};
const stateOf = (cwd: string, id: string): string => {
  const r = ztIn(cwd, 'issue', 'view', id, '--json', 'state');
  try { return (JSON.parse(r.out) as { state: { name: string } }).state.name; } catch { return `PARSE_FAIL: ${r.out}`; }
};
const body = (title: string) => `Summary: ${title}\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 ${title} works.\n  - status: pending\n`;
const createReady = (cwd: string, title: string) => {
  const f = join(cwd, `body-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(f, body(title));
  return ztIn(cwd, 'issue', 'create', '--title', title, '--label', 'type:case', '--state', 'ready', '--assignee', 'me', '--body-file', f);
};

let root = '';
const wts: string[] = [];
const addWorktree = (name: string, branch: string): string => {
  const p = mkdtempSync(join(tmpdir(), `ztwt-${name}-`));
  rmSync(p, { recursive: true, force: true }); // git worktree add wants a non-existent path
  expect(gitIn(root, 'worktree', 'add', p, '-b', branch).status).toBe(0);
  wts.push(p);
  return p;
};

describe('shared-local board: real lifecycle across git worktrees', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-shared-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    gitIn(root, 'init', '-q'); gitIn(root, 'config', 'user.email', 't@t.co'); gitIn(root, 'config', 'user.name', 't');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n'); // never commit/clone deps
    gitIn(root, 'commit', '-q', '--allow-empty', '-m', 'root');
    ztIn(root, 'init', '--shared'); // central, cross-worktree board (the OA fleet install opts in here)
    expect(JSON.parse(readFileSync(join(root, '.volter', 'tracker-config.json'), 'utf8')).board).toBe('shared');
    gitIn(root, 'add', '-A'); gitIn(root, 'commit', '-q', '-m', 'init ztrack (shared board)');
  }, 60_000);
  afterAll(() => {
    for (const p of wts) { gitIn(root, 'worktree', 'remove', '--force', p); rmSync(p, { recursive: true, force: true }); }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('1. create on trunk → committed md in git + a central index symlink + visible in list', () => {
    createReady(root, 'core');
    expect(existsSync(join(root, '.volter', 'tracker', 'markdown', 'LOCAL-1.md'))).toBe(true); // committed (in git)
    const link = join(root, '.git', 'ztrack', 'board', 'LOCAL-1.md');
    expect(lstatSync(link).isSymbolicLink()).toBe(true); // central index entry is a symlink…
    expect(readFileSync(link, 'utf8')).toContain('core'); // …resolving to the committed md
    expect(ids(root)).toEqual(['LOCAL-1']);
    gitIn(root, 'add', '-A'); gitIn(root, 'commit', '-q', '-m', 'LOCAL-1'); // commit so worktrees branch from it
  }, 60_000);

  test('2. a worktree edits the issue → the change is visible from TRUNK (cross-worktree)', () => {
    const wt = addWorktree('a', 'agent/issue-LOCAL-1');
    expect(ztIn(wt, 'issue', 'edit', 'LOCAL-1', '--state', 'in-progress').code).toBe(0);
    expect(stateOf(wt, 'LOCAL-1')).toBe('in-progress');      // the worktree sees its own write
    expect(stateOf(root, 'LOCAL-1')).toBe('in-progress');    // ← TRUNK sees it live, via the index. KEY.
  }, 60_000);

  test('3. a NEW issue created in a worktree is visible on trunk, with a globally-unique id', () => {
    const wt = wts[0]!;
    createReady(wt, 'sub-feature');
    expect(stateOf(wt, 'LOCAL-2')).not.toContain('PARSE_FAIL'); // got LOCAL-2 (next global id), created in the worktree
    expect(ids(root)).toContain('LOCAL-2');                      // trunk sees it via the index, though trunk has no LOCAL-2.md
    expect(existsSync(join(root, '.volter', 'tracker', 'markdown', 'LOCAL-2.md'))).toBe(false);
  }, 60_000);

  test('4. a SECOND worktree allocates the next global id — no collision', () => {
    const wt2 = addWorktree('b', 'agent/issue-x');
    createReady(wt2, 'other');
    // ids come from the central index, so the second worktree must NOT reuse LOCAL-2
    expect(stateOf(wt2, 'LOCAL-3')).not.toContain('PARSE_FAIL');
    expect(ids(root)).toEqual(['LOCAL-1', 'LOCAL-2', 'LOCAL-3']);
  }, 60_000);

  test('5. concurrent edits in different worktrees are both visible centrally', () => {
    const [wt1, wt2] = [wts[0]!, wts[1]!];
    expect(ztIn(wt1, 'issue', 'edit', 'LOCAL-1', '--state', 'in-review').code).toBe(0);
    expect(ztIn(wt2, 'issue', 'edit', 'LOCAL-3', '--state', 'in-progress').code).toBe(0);
    expect(stateOf(root, 'LOCAL-1')).toBe('in-review');
    expect(stateOf(root, 'LOCAL-3')).toBe('in-progress');
  }, 60_000);

  test('6. merge a worktree branch → trunk, then remove it → no dangling; state persists from trunk', () => {
    const wt1 = wts[0]!;
    gitIn(wt1, 'add', '-A'); gitIn(wt1, 'commit', '-q', '-m', 'work LOCAL-1 + LOCAL-2');
    expect(gitIn(root, 'merge', '--no-ff', '-m', 'integrate', 'agent/issue-LOCAL-1').status).toBe(0);
    expect(gitIn(root, 'worktree', 'remove', '--force', wt1).status).toBe(0);
    wts.splice(wts.indexOf(wt1), 1);
    // the index symlink for LOCAL-1/LOCAL-2 now dangles (its worktree is gone) → read falls back to trunk,
    // which now has the merged mds. No error, correct state.
    expect(existsSync(join(root, '.volter', 'tracker', 'markdown', 'LOCAL-2.md'))).toBe(true); // merged into trunk
    expect(stateOf(root, 'LOCAL-1')).toBe('in-review');   // resolved from trunk after the dangling link
    expect(stateOf(root, 'LOCAL-2')).toBe('ready');
    expect(ids(root)).toContain('LOCAL-3');               // still visible (its worktree b is alive)
  }, 60_000);

  test('7. ABANDON a worktree (remove without merge) → its in-flight-only issue vanishes, others remain', () => {
    const wt2 = wts[0]!; // worktree b (LOCAL-3 lives only here, never merged)
    expect(gitIn(root, 'worktree', 'remove', '--force', wt2).status).toBe(0);
    wts.splice(wts.indexOf(wt2), 1);
    const board = ids(root);
    expect(board).not.toContain('LOCAL-3');               // abandoned in-flight → gone (not a dangling error)
    expect(board).toEqual(['LOCAL-1', 'LOCAL-2']);        // merged work survives
    expect(stateOf(root, 'LOCAL-3')).toContain('PARSE_FAIL'); // view of a vanished issue = not found
  }, 60_000);

  test('8. a FRESH CLONE regenerates the board from the committed mds (index is not cloned)', () => {
    const clone = mkdtempSync(join(tmpdir(), 'ztrk-clone-'));
    rmSync(clone, { recursive: true, force: true });
    expect(spawnSync('git', ['clone', '-q', root, clone], { encoding: 'utf8' }).status).toBe(0);
    mkdirSync(join(clone, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(clone, 'node_modules', 'ztrack'));
    expect(existsSync(join(clone, '.git', 'ztrack', 'board'))).toBe(false); // index not cloned (it's in .git)
    expect(ids(clone)).toEqual(['LOCAL-1', 'LOCAL-2']);    // …yet the committed board is fully readable
    rmSync(clone, { recursive: true, force: true });
  }, 60_000);
});

describe('branch-scoped board (default) is unchanged — regression guard', () => {
  let r = '';
  afterAll(() => { if (r) rmSync(r, { recursive: true, force: true }); });
  test('default mode keeps the board branch-scoped (an edit on a branch is NOT visible on trunk until merge)', () => {
    r = mkdtempSync(join(tmpdir(), 'ztrk-branch-'));
    mkdirSync(join(r, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(r, 'node_modules', 'ztrack'));
    gitIn(r, 'init', '-q'); gitIn(r, 'config', 'user.email', 't@t.co'); gitIn(r, 'config', 'user.name', 't');
    gitIn(r, 'commit', '-q', '--allow-empty', '-m', 'root');
    ztIn(r, 'init'); // default board = branch
    const f = join(r, 'b.md'); writeFileSync(f, body('x'));
    ztIn(r, 'issue', 'create', '--title', 'x', '--label', 'type:case', '--state', 'ready', '--assignee', 'me', '--body-file', f);
    expect(existsSync(join(r, '.git', 'ztrack', 'board'))).toBe(false); // no central index in branch mode
    gitIn(r, 'add', '-A'); gitIn(r, 'commit', '-q', '-m', 'LOCAL-1');
    const wt = mkdtempSync(join(tmpdir(), 'ztwt-br-')); rmSync(wt, { recursive: true, force: true });
    gitIn(r, 'worktree', 'add', wt, '-b', 'feat');
    ztIn(wt, 'issue', 'edit', 'LOCAL-1', '--state', 'in-progress');
    expect(stateOf(wt, 'LOCAL-1')).toBe('in-progress');  // changed on the branch
    expect(stateOf(r, 'LOCAL-1')).toBe('ready');         // …but trunk still sees the old state (branch-scoped)
    gitIn(r, 'worktree', 'remove', '--force', wt); rmSync(wt, { recursive: true, force: true });
  }, 60_000);
});
