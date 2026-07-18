import { describe, expect, test } from 'bun:test';
import type { EffectiveExtension } from './extensions';
import type { CoreIssue } from './model';
import { hasBlockedAcceptanceCriterion, isOperationallyBlocked, operationalBlockLabel } from './operationalBlocking';

const extension = (overrides: Partial<EffectiveExtension> = {}): EffectiveExtension => ({ statusOrder: [], ...overrides });
const issue = (overrides: Partial<CoreIssue> & Record<string, unknown> = {}): CoreIssue => ({
  id: 'X-1', title: 'Issue', summary: '', status: 'draft', acceptanceCriteria: [], ...overrides,
}) as CoreIssue;

describe('operational blocking', () => {
  test('recognizes issue relations and AC-level blockedBy refs', () => {
    expect(isOperationallyBlocked(issue({ relations: [{ type: 'blocked-by', issueId: 'X-2' }] }), extension())).toBe(true);
    const blockedByAc = issue({ acceptanceCriteria: [{ id: 'dev/01', status: 'pending', evidence: [], blockedBy: [{ issue: 'X-2' }] }] });
    expect(hasBlockedAcceptanceCriterion(blockedByAc)).toBe(true);
    expect(isOperationallyBlocked(blockedByAc, extension())).toBe(true);
    expect(operationalBlockLabel(blockedByAc, extension())).toBe('blocked by acceptance criterion');
  });

  test('lets a code extension add a repo-specific block and label', () => {
    const custom = extension({
      isOperationallyBlocked: (candidate) => candidate.status === 'human-required',
      operationalBlockLabel: () => 'awaiting owner action',
    });
    const blocked = issue({ status: 'human-required' });
    expect(isOperationallyBlocked(blocked, custom)).toBe(true);
    expect(operationalBlockLabel(blocked, custom)).toBe('awaiting owner action');
  });

  test('never renders a custom reason for an issue the policy did not block', () => {
    const labelOnly = extension({ operationalBlockLabel: () => 'misleading label' });
    expect(isOperationallyBlocked(issue(), labelOnly)).toBe(false);
    expect(operationalBlockLabel(issue(), labelOnly)).toBeUndefined();
  });
});
