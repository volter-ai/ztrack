// ZTB-21 dev/04: `sync github --push --json` could report `"total": 2` while `created` held only
// 1 entry and `updated` was empty — `total` was read independently from `list.length` (every
// local tracker issue, including ones the push left untouched), which can silently disagree with
// the detail arrays. `push()` (src/sync/github/sync.ts) now COMPUTES `total` from the same three
// buckets every row falls into (`created.length + updated.length + skipped`), so it can never
// contradict them; `skipped` (bound, examined, unchanged) is now an explicit field instead of a
// gap you had to infer. Run in a SUBPROCESS — see pushTotalScenarios.ts for why (twin module mock
// isolation).
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const out = spawnSync('bun', ['run', join(import.meta.dir, 'pushTotalScenarios.ts')], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
type Scenario = { created: number; updated: number; skipped: number; total: number; invariantHolds: boolean };
const results = (() => { try { return JSON.parse(out.stdout); } catch { return null; } })() as null | {
  bothCreated: Scenario;
  oneUpdatedOneSkipped: Scenario;
  allSkipped: Scenario;
};

describe('push() total cannot contradict created/updated/skipped (ZTB-21 dev/04)', () => {
  test('the scenario subprocess produced results', () => {
    expect(results, `push-total scenarios failed to run:\n${out.stderr}`).not.toBeNull();
  });

  test('both issues brand-new: total attributes to created', () => {
    expect(results!.bothCreated).toEqual({ created: 2, updated: 0, skipped: 0, total: 2, invariantHolds: true });
  });

  // THE REPORTED BUG: one issue edited (updated), the other left alone (skipped), nothing created.
  // Before the fix this scenario produced `total: 2` (list.length) with `created: []` and
  // `updated` holding only the one changed issue — a silent contradiction.
  test('one updated + one skipped, nothing created: total = 0 + 1 + 1, matching the detail arrays', () => {
    expect(results!.oneUpdatedOneSkipped).toEqual({ created: 0, updated: 1, skipped: 1, total: 2, invariantHolds: true });
  });

  test('a fully settled push: total attributes entirely to skipped', () => {
    expect(results!.allSkipped).toEqual({ created: 0, updated: 0, skipped: 1, total: 1, invariantHolds: true });
  });
});
