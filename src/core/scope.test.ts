import { describe, expect, test } from 'bun:test';
import { partitionFindings, resolveActiveIssue } from './scope.ts';
import type { Finding } from './engine.ts';

const ids = ['ZT-1', 'ZT-2', 'ZT-42'];

describe('resolveActiveIssue', () => {
  test('matches an id embedded in the branch name', () => {
    expect(resolveActiveIssue({ branch: 'ZT-42-add-autoscope', issueIds: ids }).issueId).toBe('ZT-42');
  });

  test('case-insensitive against a lowercased branch', () => {
    expect(resolveActiveIssue({ branch: 'feature/zt-42-fix', issueIds: ids }).issueId).toBe('ZT-42');
  });

  test('exact branch == id', () => {
    expect(resolveActiveIssue({ branch: 'ZT-42', issueIds: ids }).issueId).toBe('ZT-42');
  });

  test('boundary-aware: ZT-4 does NOT match ZT-42-x', () => {
    expect(resolveActiveIssue({ branch: 'ZT-42-x', issueIds: ['ZT-4'] }).issueId).toBeNull();
  });

  test('boundary-aware: ZT-4 DOES match ZT-4-x', () => {
    expect(resolveActiveIssue({ branch: 'ZT-4-x', issueIds: ['ZT-4'] }).issueId).toBe('ZT-4');
  });

  test('prefers branch, then falls back to worktree', () => {
    expect(resolveActiveIssue({ branch: 'main', worktree: 'ZT-1-wt', issueIds: ids }).issueId).toBe('ZT-1');
  });

  test('no id present → null, fail closed', () => {
    const r = resolveActiveIssue({ branch: 'autonomy-cutover', issueIds: ids });
    expect(r.issueId).toBeNull();
    expect(r.reason).toContain('no issue id');
  });

  test('two distinct ids in one name → ambiguous null', () => {
    const r = resolveActiveIssue({ branch: 'ZT-1-and-ZT-2', issueIds: ids });
    expect(r.issueId).toBeNull();
    expect(r.reason).toContain('ambiguous');
  });

  test('empty git context → null', () => {
    expect(resolveActiveIssue({ issueIds: ids }).issueId).toBeNull();
  });
});

describe('partitionFindings', () => {
  const f = (issueId: string | undefined, code = 'x', severity: 'error' | 'warning' = 'error'): Finding =>
    ({ code, severity, message: code, ...(issueId ? { issueId } : {}) });

  test('active issue: only its findings + workspace-level findings block', () => {
    const { blocking, informational } = partitionFindings([f('ZT-42'), f('ZT-1'), f(undefined, 'workspace')], 'ZT-42');
    expect(blocking.map((b) => b.code)).toEqual(['x', 'workspace']);
    expect(informational).toHaveLength(1);
    expect(informational[0]!.issueId).toBe('ZT-1');
  });

  test('unresolved (null): everything blocks, nothing informational', () => {
    const part = partitionFindings([f('ZT-1'), f('ZT-2')], null);
    expect(part.blocking).toHaveLength(2);
    expect(part.informational).toHaveLength(0);
  });
});
