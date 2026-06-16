import { describe, expect, test } from 'bun:test';
import { checkDefault, DefaultPreset, DefaultRootSchema, parseDefault, serializeDefault } from './default.ts';

const HEAD = 'cafe1234beef';
const PR = 'https://github.com/volter-ai/x/pull/5';
const ctx = { git: { existingCommits: [HEAD], prs: { [PR]: { headSha: HEAD, merged: false } } } };

const DOC = `# DEF-1: Appointment search

Assignee: otto
Summary: members find appointments fast
Status: in-review
PR: ${PR}

## Acceptance Criteria

- [x] AC-1 v2 Members can filter by status
  - status: passed
  - evidence ev1: image=shots/ac1.png commit=${HEAD} acv=2
  - proof: "ev1 shows the status filter applied" -> ev1
`;

describe('default preset', () => {
  test('mdast parses straight into the hard schema', () => {
    const root = DefaultRootSchema.parse(parseDefault(DOC)); // throws unless schema-valid
    const issue = root.issues[0]!;
    expect(issue).toMatchObject({ id: 'DEF-1', title: 'Appointment search', summary: 'members find appointments fast', status: 'in-review', assignee: 'otto' });
    expect(issue.pr).toEqual({ url: PR });
    const ac = issue.acceptanceCriteria[0]!;
    expect(ac).toMatchObject({ id: 'AC-1', status: 'passed', checked: true, text: 'Members can filter by status', version: 2 });
    expect(ac.evidence[0]).toMatchObject({ id: 'ev1', image: 'shots/ac1.png', commit: HEAD, acVersion: 2 });
    expect(ac.proof).toEqual({ explanation: 'ev1 shows the status filter applied', evidenceRefs: ['ev1'] });
  });

  test('clean in-review doc passes; export is the parsed root', () => {
    const r = checkDefault(DOC, ctx);
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.export!.issues[0]!.id).toBe('DEF-1');
  });

  test('rule: passed AC with no evidence fails', () => {
    const doc = `# D-1: x\n\nAssignee: otto\nStatus: draft\n\n## Acceptance Criteria\n\n- [x] AC-1 v1 done it\n  - status: passed\n`;
    const r = checkDefault(doc, ctx);
    expect(r.findings.some((f) => f.code === 'passed_ac_missing_evidence')).toBe(true);
    expect(r.ok).toBe(false);
  });

  test('rule: evidence citing a missing commit fails (git world)', () => {
    const r = checkDefault(DOC.replace(HEAD, 'deadbeef'), ctx);
    expect(r.findings.some((f) => f.code === 'evidence_commit_not_found')).toBe(true);
  });

  test('rule: evidence stale vs current PR head fails (git world)', () => {
    const otherHead = { git: { existingCommits: [HEAD], prs: { [PR]: { headSha: 'feed9999cafe', merged: false } } } };
    const r = checkDefault(DOC, otherHead);
    expect(r.findings.some((f) => f.code === 'evidence_sha_stale')).toBe(true);
  });

  test('rule: PR head unknown when git world has no head', () => {
    const r = checkDefault(DOC, { git: { existingCommits: [HEAD], prs: {} } });
    expect(r.findings.some((f) => f.code === 'current_head_unknown')).toBe(true);
  });

  test('rule: evidence captured against a stale AC version fails', () => {
    const r = checkDefault(DOC.replace('AC-1 v2', 'AC-1 v3'), ctx); // AC now v3, evidence still acv=2
    expect(r.findings.some((f) => f.code === 'evidence_ac_version_stale')).toBe(true);
  });

  test('rule: checkbox disagreeing with explicit status fails', () => {
    const doc = `# D-1: x\n\nAssignee: otto\nStatus: draft\n\n## Acceptance Criteria\n\n- [ ] AC-1 v1 a\n  - status: passed\n`;
    const r = checkDefault(doc, ctx);
    expect(r.findings.some((f) => f.code === 'ac_checkbox_status_mismatch')).toBe(true);
  });

  test('gate: ready with no ACs fails', () => {
    const doc = `# D-1: x\n\nAssignee: otto\nStatus: ready\n\n## Acceptance Criteria\n`;
    const r = checkDefault(doc, ctx);
    expect(r.findings.some((f) => f.code === 'ready_requires_dev_ac')).toBe(true);
  });

  test('gate: in-review without a PR fails', () => {
    const doc = `# D-1: x\n\nAssignee: otto\nStatus: in-review\n\n## Acceptance Criteria\n\n- [x] AC-1 v1 a\n  - status: passed\n  - evidence ev1: image=p.png commit=${HEAD} acv=1\n`;
    const r = checkDefault(doc, ctx);
    expect(r.findings.some((f) => f.code === 'review_requires_pr')).toBe(true);
  });

  test('gate: in-review with an unpassed AC fails', () => {
    const doc = DOC + `- [ ] AC-2 v1 search by provider\n  - status: pending\n`;
    const r = checkDefault(doc, ctx);
    expect(r.findings.some((f) => f.code === 'review_requires_all_acs_passed')).toBe(true);
  });

  test('gate: done requires a merged PR (git world)', () => {
    const doneDoc = DOC.replace('Status: in-review', 'Status: done');
    expect(checkDefault(doneDoc, ctx).findings.some((f) => f.code === 'done_requires_merged_pr')).toBe(true);
    const merged = { git: { existingCommits: [HEAD], prs: { [PR]: { headSha: HEAD, merged: true } } } };
    expect(checkDefault(doneDoc, merged).ok).toBe(true);
  });

  test('rule: missing assignee fails', () => {
    const doc = `# D-1: x\n\nStatus: draft\n\n## Acceptance Criteria\n`;
    const r = checkDefault(doc, ctx);
    expect(r.findings.some((f) => f.code === 'issue_missing_assignee')).toBe(true);
  });

  test('hard schema: an unknown status is a wellformed error', () => {
    const doc = `# D-1: x\n\nAssignee: otto\nStatus: shipped\n\n## Acceptance Criteria\n`;
    const r = checkDefault(doc, ctx);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === 'wellformed_shape')).toBe(true);
  });

  test('hard schema: strict rejects a stray field', () => {
    const bad = { issues: [{ id: 'D-1', title: 't', summary: '', status: 'draft', assignee: 'otto', acceptanceCriteria: [], extra: 1 }] };
    expect(DefaultRootSchema.safeParse(bad).success).toBe(false);
  });

  test('proof: a passed AC without a proof fails (evidence needs explanation)', () => {
    const doc = DOC.replace('  - proof: "ev1 shows the status filter applied" -> ev1\n', '');
    const r = checkDefault(doc, ctx);
    expect(r.findings.some((f) => f.code === 'passed_ac_missing_proof')).toBe(true);
    expect(r.ok).toBe(false);
  });

  test('proof: referencing evidence that does not exist fails', () => {
    const doc = DOC.replace('-> ev1', '-> ev9');
    const r = checkDefault(doc, ctx);
    expect(r.findings.some((f) => f.code === 'proof_evidence_ref_missing')).toBe(true);
  });

  test('primitives: labels, relations, linked issues, children parse into the schema', () => {
    const doc = `# D-1: x

Assignee: otto
Status: draft
Labels: backend, urgent
Children: D-2, D-3
Blocks: D-4
Blocked by: D-5
Relates: D-6
Linked: jira PEAK-12 https://jira/PEAK-12

## Acceptance Criteria

- [ ] AC-1 v1 a
  - status: pending
`;
    const issue = DefaultRootSchema.parse(parseDefault(doc)).issues[0]!;
    expect(issue.labels).toEqual(['backend', 'urgent']);
    expect(issue.children).toEqual(['D-2', 'D-3']);
    expect(issue.relations).toEqual([
      { type: 'blocks', issueId: 'D-4' },
      { type: 'blocked-by', issueId: 'D-5' },
      { type: 'relates', issueId: 'D-6' },
    ]);
    expect(issue.linkedIssues).toEqual([{ system: 'jira', key: 'PEAK-12', url: 'https://jira/PEAK-12' }]);
  });

  test('the preset declares which primitives it implements', () => {
    expect(DefaultPreset.primitives).toMatchObject({ proof: true, labels: true, relations: true, linkedIssues: true, children: true, sources: false, category: false });
  });

  test('serialize is the inverse of parse (structured round-trip)', () => {
    const doc = `# D-1: Full issue

Assignee: otto
Summary: a complete issue
Status: in-review
PR: feat/x
Labels: backend, urgent
Children: D-2, D-3
Blocks: D-4
Blocked by: D-5
Relates: D-6
Linked: jira PEAK-12 https://jira/PEAK-12

## Acceptance Criteria

- [x] AC-1 v2 first criterion
  - status: passed
  - evidence ev1: image=shots/a.png commit=${HEAD} acv=2
  - proof: "ev1 proves it" -> ev1
- [ ] AC-2 v1 second criterion
  - status: pending
`;
    const parsed = DefaultRootSchema.parse(parseDefault(doc));
    const reparsed = DefaultRootSchema.parse(parseDefault(serializeDefault(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  test("a soft-wrapped AC line still parses id + version (first line only)", () => {
    const md = `# I1: Title\n\nAssignee: alice\nStatus: ready\n\n## Acceptance Criteria\n\n- [ ] AC1 v1 The user can log in\n  and reset later\n`;
    const ac = (parseDefault(md) as any).issues[0].acceptanceCriteria[0];
    expect(ac.id).toBe("AC1");
    expect(ac.version).toBe(1);
  });

});
