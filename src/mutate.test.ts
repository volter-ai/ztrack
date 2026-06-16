import { describe, expect, test } from 'bun:test';
import { applyAcMutation } from './mutate.ts';

describe('applyAcMutation — multi-line AC items', () => {
  const body = '## Acceptance Criteria\n\n- [ ] dev/03 first line\n  more detail on second line\n';

  test('check mutates only the AC line; continuation lines are byte-preserved', () => {
    const out = applyAcMutation(body, { op: 'check', acId: 'dev/03' }).body;
    expect(out).toContain('- [x] dev/03 status: passed first line'); // status on the AC line
    expect(out).toContain('\n  more detail on second line');        // continuation indent intact
    expect(out).not.toMatch(/more detail on second line AC-Version/); // version not stamped on prose
  });

  test('check then uncheck restores the AC line and preserves continuation', () => {
    const checked = applyAcMutation(body, { op: 'check', acId: 'dev/03' }).body;
    const reverted = applyAcMutation(checked, { op: 'uncheck', acId: 'dev/03' }).body;
    expect(reverted).toContain('- [ ] dev/03');
    expect(reverted).toContain('\n  more detail on second line');
  });

describe("applyAcMutation — setext headings", () => {
  test("mutates the correct AC row under a setext (two-line) heading", () => {
    const md = `Title\n=====\n\n## Acceptance Criteria\n\n- [ ] AC-01 first\n- [ ] AC-02 second\n`;
    const out = applyAcMutation(md, { op: "check", acId: "AC-02" }).body;
    expect(out).toMatch(/- \[ \] AC-01 first/);
    expect(out).toMatch(/- \[x\] AC-02/);
  });
});

});
