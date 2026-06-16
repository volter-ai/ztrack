import { describe, expect, test } from 'bun:test';
import { checkSpec, parseSpec, SpecRootSchema } from './spec.ts';

const REAL = 'cafe1234beef';
const ctx = { git: { existingCommits: [REAL] } };

const DOC = `# SPEC-1: Appointment search

Summary: members find appointments fast
Status: in-review

## Acceptance Criteria

- [x] AC-1 Members can filter by status
  - commit: ${REAL}
- [ ] AC-2 Members can search by provider
`;

describe('greenfield spec preset', () => {
  test('mdast parses markdown straight into the hard schema', () => {
    const root = SpecRootSchema.parse(parseSpec(DOC)); // throws if the parse output isn't schema-valid
    expect(root.issues[0]).toMatchObject({ id: 'SPEC-1', title: 'Appointment search', summary: 'members find appointments fast', status: 'in-review' });
    const [ac1, ac2] = root.issues[0]!.acceptanceCriteria;
    expect(ac1).toMatchObject({ id: 'AC-1', status: 'passed', text: 'Members can filter by status' });
    expect(ac1!.evidence[0]).toMatchObject({ id: 'AC-1/ev1', commit: REAL });
    expect(ac2).toMatchObject({ id: 'AC-2', status: 'pending' });
    expect(ac2!.evidence).toEqual([]);
  });

  test('clean doc passes; export is the parsed root', () => {
    const r = checkSpec(DOC, ctx);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.export!.issues[0]!.id).toBe('SPEC-1');
  });

  test('rule: passed AC with no evidence fails', () => {
    const doc = `# S-1: x\n\nStatus: draft\n\n## Acceptance Criteria\n\n- [x] AC-1 done it\n`;
    const r = checkSpec(doc, ctx);
    expect(r.findings.some((f) => f.code === 'passed_ac_missing_evidence')).toBe(true);
    expect(r.ok).toBe(false);
  });

  test('rule: evidence citing a missing commit fails (uses context)', () => {
    const doc = DOC.replace(REAL, 'deadbeef');
    const r = checkSpec(doc, ctx);
    expect(r.findings.some((f) => f.code === 'evidence_commit_not_found')).toBe(true);
  });

  test('hard schema: an unknown status is a wellformed error, not silently accepted', () => {
    const doc = `# S-1: x\n\nStatus: shipped\n\n## Acceptance Criteria\n\n- [ ] AC-1 a\n`;
    const r = checkSpec(doc, ctx);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === 'wellformed_shape')).toBe(true);
  });

  test('hard schema: strict — a stray field would be rejected', () => {
    // the parser only ever emits known fields; prove .strict() rejects extras
    const bad = { issues: [{ id: 'S-1', title: 't', summary: '', status: 'draft', acceptanceCriteria: [], extra: 1 }] };
    expect(SpecRootSchema.safeParse(bad).success).toBe(false);
  });

  test("evidence accepts an abbreviated commit SHA that prefixes a full repo hash", () => {
    const full = "abc1234" + "0".repeat(33);
    const md = `# S1: Spec issue\n\nStatus: in-review\nSummary: s\n\n## Acceptance Criteria\n\n- [x] A1 first ac\n  - commit: abc1234\n`;
    const errs = checkSpec(md, { git: { existingCommits: [full], prs: {} } }).findings.filter((f) => f.code === "evidence_commit_not_found");
    expect(errs).toHaveLength(0);
    // and with no git world, the check is skipped (cannot verify)
    expect(checkSpec(md, {}).findings.filter((f) => f.code === "evidence_commit_not_found")).toHaveLength(0);
  });

});
