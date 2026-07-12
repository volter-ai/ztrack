// Z1: `sync github --push` must not clobber a closed issue. Run in a SUBPROCESS — the GitHub-sync
// tests are subprocess-isolated by design (another test globally mocks the twin module, which
// would otherwise leak a stub into this in-process twin user). The subprocess loads the real twin
// cleanly and prints JSON results we assert on. See pushClobberScenarios.ts for the full repro
// narrative and the fix rationale.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const out = spawnSync('bun', ['run', join(import.meta.dir, 'pushClobberScenarios.ts')], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const results = (() => { try { return JSON.parse(out.stdout); } catch { return null; } })() as null | {
  closeSurvivesUnrelatedLocalEdit: { ghState: string; ghTitle: string; conflicts: number; pushedCount: number };
  sameFieldCollisionSurfacedNotClobbered: { ghState: string; ghTitle: string; conflicts: number; conflictFields: string[] };
};

describe('sync github --push does not clobber a closed issue (Z1)', () => {
  test('the scenario subprocess produced results', () => {
    expect(results, `pushClobber scenarios failed to run:\n${out.stderr}`).not.toBeNull();
  });

  test('an issue closed on GitHub stays closed across a push, even with an unrelated local edit', () => {
    const r = results!.closeSurvivesUnrelatedLocalEdit;
    expect(r.ghState).toBe('closed');            // THE BUG: naive push reopened this to 'open'
    expect(r.ghTitle).toBe('Title EDITED LOCALLY'); // the non-conflicting local title change still lands
    expect(r.conflicts).toBe(0);                  // non-overlapping fields merge cleanly, no conflict
    expect(r.pushedCount).toBe(1);
  });

  test('a genuine same-field collision alongside a remote close is surfaced, not clobbered either way', () => {
    const r = results!.sameFieldCollisionSurfacedNotClobbered;
    expect(r.ghState).toBe('closed');                 // never reverted to open
    expect(r.ghTitle).toBe('Title FROM REMOTE');      // GitHub's own title is never overwritten by local
    expect(r.conflicts).toBe(1);
    expect(r.conflictFields).toContain('title');
  });
});
