import { describe, expect, test } from 'bun:test';
import { rowToRecord, viewToRecord } from './loader.ts';

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

  // ZTB-2: the markdown backend attaches the issue's absolute file path (`path`) to its view —
  // viewToRecord maps it into `origin.path` (no line span; the whole file is the issue).
  test('a view carrying `path` populates origin.path', () => {
    const rec = viewToRecord({ identifier: 'ZT-1', title: 'T', state: { name: 'ready' }, body: 'b', path: '/repo/.volter/tracker/markdown/ZT-1.md' }, 'ZT-1');
    expect(rec.origin).toEqual({ path: '/repo/.volter/tracker/markdown/ZT-1.md' });
  });

  test('a view with no `path` leaves origin unset', () => {
    const rec = viewToRecord({ identifier: 'ZT-1', title: 'T', state: { name: 'ready' }, body: 'b' }, 'ZT-1');
    expect(rec.origin).toBeUndefined();
  });
});

describe('rowToRecord', () => {
  // ZTB-2: same mapping as viewToRecord, from a flat `issue list` row instead of a nested view.
  test('a row carrying `path` populates origin.path', () => {
    const rec = rowToRecord({ identifier: 'ZT-1', title: 'T', state: 'ready', body: 'b', path: '/repo/.volter/tracker/markdown/ZT-1.md' });
    expect(rec.origin).toEqual({ path: '/repo/.volter/tracker/markdown/ZT-1.md' });
  });

  test('a row with no `path` leaves origin unset', () => {
    const rec = rowToRecord({ identifier: 'ZT-1', title: 'T', state: 'ready', body: 'b' });
    expect(rec.origin).toBeUndefined();
  });
});
