import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  PROJECT_HOOK_EVENT,
  PROJECT_HOOKS_SCHEMA,
  projectHookRegistryPath,
  readProjectHooks,
  registerProjectHook,
  runProjectHooks,
  shouldRunProjectHooks,
} from './projectHooks.ts';

const roots: string[] = [];
const CLI = join(import.meta.dir, 'cli.ts');

function gitRepo(): { root: string; commonDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'ztrack-project-hooks-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  const commonDir = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  return { root, commonDir };
}

function fixture(root: string, source: string): string {
  const path = join(root, `hook-${Math.random().toString(16).slice(2)}.cjs`);
  writeFileSync(path, `#!/usr/bin/env node\n${source}`);
  chmodSync(path, 0o700);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('machine-local project hooks', () => {
  test('registration is stored under Git common-dir, not in the repository', () => {
    const { root, commonDir } = gitRepo();
    const executable = fixture(root, '');
    registerProjectHook(root, {
      id: 'fixture',
      event: PROJECT_HOOK_EVENT,
      executable,
      args: ['one'],
      timeoutMs: 1_000,
    });

    expect(projectHookRegistryPath(root)).toBe(join(commonDir, 'ztrack', 'hooks.json'));
    expect(readProjectHooks(root).hooks[0]).toMatchObject({ id: 'fixture', args: ['one'] });
    expect(existsSync(join(root, '.volter', 'hooks.json'))).toBe(false);
  });

  test('invocation uses fixed argv and supplies project context without a shell', () => {
    const { root } = gitRepo();
    const marker = join(root, 'called.json');
    const executable = fixture(root, `
require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
  argv: process.argv.slice(2),
  event: process.env.ZTRACK_HOOK_EVENT,
  root: process.env.ZTRACK_PROJECT_ROOT,
  command: JSON.parse(process.env.ZTRACK_COMMAND_JSON),
}));
`);
    registerProjectHook(root, {
      id: 'fixture',
      event: PROJECT_HOOK_EVENT,
      executable,
      args: ['literal;not-shell'],
      timeoutMs: 1_000,
    });

    expect(runProjectHooks(root, ['issue', 'list'])).toEqual({ attempted: 1, warnings: [] });
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({
      argv: ['literal;not-shell'],
      event: PROJECT_HOOK_EVENT,
      root,
      command: ['issue', 'list'],
    });
  });

  test('linked worktrees share one registry', () => {
    const { root } = gitRepo();
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    writeFileSync(join(root, 'README.md'), 'fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
    const worktree = `${root}-worktree`;
    roots.push(worktree);
    execFileSync('git', ['worktree', 'add', '-q', worktree, '-b', 'fixture-worktree'], { cwd: root });
    const executable = fixture(root, '');
    registerProjectHook(root, {
      id: 'shared',
      event: PROJECT_HOOK_EVENT,
      executable,
      args: [],
      timeoutMs: 1_000,
    });

    expect(projectHookRegistryPath(worktree)).toBe(projectHookRegistryPath(root));
    expect(readProjectHooks(worktree).hooks.map((hook) => hook.id)).toEqual(['shared']);
  });

  test('an invalid registry becomes a warning and never escapes into the caller', () => {
    const { root } = gitRepo();
    const path = projectHookRegistryPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ schema: PROJECT_HOOKS_SCHEMA, hooks: [{ id: '../bad' }] }));

    const result = runProjectHooks(root, ['issue', 'list']);
    expect(result.attempted).toBe(0);
    expect(result.warnings[0]).toContain('hook id must contain');
  });

  test('the real CLI add/list/remove contract is idempotent', () => {
    const { root } = gitRepo();
    const executable = fixture(root, '');
    const addArgs = [
      'run', CLI, 'hooks', 'add', '--event', PROJECT_HOOK_EVENT, '--id', 'fixture',
      '--timeout-ms', '1000', '--', executable, '--literal',
    ];
    const added = spawnSync('bun', addArgs, { cwd: root, encoding: 'utf8' });
    expect(added.status).toBe(0);
    expect(added.stdout).toContain('registered project hook fixture');
    const updated = spawnSync('bun', addArgs, { cwd: root, encoding: 'utf8' });
    expect(updated.status).toBe(0);
    expect(updated.stdout).toContain('updated project hook fixture');

    const listed = spawnSync('bun', ['run', CLI, 'hooks', 'list', '--json'], { cwd: root, encoding: 'utf8' });
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout).hooks[0].args).toEqual(['--literal']);

    const removed = spawnSync('bun', ['run', CLI, 'hooks', 'remove', 'fixture'], { cwd: root, encoding: 'utf8' });
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain('removed project hook fixture');
    expect(readProjectHooks(root).hooks).toEqual([]);
  }, 15_000);

  test('a failing hook warns but preserves a successful ztrack command', () => {
    const { root } = gitRepo();
    const initialized = spawnSync('bun', ['run', CLI, 'init'], { cwd: root, encoding: 'utf8' });
    expect(initialized.status).toBe(0);
    const executable = fixture(root, 'process.stderr.write("fixture failed\\n"); process.exit(7);');
    registerProjectHook(root, {
      id: 'failure',
      event: PROJECT_HOOK_EVENT,
      executable,
      args: [],
      timeoutMs: 1_000,
    });

    const listed = spawnSync('bun', ['run', CLI, 'issue', 'list'], { cwd: root, encoding: 'utf8' });
    expect(listed.status).toBe(0);
    expect(listed.stderr).toContain('project hook failure failed: fixture failed');
  }, 15_000);

  test('only recognized project operations invoke hooks; non-Git use stays silent', () => {
    const outsideGit = mkdtempSync(join(tmpdir(), 'ztrack-no-git-'));
    roots.push(outsideGit);
    expect(runProjectHooks(outsideGit, ['issue', 'list'])).toEqual({ attempted: 0, warnings: [] });
    expect(shouldRunProjectHooks(['issue', 'list'])).toBe(true);
    expect(shouldRunProjectHooks(['check', './body.md'])).toBe(false);
    expect(shouldRunProjectHooks(['hooks', 'list'])).toBe(false);
    expect(shouldRunProjectHooks(['not-a-command'])).toBe(false);
  });
});
