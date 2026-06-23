import { describe, expect, test } from 'bun:test';
import { statusToGithubState, githubStateToStatus, recordToIssueResource, issueResourceToRecordFields } from './githubSync.ts';
import type { SyncResource } from '@volter-ai-dev/twin';

describe('github issue <-> record mapping', () => {
  test('status -> github state: only done closes', () => {
    expect(statusToGithubState('done')).toBe('closed');
    for (const s of ['draft', 'ready', 'in-progress', 'in-review']) expect(statusToGithubState(s)).toBe('open');
  });

  test('github state -> status: closed is done; open preserves the local fine state', () => {
    expect(githubStateToStatus('closed')).toBe('done');
    expect(githubStateToStatus('closed', 'in-review')).toBe('done');
    expect(githubStateToStatus('open')).toBe('draft');                    // brand-new issue
    expect(githubStateToStatus('open', 'in-progress')).toBe('in-progress'); // keep the local state
    expect(githubStateToStatus('open', 'done')).toBe('draft');            // reopened -> no longer done
  });

  test('record -> issue resource carries title/body and done-mapped state', () => {
    const res = recordToIssueResource(
      { id: 'APP-1', title: 'Ship login', status: 'in-review', body: '## Acceptance Criteria\n' },
      { id: 'o/r#issue:5', number: 5, repository: 'o/r' },
    );
    expect(res).toEqual({ type: 'issue', id: 'o/r#issue:5', fields: { number: 5, repository: 'o/r', title: 'Ship login', body: '## Acceptance Criteria\n', state: 'open' } });
    expect(recordToIssueResource({ id: 'APP-1', title: 'x', status: 'done', body: '' }, { id: 'o/r#issue:5', number: 5, repository: 'o/r' }).fields.state).toBe('closed');
  });

  test('issue resource -> record fields round-trips through done-ness', () => {
    const closed = { type: 'issue', id: 'o/r#issue:5', fields: { title: 'T', body: 'b', state: 'closed' } } as SyncResource;
    expect(issueResourceToRecordFields(closed)).toEqual({ title: 'T', body: 'b', status: 'done' });
    const open = { type: 'issue', id: 'o/r#issue:5', fields: { title: 'T', body: 'b', state: 'open' } } as SyncResource;
    expect(issueResourceToRecordFields(open, 'ready')).toEqual({ title: 'T', body: 'b', status: 'ready' });
  });
});
