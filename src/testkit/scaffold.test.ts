// Proves the scaffolder builds REAL fixtures: each issue shape produces its KNOWN check outcome,
// the store is committed, the SHA is real, and branches work — so the core-matrix e2es can trust it.
import { afterAll, describe, expect, test } from 'bun:test';
import { scaffoldProject, type ScaffoldedProject } from './scaffold.ts';

describe('scaffoldProject — realistic fixtures with known outcomes', () => {
  let p: ScaffoldedProject;
  afterAll(() => p?.cleanup());

  test('each shape checks as designed; store committed; sha real; branch resolves', () => {
    p = scaffoldProject({
      team: 'APP',
      commit: true,
      issues: [
        { title: 'Pending', shape: 'pending' },     // APP-1 → green
        { title: 'Real', shape: 'realCommit' },      // APP-2 → green
        { title: 'Fake', shape: 'fakeCommit' },      // APP-3 → red
        { title: 'NoEvidence', shape: 'noEvidence' },// APP-4 → red
      ],
    });

    expect(p.ids).toEqual(['APP-1', 'APP-2', 'APP-3', 'APP-4']);
    expect(p.sha).toMatch(/^[0-9a-f]{40}$/);

    const green = (id: string) => p.zt('check', id, '--verify-commits').code === 0;
    expect(green('APP-1')).toBe(true);   // pending AC — nothing claimed done
    expect(green('APP-2')).toBe(true);   // checked AC citing the REAL commit
    expect(green('APP-3')).toBe(false);  // checked AC citing a fake commit
    expect(green('APP-4')).toBe(false);  // checked AC with no evidence

    expect(p.git('ls-files', '.volter/tracker/markdown').out.trim().length).toBeGreaterThan(0); // committed
    p.branch('app-1-fix');
    expect(p.zt('check', '--auto-scope', '--json').out).toMatch(/matched APP-1 in branch/);     // branch resolves
  }, 60_000);
});
