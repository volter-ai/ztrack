import { describe, expect, test } from 'bun:test';
import { applyAcMutation, addEvidenceEntry } from './mutate.ts';

describe('addEvidenceEntry — node-structural list items', () => {
  test('writes each evidence entry as a `- [En]` GFM list item, ids increment', () => {
    const r1 = addEvidenceEntry('# T\n\n## Evidence\n', { type: 'pr', repo: 'x/y' });
    expect(r1.evidenceId).toBe('E1');
    expect(r1.body).toContain('- [E1] type: pr repo: x/y');
    const r2 = addEvidenceEntry(r1.body, { type: 'screenshot', path: 'a.png' });
    expect(r2.evidenceId).toBe('E2'); // existing `- [E1]` list item is detected
    expect(r2.body).toContain('- [E2] type: screenshot path: a.png');
  });
});

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

describe("applyAcMutation — id normalization", () => {
  test("an unpadded caller id matches a zero-padded body id", () => {
    const body = "# T\n\n## Acceptance Criteria\n\n- [ ] AC-02 do the thing\n";
    expect(applyAcMutation(body, { op: "check", acId: "AC-2" }).body).toContain("- [x] AC-02");
    const b2 = "# T\n\n## Acceptance Criteria\n\n- [ ] dev/03 build\n";
    expect(applyAcMutation(b2, { op: "check", acId: "dev/3" }).body).toContain("- [x] dev/03");
  });

  test("an unpadded caller id stamps the SAME AC-Version as the padded id (canonical)", () => {
    const body = "## Acceptance Criteria\n\n- [ ] AC-02 type: ac The user can log in. [1]\n";
    const version = (md: string) => md.match(/AC-Version: (acv_\w+)/)?.[1];
    const padded = version(applyAcMutation(body, { op: "check", acId: "AC-02", commit: "abc1234" }).body);
    const unpadded = version(applyAcMutation(body, { op: "check", acId: "AC-2", commit: "abc1234" }).body);
    expect(unpadded).toBe(padded);
    expect(padded).toBeTruthy();
  });
});

describe("applyAcMutation — setext headings", () => {
  test("mutates the correct AC row under a setext (two-line) heading", () => {
    const md = `Title\n=====\n\n## Acceptance Criteria\n\n- [ ] AC-01 first\n- [ ] AC-02 second\n`;
    const out = applyAcMutation(md, { op: "check", acId: "AC-02" }).body;
    expect(out).toMatch(/- \[ \] AC-01 first/);
    expect(out).toMatch(/- \[x\] AC-02/);
  });
});

describe('applyAcMutation — block / unblock', () => {
  const body = '## Acceptance Criteria\n\n- [ ] dev/03 status: pending Wire it. [1]\n';

  test('block adds a blocked-by field; repeated refs are de-duped; status untouched', () => {
    const r1 = applyAcMutation(body, { op: 'block', acId: 'dev/03', field: 'blocked-by', refs: ['dev/02', 'APP-2:dev/01'] });
    expect(r1.itemAfter).toContain('blocked-by: dev/02, APP-2:dev/01');
    expect(r1.itemAfter).toContain('status: pending'); // completion state untouched
    const r2 = applyAcMutation(r1.body, { op: 'block', acId: 'dev/03', field: 'blocked-by', refs: ['dev/02', 'APP-4'] });
    expect(r2.itemAfter).toMatch(/blocked-by: dev\/02, APP-2:dev\/01, APP-4/); // merged, dev/02 not duplicated
  });

  test('--blocks targets the forward edge independently of blocked-by', () => {
    const r = applyAcMutation(body, { op: 'block', acId: 'dev/03', field: 'blocks', refs: ['dev/05'] });
    expect(r.itemAfter).toContain('blocks: dev/05');
  });

  test('unblock removes a specific ref, then clears the field when emptied', () => {
    const blocked = applyAcMutation(body, { op: 'block', acId: 'dev/03', field: 'blocked-by', refs: ['dev/02', 'APP-4'] }).body;
    const minusOne = applyAcMutation(blocked, { op: 'unblock', acId: 'dev/03', field: 'blocked-by', refs: ['dev/02'] });
    expect(minusOne.itemAfter).toContain('blocked-by: APP-4');
    expect(minusOne.itemAfter).not.toContain('dev/02');
    const cleared = applyAcMutation(minusOne.body, { op: 'unblock', acId: 'dev/03', field: 'blocked-by' });
    expect(cleared.itemAfter).not.toContain('blocked-by');
  });

  test('a blocker added to a checked AC coexists with the trailing AC-Version stamp', () => {
    const checked = applyAcMutation(body, { op: 'check', acId: 'dev/03', commit: 'abc1234' }).body;
    expect(checked).toContain('AC-Version: acv_');
    const r = applyAcMutation(checked, { op: 'block', acId: 'dev/03', field: 'blocked-by', refs: ['dev/02'] });
    // blocker present, AC-Version still present and still trailing the line
    expect(r.itemAfter).toContain('blocked-by: dev/02');
    expect(r.itemAfter).toMatch(/blocked-by: dev\/02 AC-Version: acv_/);
  });
});

});
