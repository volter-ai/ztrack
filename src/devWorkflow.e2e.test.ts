// The actual DEVELOPMENT workflows in a real git repo: an agent works a branch per issue, and
// `check`/`loop` auto-scope to that issue from the branch name. Black-box CLI in a real git repo
// (resolveActiveIssue reads `git rev-parse --abbrev-ref HEAD`, which only returns a branch name
// once the repo has a commit — so this exercises the realistic, committed state).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const git = (...a: string[]) => run('git', a);
const zt = (...a: string[]) => { const r = run('bun', ['run', CLI, ...a]); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };

describe('dev workflow: branch-scoped check/loop in a real git repo', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-dev-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    git('init', '-q'); git('config', 'user.email', 't@t.co'); git('config', 'user.name', 't');
    zt('init');
    writeFileSync(join(root, 'g.md'), zt('issue', 'scaffold', '--title', 'G').out);
    zt('issue', 'create', '--title', 'Green', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', 'g.md'); // LOCAL-1 green
    zt('issue', 'create', '--title', 'Red', '--label', 'type:case', '--state', 'draft', '--body-file', 'g.md');                       // LOCAL-2 red (no assignee)
    git('add', '-A'); git('commit', '-q', '-m', 'init'); // a commit, so branch names resolve
  }, 30_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('on a branch named for the GREEN issue, the gate passes (its issue is green; the other is informational)', () => {
    expect(git('checkout', '-q', '-b', 'local-1-fix').status).toBe(0);
    const scoped = zt('check', '--auto-scope', '--json');
    expect(scoped.out).toMatch(/matched LOCAL-1 in branch/);     // resolved from the branch name
    expect(zt('check', '--auto-scope').code).toBe(0);            // gate passes (scoped to LOCAL-1)
    expect(zt('check').code).toBe(0);                            // bare check opportunistically scopes too
  }, 30_000);

  test('on a branch named for the RED issue, the gate holds (nonzero)', () => {
    expect(git('checkout', '-q', '-b', 'local-2-fix').status).toBe(0);
    expect(zt('check', '--auto-scope').code).not.toBe(0);        // gate scopes to the red LOCAL-2
  }, 30_000);

  test('`loop start` with no id ralph-loops the branch issue', () => {
    git('checkout', '-q', 'local-1-fix');
    const armed = zt('loop', 'start');
    expect(armed.out).toMatch(/this branch's issue/);
    expect(zt('check', '--auto-scope').code).toBe(0);            // the gate resolves LOCAL-1 (green)
    zt('loop', 'stop');
  }, 30_000);
});

// A LOCAL tracker commits its store so clones/CI/worktrees verify the REAL issues; a LINKED
// tracker ignores it (GitHub is the source of truth — `ztrack sync` repopulates).
describe('dev workflow: the issue store is committed locally, ignored when linked', () => {
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('a LOCAL tracker commits the store → a fresh clone verifies real issues (no empty false-green)', () => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-commit-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    git('init', '-q'); git('config', 'user.email', 't@t.co'); git('config', 'user.name', 't');
    zt('init');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).not.toMatch(/tracker\/markdown\//); // store NOT ignored
    writeFileSync(join(root, '.gitignore'), `${readFileSync(join(root, '.gitignore'), 'utf8')}\nnode_modules/\n`); // don't commit the dep symlink
    writeFileSync(join(root, 'g.md'), zt('issue', 'scaffold', '--title', 'G').out);
    zt('issue', 'create', '--title', 'Green', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', 'g.md');
    git('add', '-A'); git('commit', '-q', '-m', 'init');
    expect(run('git', ['ls-files', '.volter/tracker/markdown']).stdout.trim().length).toBeGreaterThan(0); // committed

    const clone = mkdtempSync(join(tmpdir(), 'ztrk-clone-'));
    expect(run('git', ['clone', '-q', root, clone]).status).toBe(0);
    mkdirSync(join(clone, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(clone, 'node_modules', 'ztrack'));
    const cloneZt = (...a: string[]) => spawnSync('bun', ['run', CLI, ...a], { cwd: clone, encoding: 'utf8' });
    expect(cloneZt('issue', 'list', '--json', 'identifier').stdout).toMatch(/LOCAL-1/); // clone SEES the issue
    expect(cloneZt('check').status).toBe(0);                                            // and verifies it (real, not empty)
    rmSync(clone, { recursive: true, force: true });
  }, 45_000);

  test('a LINKED tracker ignores the store (GitHub is truth)', () => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-linkedig-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    git('init', '-q');
    zt('init', '--sync', 'github', '--repo', 'o/n'); // pull 404s but init succeeds + writes the link
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toMatch(/tracker\/markdown\//); // store IGNORED
  }, 30_000);
});
