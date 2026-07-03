// ZTB-21 dev/02: `sync github --pull` on a repo with zero prior sync state used to silently
// report "0 created, 0 updated" when GitHub's issue-list API lagged a just-created issue — the
// identical retry then succeeded, so the FIRST result was simply wrong with no indication it might
// be. `pull()` (src/sync/github/sync.ts) now retries once, bounded, ONLY in that narrow
// first-pull-found-nothing case (safe because the bootstrap cursor never advances on an empty
// poll — see sync.ts's comment), and is honest via a `note` field if the lag outlives the retry.
// Run in a SUBPROCESS — see pullLagScenarios.ts for why (twin module mock isolation).
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const out = spawnSync('bun', ['run', join(import.meta.dir, 'pullLagScenarios.ts')], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const results = (() => { try { return JSON.parse(out.stdout); } catch { return null; } })() as null | {
  recovered: { created: number; total: number; note: string | null; listCalls: number };
  stillLagging: { created: number; note: string | null };
  settledNoRetry: { created: number; note: string | null; listCallsForSecondPull: number };
};

describe('pull() retries once on a first-pull-found-nothing GitHub list race (ZTB-21 dev/02)', () => {
  test('the scenario subprocess produced results', () => {
    expect(results, `pull-lag scenarios failed to run:\n${out.stderr}`).not.toBeNull();
  });

  test('one round of list lag: the bounded retry recovers the issue — no false 0/0', () => {
    expect(results!.recovered.created).toBe(1);
    expect(results!.recovered.total).toBe(1);
    expect(results!.recovered.note).toBeNull();     // recovered cleanly — no need to alarm the operator
    expect(results!.recovered.listCalls).toBe(2);    // exactly one retry, not a busy-loop
  });

  test('lag outliving the one retry is reported honestly, not silently, as 0 results', () => {
    expect(results!.stillLagging.created).toBe(0);
    expect(results!.stillLagging.note).toMatch(/lag/i);
    expect(results!.stillLagging.note).toMatch(/retry the pull/i);
  });

  test('a settled repo (bindings already exist) that legitimately finds nothing new does NOT retry', () => {
    expect(results!.settledNoRetry.created).toBe(0);
    expect(results!.settledNoRetry.note).toBeNull();
    expect(results!.settledNoRetry.listCallsForSecondPull).toBe(1); // no retry — a single list call
  });
});
