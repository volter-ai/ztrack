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
