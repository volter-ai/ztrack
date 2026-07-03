// fetchSince is the fiddly mapping at the GitHub boundary (since/state/sort params, PR exclusion,
// pagination, the safety cap), so it earns a unit test with a fake executor. The cursor/shadow
// behaviour is the kernel runner's job (proven separately); the live e2e covers the real wire.
import { describe, expect, test } from 'bun:test';
import { githubIssueConnector } from './connector.ts';
import type { GithubExecute } from '@volter-ai-dev/twin-github';

function fakeExecute(pages: Record<number, unknown[]>, calls: Record<string, unknown>[] = []): GithubExecute {
  return {
    async request(_route: string, params: Record<string, unknown> = {}) {
      calls.push(params);
      return { status: 200, data: pages[Number(params.page)] ?? [] };
    },
  };
}

describe('githubIssueConnector.fetchSince', () => {
  test('maps issues, EXCLUDES PRs, INCLUDES closed, carries updated_at as occurredAt', async () => {
    const exec = fakeExecute({ 1: [
      { number: 1, title: 'Open', body: 'b', state: 'open', updated_at: '2026-02-02T00:00:00Z', html_url: 'u1', assignees: [{ login: 'me' }], labels: [{ name: 'bug' }] },
      { number: 2, title: 'Closed', body: 'c', state: 'closed', updated_at: '2026-02-01T00:00:00Z', html_url: 'u2' },
      { number: 3, title: 'A PR', state: 'open', updated_at: '2026-02-03T00:00:00Z', pull_request: { url: 'x' } },
    ] });
    const { observations, truncated } = await githubIssueConnector(exec, 'o', 'r').fetchSince({ cursor: '', limit: 1000, root: '/x' });
    expect(truncated).toBe(false);
    expect(observations.map((o) => o.subject.id)).toEqual(['o/r#issue:1', 'o/r#issue:2']); // PR dropped
    const closed = observations.find((o) => o.subject.id === 'o/r#issue:2')!;
    expect(closed.observed).toMatchObject({ number: 2, repository: 'o/r', title: 'Closed', state: 'closed' });
    const open = observations.find((o) => o.subject.id === 'o/r#issue:1')!;
    expect(open.occurredAt).toBe('2026-02-02T00:00:00Z');
    expect(open.observed).toMatchObject({ assignees: ['me'], labels: ['bug'] });
    expect(open.external).toEqual({ provider: 'github', id: '1', url: 'u1' });
  });

  test('passes since/state=all/sort=updated; omits since on the bootstrap (empty cursor)', async () => {
    const boot: Record<string, unknown>[] = [];
    await githubIssueConnector(fakeExecute({ 1: [] }, boot), 'o', 'r').fetchSince({ cursor: '', limit: 100, root: '/x' });
    expect(boot[0]).toMatchObject({ state: 'all', sort: 'updated', direction: 'desc' });
    expect(boot[0]!.since).toBeUndefined();

    const inc: Record<string, unknown>[] = [];
    await githubIssueConnector(fakeExecute({ 1: [] }, inc), 'o', 'r').fetchSince({ cursor: '2026-02-01T00:00:00Z', limit: 100, root: '/x' });
    expect(inc[0]!.since).toBe('2026-02-01T00:00:00Z');
  });

  test('paginates until a short page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, state: 'open', updated_at: '2026-02-01T00:00:00Z' }));
    const calls: Record<string, unknown>[] = [];
    const { observations } = await githubIssueConnector(fakeExecute({ 1: page1, 2: [{ number: 101, state: 'open', updated_at: '2026-01-01T00:00:00Z' }] }, calls), 'o', 'r').fetchSince({ cursor: '', limit: 1000, root: '/x' });
    expect(observations).toHaveLength(101);
    expect(calls.map((c) => c.page)).toEqual([1, 2]);
  });

  test('truncates at the safety cap (runner then holds the cursor)', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, state: 'open', updated_at: '2026-02-01T00:00:00Z' }));
    const { observations, truncated } = await githubIssueConnector(fakeExecute({ 1: page1 }, []), 'o', 'r').fetchSince({ cursor: '', limit: 10, root: '/x' });
    expect(truncated).toBe(true);
    expect(observations).toHaveLength(10);
  });
});

// ZTB-19 (ZL-E9a): a generic `(HTTP 404)` with no repo/operation/hint leaves an operator
// guessing which of N connectors failed and why. Each 4xx/5xx path now names the repo, the
// operation, and (for the two most common causes) a likely fix.
function statusExecute(status: number): GithubExecute {
  return { async request() { return { status, data: [] }; } };
}

describe('githubIssueConnector.fetchSince — error messages (ZL-E9a)', () => {
  test('404 names the repo, the operation, and suggests access/typo/privacy', async () => {
    await expect(githubIssueConnector(statusExecute(404), 'acme', 'widgets').fetchSince({ cursor: '', limit: 100, root: '/x' }))
      .rejects.toThrow(/github connector: list issues .* for acme\/widgets failed \(HTTP 404\).*(private|access|spelling)/is);
  });

  test('401 and 403 name the repo and suggest a token scope problem', async () => {
    await expect(githubIssueConnector(statusExecute(401), 'acme', 'widgets').fetchSince({ cursor: '', limit: 100, root: '/x' }))
      .rejects.toThrow(/github connector: list issues .* for acme\/widgets failed \(HTTP 401\).*(token|scope)/is);
    await expect(githubIssueConnector(statusExecute(403), 'acme', 'widgets').fetchSince({ cursor: '', limit: 100, root: '/x' }))
      .rejects.toThrow(/github connector: list issues .* for acme\/widgets failed \(HTTP 403\).*(token|scope)/is);
  });

  test('other statuses (e.g. 500) still name the repo + operation, without a false token/privacy hint', async () => {
    await expect(githubIssueConnector(statusExecute(500), 'acme', 'widgets').fetchSince({ cursor: '', limit: 100, root: '/x' }))
      .rejects.toThrow('github connector: list issues (page 1) for acme/widgets failed (HTTP 500)');
  });
});
