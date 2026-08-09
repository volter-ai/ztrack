import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loopMarkerPath } from './loopState.ts';
import { resolveProjectIdentity, resolveWorkTarget } from './projectWork.ts';

const roots: string[] = [];
const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function project(config: Record<string, unknown>, prefix = 'ztrack-project-work-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  mkdirSync(join(root, '.volter'), { recursive: true });
  writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', ...config }));
  return root;
}

function documentTracker(root: string, ids: string[]): void {
  const file = join(root, 'tasks.md');
  writeFileSync(file, ids.map((id) => `## ${id} — ${id} title\n\nBody for ${id}\n`).join('\n'));
}

function initGit(root: string): void {
  expect(git(root, 'init', '-q').status).toBe(0);
  expect(git(root, 'config', 'user.email', 'test@example.com').status).toBe(0);
  expect(git(root, 'config', 'user.name', 'Test').status).toBe(0);
  expect(git(root, 'add', '.').status).toBe(0);
  expect(git(root, 'commit', '-qm', 'init').status).toBe(0);
}

function addWorktree(root: string, branch: string): string {
  const worktree = mkdtempSync(join(tmpdir(), 'ztrack-project-work-wt-'));
  rmSync(worktree, { recursive: true, force: true });
  expect(git(root, 'worktree', 'add', '-q', '-b', branch, worktree).status).toBe(0);
  roots.push(worktree);
  return worktree;
}

afterEach(() => {
  for (const root of roots.splice(0).reverse()) rmSync(root, { recursive: true, force: true });
});

describe('resolveProjectIdentity', () => {
  test('shared local boards join linked worktrees under one project key', () => {
    const root = project({ board: 'shared' });
    initGit(root);
    const worktree = addWorktree(root, 'feature/ZT-1');

    const first = resolveProjectIdentity(root);
    const second = resolveProjectIdentity(worktree);
    expect(first.scope).toBe('shared');
    expect(second.scope).toBe('shared');
    expect(second.projectKey).toBe(first.projectKey);
    expect(second.projectRoot).not.toBe(first.projectRoot);
  });

  test('a worktree-local declared source prevents a false shared identity', () => {
    const root = project({ board: 'shared', sources: [{ path: 'tasks.md', format: 'document', readonly: true }] });
    documentTracker(root, ['ZT-1']);
    initGit(root);
    const worktree = addWorktree(root, 'feature/ZT-1');

    const first = resolveProjectIdentity(root);
    const second = resolveProjectIdentity(worktree);
    expect(first.scope).toBe('worktree');
    expect(second.scope).toBe('worktree');
    expect(second.projectKey).not.toBe(first.projectKey);
  });

  test('branch-scoped local boards keep linked worktrees distinct', () => {
    const root = project({ board: 'branch', sources: [{ path: 'tasks.md', format: 'document', readonly: true }] });
    documentTracker(root, ['ZT-1']);
    initGit(root);
    const worktree = addWorktree(root, 'feature/ZT-1');

    const first = resolveProjectIdentity(root);
    const second = resolveProjectIdentity(worktree);
    expect(first.scope).toBe('worktree');
    expect(second.scope).toBe('worktree');
    expect(second.projectKey).not.toBe(first.projectKey);
  });

  test('a non-git tracker is worktree-scoped and missing config fails loudly', () => {
    const root = project({ sources: [{ path: 'tasks.md', format: 'document', readonly: true }] });
    documentTracker(root, ['ZT-1']);
    expect(resolveProjectIdentity(root)).toMatchObject({ projectRoot: realpathSync(root), scope: 'worktree' });
    const missing = mkdtempSync(join(tmpdir(), 'ztrack-project-work-missing-'));
    roots.push(missing);
    expect(() => resolveProjectIdentity(missing)).toThrow(/No tracker config found/);
  });
});

describe('resolveWorkTarget', () => {
  function tracker(branch = 'main'): string {
    const root = project({ board: 'branch', sources: [{ path: 'tasks.md', format: 'document', readonly: true }] });
    documentTracker(root, ['ZT-1', 'ZT-2', 'ZT-42']);
    initGit(root);
    if (branch !== 'main') expect(git(root, 'checkout', '-qb', branch).status).toBe(0);
    return root;
  }

  test('an explicitly supplied environment issue wins but every conflicting signal remains visible', () => {
    const root = tracker('feature/ZT-2');
    writeFileSync(loopMarkerPath(root), JSON.stringify({
      target: { kind: 'issues', ids: ['ZT-42'] },
      maxIterations: 8,
      startedAt: '',
      label: 'ZT-42',
    }));
    const result = resolveWorkTarget({ startDir: root, environmentIssue: 'ZT-1' });
    expect(result.effective).toEqual({ issueId: 'ZT-1', source: 'environment' });
    expect(result.signals.map((signal) => [signal.source, signal.issueIds])).toEqual([
      ['environment', ['ZT-1']],
      ['loop', ['ZT-42']],
      ['branch', ['ZT-2']],
    ]);
  });

  test('an unknown environment pin fails closed instead of falling through to the branch', () => {
    const root = tracker('feature/ZT-2');
    const result = resolveWorkTarget({ startDir: root, environmentIssue: 'ZT-99' });
    expect(result.effective).toBeNull();
    expect(result.reason).toContain('not in the tracker');
    expect(result.signals.some((signal) => signal.source === 'branch')).toBe(true);
  });

  test('an armed loop wins over branch evidence', () => {
    const root = tracker('feature/ZT-2');
    writeFileSync(loopMarkerPath(root), JSON.stringify({
      target: { kind: 'issues', ids: ['ZT-1'] },
      maxIterations: 8,
      startedAt: '',
      label: 'ZT-1',
    }));
    expect(resolveWorkTarget({ startDir: root }).effective).toEqual({ issueId: 'ZT-1', source: 'loop' });
  });

  test('ambiguous branch evidence remains unresolved', () => {
    const root = tracker('feature/ZT-1-and-ZT-2');
    const result = resolveWorkTarget({ startDir: root });
    expect(result.effective).toBeNull();
    expect(result.reason).toContain('ambiguous');
    expect(result.signals.find((signal) => signal.source === 'branch')?.issueIds).toEqual(['ZT-1', 'ZT-2']);
  });

  test('a unique branch issue becomes the ambient target', () => {
    const root = tracker('feature/zt-42-build');
    expect(resolveWorkTarget({ startDir: root }).effective).toEqual({ issueId: 'ZT-42', source: 'branch' });
  });
});
