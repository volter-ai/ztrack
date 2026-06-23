import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAudit, observeChanges, readAudit, timestampsFor } from './audit.ts';

function tmpRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'audit-'));
  return d;
}

describe('audit log', () => {
  test('append then read returns entries; readAudit filters by issue', () => {
    const repo = tmpRepo();
    appendAudit(repo, { ts: '2026-01-01T00:00:00Z', issueId: 'A-1', op: 'create' });
    appendAudit(repo, { ts: '2026-01-02T00:00:00Z', issueId: 'A-2', op: 'create' });
    expect(readAudit(repo).length).toBe(2);
    expect(readAudit(repo, 'A-1').map((e) => e.issueId)).toEqual(['A-1']);
  });

  test('timestamps derive from the log (created/updated/state-since)', () => {
    const entries = [
      { ts: '2026-01-01T00:00:00Z', issueId: 'A-1', op: 'create' },
      { ts: '2026-01-02T00:00:00Z', issueId: 'A-1', op: 'ac.add' },
      { ts: '2026-01-03T00:00:00Z', issueId: 'A-1', op: 'status', from: 'draft', to: 'ready' },
      { ts: '2026-01-04T00:00:00Z', issueId: 'A-1', op: 'evidence.add' },
    ];
    expect(timestampsFor(entries, 'A-1')).toEqual({
      created: '2026-01-01T00:00:00Z', updated: '2026-01-04T00:00:00Z', stateSince: '2026-01-03T00:00:00Z',
    });
  });
});

describe('change observation (universal audit, any preset / any edit source)', () => {
  const issue = (status: string, acStatus: string, ev: number) => ({ id: 'A-1', status, acceptanceCriteria: [{ id: 'AC-1', status: acStatus, evidence: Array(ev).fill({}) }] });
  test('first run seeds silently; later changes are logged automatically', () => {
    const repo = tmpRepo();
    expect(observeChanges(repo, [issue('ready', 'pending', 0)])).toEqual([]); // seed
    const changes = observeChanges(repo, [issue('in-review', 'passed', 1)]);
    expect(changes.map((e) => e.op)).toEqual(['status', 'ac.status', 'evidence.add']);
    expect(changes.find((e) => e.op === 'status')).toMatchObject({ from: 'ready', to: 'in-review' });
    expect(readAudit(repo, 'A-1').length).toBe(3);
    // no change -> nothing new
    expect(observeChanges(repo, [issue('in-review', 'passed', 1)])).toEqual([]);
  });
});
