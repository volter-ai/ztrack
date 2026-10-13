import { describe, expect, test } from 'bun:test';
import type { EffectiveExtension } from './extensions';
import type { CoreIssue } from './model';
import { isOperationallyBlocked, operationalBlockLabel } from './operationalBlocking';

const extension = (overrides: Partial<EffectiveExtension> = {}): EffectiveExtension => ({ statusOrder: [], operationalBlocking: {}, ...overrides });
const issue = (overrides: Partial<CoreIssue> & Record<string, unknown> = {}): CoreIssue => ({
  id: 'X-1', title: 'Issue', summary: '', status: 'draft', acceptanceCriteria: [], ...overrides,
}) as CoreIssue;

describe('operational blocking', () => {
  test('uses the server-derived canonical frontier and renders its nearest blockers', () => {
    const blocked = issue({ relations: [{ type: 'blocked-by', issueId: 'X-2' }] });
    const ext = extension({ operationalBlocking: { 'X-1': { blocked: true, blockers: [{ issue: 'X-2' }] } } });
    expect(isOperationallyBlocked(blocked, ext)).toBe(true);
    expect(operationalBlockLabel(blocked, ext)).toBe('blocked by X-2');
  });

  test('raw refs do not override a canonical unblocked result', () => {
    const satisfiedDependency = issue({ relations: [{ type: 'blocked-by', issueId: 'DONE-1' }] });
    const sameIssueSequence = issue({ acceptanceCriteria: [{ id: 'dev/01', status: 'pending', evidence: [], blockedBy: [{ issue: 'X-1', ac: 'dev/02' }] }] });
    const ext = extension({ operationalBlocking: { 'X-1': { blocked: false, blockers: [] } } });
    expect(isOperationallyBlocked(satisfiedDependency, ext)).toBe(false);
    expect(isOperationallyBlocked(sameIssueSequence, ext)).toBe(false);
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
