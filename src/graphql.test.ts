import { describe, expect, test } from 'bun:test';
import { executeTrackerGraphql } from './graphql.ts';
import type { TrackerBackend } from './types.ts';

function captureBackend(): { backend: TrackerBackend; calls: string[][] } {
  const calls: string[][] = [];
  const backend: TrackerBackend = {
    name: 'capture',
    async command(args: string[]) {
      calls.push(args);
      return { stdout: args[1] === 'create' ? 'PH-1' : '{}', stderr: '' };
    },
  } as unknown as TrackerBackend;
  return { backend, calls };
}

describe('graphql input parsing is string-aware', () => {
  test('a "}" inside a string value does not drop the remaining fields', async () => {
    const { backend, calls } = captureBackend();
    await executeTrackerGraphql(backend, 'mutation{issueCreate(input:{title:"T",body:"closing } brace here"}){success}}');
    const create = calls.find((c) => c[1] === 'create')!;
    expect(create).toContain('--title');
    expect(create).toContain('--body');
    expect(create[create.indexOf('--body') + 1]).toBe('closing } brace here');
  });
});

// ztrack issue #19: this executor used to return every field it fetched regardless of the
// query's selection set (`{ issues { nodes { title } } }` came back with every field). It now
// filters recursively, per-field, including through connections (`nodes`) and nested objects.
const RAW_ISSUE = {
  id: 'X-1', identifier: 'X-1', number: 'X-1', title: 'T1', body: 'B1', description: 'B1',
  state: 'open', stateType: 'unstarted', createdAt: '2020', updatedAt: '2021', project: null,
  parent: null, labels: [{ name: 'bug' }], url: 'http://x', priority: 1,
};

function issueBackend(): TrackerBackend {
  return {
    name: 'markdown',
    async command(args: string[]) {
      if (args[0] === 'issue' && args[1] === 'list') return { stdout: JSON.stringify([RAW_ISSUE]), stderr: '' };
      if (args[0] === 'issue' && args[1] === 'view') return { stdout: JSON.stringify({ ...RAW_ISSUE, comments: [] }), stderr: '' };
      return { stdout: '{}', stderr: '' };
    },
  } as unknown as TrackerBackend;
}

describe('graphql selection-set filtering (ztrack issue #19)', () => {
  test('the exact repro from the issue: `{ issues { nodes { title } } }` returns ONLY title, no args needed', async () => {
    const r = await executeTrackerGraphql(issueBackend(), '{ issues { nodes { title } } }');
    expect(r).toEqual({ data: { issues: { nodes: [{ title: 'T1' }] } } });
  });

  test('nested connection field (labels { nodes { name } }) filters recursively, alongside a sibling leaf', async () => {
    const r = await executeTrackerGraphql(issueBackend(), '{ issues(first: 5) { nodes { title labels { nodes { name } } } } }');
    expect(r).toEqual({ data: { issues: { nodes: [{ title: 'T1', labels: { nodes: [{ name: 'bug' }] } }] } } });
  });

  test('singular `issue(id)` filters to the requested fields, and a field alias renames the response key', async () => {
    const r = await executeTrackerGraphql(issueBackend(), '{ issue(id: "X-1") { t: title id } }');
    expect(r).toEqual({ data: { issue: { t: 'T1', id: 'X-1' } } });
  });

  test('a fragment spread in the selection set is a clear unsupported error, not silently dropped/kept fields', async () => {
    const r = await executeTrackerGraphql(issueBackend(), '{ issues { nodes { ...Frag } } }');
    expect(r).toEqual({ errors: [{ message: expect.stringContaining('fragments') as unknown as string }] });
  });

  test('a directive on a field is a clear unsupported error, not silently ignored', async () => {
    const r = await executeTrackerGraphql(issueBackend(), '{ issues { nodes { title @include(if: true) } } }');
    expect(r).toEqual({ errors: [{ message: expect.stringContaining('directives') as unknown as string }] });
  });

  test('a requested field the executor never fetched is simply omitted (cannot fabricate unfetched data)', async () => {
    const r = await executeTrackerGraphql(issueBackend(), '{ issue(id: "X-1") { title neverFetchedField } }') as { data: { issue: Record<string, unknown> } };
    expect(r.data.issue).toEqual({ title: 'T1' });
  });
});
