// Proves the three-way reconcile (no silent clobber) by running the scenarios in a SUBPROCESS —
// the GitHub-sync tests are subprocess-isolated by design (another test globally mocks the twin
// module, which would otherwise leak a stub into this in-process twin user). The subprocess loads
// the real twin cleanly and prints JSON results we assert on.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const out = spawnSync('bun', ['run', join(import.meta.dir, 'reconcileScenarios.ts')], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const results = (() => { try { return JSON.parse(out.stdout); } catch { return null; } })() as null | {
  merge: { conflicts: number; ghTitle: string; ghBody: string; trackerTitle: string; trackerBody: string };
  conflict: { conflicts: number; fields: string[]; ghTitle: string; trackerTitle: string };
  hubWins: { conflicts: number; ghTitle: string; trackerTitle: string };
  idempotent: { pulled: number; pushed: number; conflicts: number };
};

describe('reconcileSync — three-way merge (no silent clobber)', () => {
  test('the scenario subprocess produced results', () => {
    expect(results, `reconcile scenarios failed to run:\n${out.stderr}`).not.toBeNull();
  });

  test('non-overlapping concurrent edits MERGE: local title + remote body both survive', () => {
    expect(results!.merge.conflicts).toBe(0);
    expect(results!.merge.ghTitle).toBe('Title LOCAL');     // GitHub got the local title
    expect(results!.merge.ghBody).toBe('Body REMOTE');      // GitHub kept its own body
    expect(results!.merge.trackerTitle).toBe('Title LOCAL'); // tracker kept its own title
    expect(results!.merge.trackerBody).toBe('Body REMOTE');  // tracker got the remote body
  });

  test('same-field collision is a SURFACED conflict, not a clobber', () => {
    expect(results!.conflict.conflicts).toBe(1);
    expect(results!.conflict.fields).toContain('title');
    expect(results!.conflict.ghTitle).toBe('Title FROM REMOTE'); // neither side overwritten
    expect(results!.conflict.trackerTitle).toBe('Title FROM LOCAL');
  });

  test('the policy is honored: hub-wins auto-resolves the collision to GitHub', () => {
    expect(results!.hubWins.conflicts).toBe(0);                 // not surfaced — policy resolves it
    expect(results!.hubWins.ghTitle).toBe('Title FROM REMOTE');  // GitHub authoritative
    expect(results!.hubWins.trackerTitle).toBe('Title FROM REMOTE'); // local overwritten to match
  });

  test('a settled sync is idempotent: nothing pulled/pushed, no conflicts', () => {
    expect(results!.idempotent).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });
  });
});
