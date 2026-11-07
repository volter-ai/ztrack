import { describe, expect, test } from 'bun:test';
import { closeSync, mkdirSync, mkdtempSync, openSync, unlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAudit, observeChanges, readAudit, seedAuditBaseline, timestampsFor } from './audit.ts';

const ISSUE = { id: 'A-1', status: 'ready', acceptanceCriteria: [] as Array<{ id: string; status: string; evidence: unknown[] }> };
const lockFile = (repo: string) => join(repo, 'tracker', '.audit.lock');

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

  test('observeChanges skips under lock contention — no duplicate, change stays pending', () => {
    const repo = tmpRepo();
    seedAuditBaseline(repo); // baseline {} present, so A-1 would be logged (not silently seeded)
    mkdirSync(join(repo, 'tracker'), { recursive: true });
    const held = openSync(lockFile(repo), 'wx'); // simulate a concurrent observer holding the lock
    try {
      expect(observeChanges(repo, [ISSUE], 'cli')).toEqual([]); // contended → skipped
      expect(readAudit(repo).length).toBe(0);                   // wrote nothing
    } finally {
      closeSync(held);
      unlinkSync(lockFile(repo)); // the "other observer" finishes and releases
    }
    // lock free again: the still-pending create is recorded exactly once by the next pass
    expect(observeChanges(repo, [ISSUE], 'cli').map((e) => e.op)).toEqual(['observed.create']);
    expect(readAudit(repo, 'A-1').filter((e) => e.op === 'observed.create').length).toBe(1);
  });

  test('observeChanges steals a stale lock left by a crashed observer', () => {
    const repo = tmpRepo();
    seedAuditBaseline(repo);
    mkdirSync(join(repo, 'tracker'), { recursive: true });
    closeSync(openSync(lockFile(repo), 'wx'));
    const stale = new Date(Date.now() - 60_000); // 60s old → past the staleness timeout
    utimesSync(lockFile(repo), stale, stale);
    expect(observeChanges(repo, [ISSUE], 'cli').map((e) => e.op)).toEqual(['observed.create']);
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
