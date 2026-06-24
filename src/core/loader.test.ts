import { describe, expect, test } from 'bun:test';
import { viewToRecord } from './loader.ts';

describe('viewToRecord', () => {
  test('maps a backend view to an IssueRecord', () => {
    const rec = viewToRecord({ identifier: 'ZT-1', title: 'T', state: { name: 'in-progress' }, assignee: { name: 'aaron' }, body: 'b' }, 'ZT-1');
    expect(rec.id).toBe('ZT-1');
    expect(rec.status).toBe('in-progress');
    expect(rec.assignee).toBe('aaron');
  });

  // A backend returns null for an unknown id — must be a clean not-found, not a leaked
  // `Cannot read properties of null (reading 'assignee')`.
  test('unknown issue (null view) throws a clean not-found', () => {
    expect(() => viewToRecord(null as unknown as Record<string, unknown>, 'NOPE-1')).toThrow('issue NOPE-1 not found');
  });
});
