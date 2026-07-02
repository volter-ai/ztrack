import { describe, expect, test } from 'bun:test';
import type { CoreRoot, IssueRecord, Preset } from 'ztrack/preset-kit';
import { assertNotePositionFidelity, assertRoundTripFidelity, assertSdlcGrammarConformance } from '../../src/testkit/presetConformance.ts';
import { checkDefault, DefaultPreset, DefaultRootSchema, parseDefault, serializeIssue } from './simple-gh-sdlc.ts';

const HEAD = 'cafe1234beef';
const PR = 'https://github.com/volter-ai/x/pull/5';
const ctx = { git: { existingCommits: [HEAD], prs: { [PR]: { headSha: HEAD, merged: false } } } };

const REC: IssueRecord = {
  id: 'DEF-1', title: 'Appointment search', status: 'in-review', assignee: 'otto',
  body: `Summary: members find appointments fast
PR: ${PR}

## Acceptance Criteria

- [x] AC-1 v2 Members can filter by status
  - status: passed
  - evidence ev1: image=shots/ac1.png commit=${HEAD} acv=2
  - proof: "ev1 shows the status filter applied" -> ev1
`,
};

// ZTB-5 round-trip fidelity fixtures — see assertRoundTripFidelity/assertNotePositionFidelity.
const rtPreset = DefaultPreset as unknown as Preset<CoreRoot>;

// two ACs, so editing one has an OTHER AC's lines to prove untouched (edit-locality).
const EDIT_REC: IssueRecord = {
  id: 'DEF-2', title: 'Two things to do', status: 'in-progress', assignee: 'otto',
  body: `Summary: two independent criteria

## Acceptance Criteria

- [ ] AC-1 v1 First criterion
  - status: pending
- [ ] AC-2 v1 Second criterion
  - status: pending
`,
};

// an unknown "## Context" section sitting BETWEEN the header (Summary/PR) and "## Acceptance
// Criteria" — the case that must FAIL before the ZTB-5 fix (notes always re-emitted last) and
// PASS after it (notes re-emitted in their original position).
const NOTE_BETWEEN_REC: IssueRecord = {
  id: 'DEF-3', title: 'Has engineering context', status: 'draft', assignee: 'otto',
  body: `Summary: something to do

## Context

Some engineering context that must stay exactly here, not at the end.

## Acceptance Criteria

- [ ] AC-1 v1 do it
  - status: pending
`,
};

describe('simple-gh-sdlc preset', () => {
  test('mdast parses straight into the hard schema', () => {
    const root = DefaultRootSchema.parse(parseDefault([REC])); // throws unless schema-valid
    const issue = root.issues[0]!;
    expect(issue).toMatchObject({ id: 'DEF-1', title: 'Appointment search', summary: 'members find appointments fast', status: 'in-review', assignee: 'otto' });
    expect(issue.pr).toEqual({ url: PR });
    const ac = issue.acceptanceCriteria[0]!;
    expect(ac).toMatchObject({ id: 'AC-1', status: 'passed', checked: true, text: 'Members can filter by status', version: 2 });
    expect(ac.evidence[0]).toMatchObject({ id: 'ev1', image: 'shots/ac1.png', commit: HEAD, acVersion: 2 });
    expect(ac.proof).toEqual({ explanation: 'ev1 shows the status filter applied', evidenceRefs: ['ev1'] });
  });

  test('clean in-review doc passes; export is the parsed root', () => {
    const r = checkDefault([REC], ctx);
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.export!.issues[0]!.id).toBe('DEF-1');
  });

  test('rule: passed AC with no evidence fails', () => {
    const rec: IssueRecord = { id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
      body: `## Acceptance Criteria\n\n- [x] AC-1 v1 done it\n  - status: passed\n` };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'passed_ac_missing_evidence')).toBe(true);
    expect(r.ok).toBe(false);
  });

  test('findings are SELF-DOCUMENTING: each carries a located fix hint naming the resolution', () => {
    const fixOf = (recs: IssueRecord[], code: string) => checkDefault(recs, ctx).findings.find((f) => f.code === code)?.fix ?? '';
    const ac = (lines: string) => [{ id: 'D-1', title: 'x', status: 'draft', assignee: 'me', body: `## Acceptance Criteria\n\n- [x] AC-1 v1 do it\n${lines}` } as IssueRecord];
    // evidence/proof/commit findings → the exact `ztrack ac patch <issue> <ac>` to run, located
    expect(fixOf(ac('  - status: passed\n'), 'passed_ac_missing_evidence')).toMatch(/ztrack ac patch D-1 AC-1 .*evidence/);
    expect(fixOf(ac(`  - status: passed\n  - evidence ev1: image=x.png commit=${HEAD} acv=1\n`), 'passed_ac_missing_proof')).toMatch(/ztrack ac patch D-1 AC-1 .*proof/);
    expect(fixOf([{ ...REC, body: REC.body.replace(HEAD, 'deadbeef') }], 'evidence_commit_not_found')).toMatch(/ztrack ac patch DEF-1 .*commit that exists/);
    // an issue-level finding → an issue-level action, not ac patch
    expect(fixOf([{ id: 'D-1', title: 'x', status: 'draft', assignee: '', body: '## Acceptance Criteria\n\n- [ ] AC-1 v1 do it\n  - status: pending\n' }], 'issue_missing_assignee')).toMatch(/ztrack issue edit D-1 --assignee/);
    // a finding the preset gives NO specific hint for still gets the universal FLOOR (located inspect)
    const floor = fixOf([{ id: 'X-1', title: 'a', status: 'draft', assignee: 'me', body: 'x' }, { id: 'X-1', title: 'b', status: 'draft', assignee: 'me', body: 'y' }], 'duplicate_issue_id');
    expect(floor).toMatch(/ztrack issue view X-1/);
    expect(floor.length).toBeGreaterThan(0);
  });

  test('rule: evidence citing a missing commit fails (git world)', () => {
    const rec: IssueRecord = { ...REC, body: REC.body.replace(HEAD, 'deadbeef') };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'evidence_commit_not_found')).toBe(true);
  });

  test('rule: evidence stale vs current PR head fails (git world)', () => {
    const otherHead = { git: { existingCommits: [HEAD], prs: { [PR]: { headSha: 'feed9999cafe', merged: false } } } };
    const r = checkDefault([REC], otherHead);
    expect(r.findings.some((f) => f.code === 'evidence_sha_stale')).toBe(true);
  });

  assertSdlcGrammarConformance({ checkDefault, parseDefault, HEAD, REC });
  assertRoundTripFidelity({
    preset: rtPreset,
    canonical: { title: REC.title, status: REC.status, body: REC.body },
    edit: { record: EDIT_REC, acId: 'AC-1', patch: { checked: true, status: 'passed', evidence: [{ id: 'ev1', commit: HEAD, acVersion: 1 }], proof: { explanation: 'ev1 shows it', evidenceRefs: ['ev1'] } } },
  });
  assertNotePositionFidelity({ preset: rtPreset, record: NOTE_BETWEEN_REC });

  test('rule: PR head unknown when git world has no head', () => {
    const r = checkDefault([REC], { git: { existingCommits: [HEAD], prs: {} } });
    expect(r.findings.some((f) => f.code === 'current_head_unknown')).toBe(true);
  });

  test('rule: checkbox disagreeing with explicit status fails', () => {
    const rec: IssueRecord = { id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
      body: `## Acceptance Criteria\n\n- [ ] AC-1 v1 a\n  - status: passed\n` };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'ac_checkbox_status_mismatch')).toBe(true);
  });

  test('gate: ready with no ACs fails', () => {
    const rec: IssueRecord = { id: 'D-1', title: 'x', status: 'ready', assignee: 'otto',
      body: `## Acceptance Criteria\n` };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'ready_requires_dev_ac')).toBe(true);
  });

  test('gate: in-review without a PR fails', () => {
    const rec: IssueRecord = { id: 'D-1', title: 'x', status: 'in-review', assignee: 'otto',
      body: `## Acceptance Criteria\n\n- [x] AC-1 v1 a\n  - status: passed\n  - evidence ev1: image=p.png commit=${HEAD} acv=1\n` };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'review_requires_pr')).toBe(true);
  });

  test('gate: in-review with an unpassed AC fails', () => {
    const rec: IssueRecord = { ...REC, body: REC.body + `- [ ] AC-2 v1 search by provider\n  - status: pending\n` };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'review_requires_all_acs_passed')).toBe(true);
  });

  test('gate: done requires a merged PR (git world)', () => {
    const doneRec: IssueRecord = { ...REC, status: 'done' };
    expect(checkDefault([doneRec], ctx).findings.some((f) => f.code === 'done_requires_merged_pr')).toBe(true);
    const merged = { git: { existingCommits: [HEAD], prs: { [PR]: { headSha: HEAD, merged: true } } } };
    expect(checkDefault([doneRec], merged).ok).toBe(true);
  });

  test('rule: missing assignee fails', () => {
    const rec: IssueRecord = { id: 'D-1', title: 'x', status: 'draft', body: `## Acceptance Criteria\n` };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'issue_missing_assignee')).toBe(true);
  });

  test('hard schema: an unknown status is a wellformed error', () => {
    const rec: IssueRecord = { id: 'D-1', title: 'x', status: 'shipped', assignee: 'otto', body: `## Acceptance Criteria\n` };
    const r = checkDefault([rec], ctx);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === 'wellformed_shape')).toBe(true);
  });

  test('hard schema: strict rejects a stray field', () => {
    const bad = { issues: [{ id: 'D-1', title: 't', summary: '', status: 'draft', assignee: 'otto', acceptanceCriteria: [], extra: 1 }] };
    expect(DefaultRootSchema.safeParse(bad).success).toBe(false);
  });

  test('proof: a passed AC without a proof fails (evidence needs explanation)', () => {
    const rec: IssueRecord = { ...REC, body: REC.body.replace('  - proof: "ev1 shows the status filter applied" -> ev1\n', '') };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'passed_ac_missing_proof')).toBe(true);
    expect(r.ok).toBe(false);
  });

  test('proof: referencing evidence that does not exist fails', () => {
    const rec: IssueRecord = { ...REC, body: REC.body.replace('-> ev1', '-> ev9') };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'proof_evidence_ref_missing')).toBe(true);
  });

  test('primitives: labels, relations, linked issues, children parse into the schema', () => {
    const rec: IssueRecord = {
      id: 'D-1', title: 'x', status: 'draft', assignee: 'otto', labels: ['backend', 'urgent'],
      body: `Children: D-2, D-3
Blocks: D-4
Blocked by: D-5
Relates: D-6

## Acceptance Criteria

- [ ] AC-1 v1 a
  - status: pending
`,
    };
    const issue = DefaultRootSchema.parse(parseDefault([rec])).issues[0]!;
    expect(issue.labels).toEqual(['backend', 'urgent']);
    expect(issue.children).toEqual(['D-2', 'D-3']);
    expect(issue.relations).toEqual([
      { type: 'blocks', issueId: 'D-4' },
      { type: 'blocked-by', issueId: 'D-5' },
      { type: 'relates', issueId: 'D-6' },
    ]);
  });

  test('the preset declares which primitives it implements', () => {
    expect(DefaultPreset.primitives).toMatchObject({ proof: true, labels: true, relations: true, children: true, blocking: true, sources: false, category: false });
  });

  test('serialize is the inverse of parse (structured round-trip)', () => {
    const rec: IssueRecord = {
      id: 'D-1', title: 'Full issue', status: 'in-review', assignee: 'otto', labels: ['backend', 'urgent'],
      body: `Summary: a complete issue
PR: feat/x
Children: D-2, D-3
Blocks: D-4
Blocked by: D-5
Relates: D-6

## Acceptance Criteria

- [x] AC-1 v2 first criterion
  - status: passed
  - evidence ev1: image=shots/a.png commit=${HEAD} acv=2
  - proof: "ev1 proves it" -> ev1
- [ ] AC-2 v1 second criterion
  - status: pending
`,
    };
    const root = DefaultRootSchema.parse(parseDefault([rec]));
    const issue = root.issues[0]!;
    const { body, columns } = serializeIssue(issue);
    const reparsed = DefaultRootSchema.parse(parseDefault([{ id: issue.id, title: columns.title!, status: columns.status!, assignee: columns.assignee, labels: columns.labels, body }]));
    expect(reparsed.issues[0]).toEqual(issue);
  });

  test("a soft-wrapped AC line still parses id + version (first line only)", () => {
    const rec: IssueRecord = { id: 'I1', title: 'Title', status: 'ready', assignee: 'alice',
      body: `## Acceptance Criteria\n\n- [ ] AC1 v1 The user can log in\n  and reset later\n` };
    const ac = (parseDefault([rec]) as any).issues[0].acceptanceCriteria[0];
    expect(ac.id).toBe("AC1");
    expect(ac.version).toBe(1);
  });

  test('multi-issue: records parse into a multi-issue root', () => {
    const recs: IssueRecord[] = [
      { id: 'A-1', title: 'Alpha', status: 'draft', assignee: 'otto', body: `## Acceptance Criteria\n` },
      { id: 'B-2', title: 'Beta', status: 'draft', assignee: 'ana', body: `## Acceptance Criteria\n` },
    ];
    const root = DefaultRootSchema.parse(parseDefault(recs));
    expect(root.issues.map((i) => i.id)).toEqual(['A-1', 'B-2']);
  });

  test('cross-issue: duplicate issue ids across the tracker fail', () => {
    const rec: IssueRecord = { id: 'DUP', title: 'one', status: 'draft', assignee: 'otto', body: `## Acceptance Criteria\n` };
    const r = checkDefault([rec, { ...rec }], ctx);
    expect(r.findings.some((f) => f.code === 'duplicate_issue_id')).toBe(true);
    expect(r.ok).toBe(false);
  });

  test('cross-issue: a relation to a missing issue fails; reciprocal blocks pass', () => {
    const dangling: IssueRecord = { id: 'A-1', title: 'a', status: 'draft', assignee: 'otto', body: `Blocks: GHOST\n\n## Acceptance Criteria\n` };
    expect(checkDefault([dangling], ctx).findings.some((f) => f.code === 'relation_target_missing')).toBe(true);
    const a: IssueRecord = { id: 'A-1', title: 'a', status: 'draft', assignee: 'otto', body: `Blocks: B-1\n\n## Acceptance Criteria\n` };
    const b: IssueRecord = { id: 'B-1', title: 'b', status: 'draft', assignee: 'ana', body: `Blocked by: A-1\n\n## Acceptance Criteria\n` };
    const r = checkDefault([a, b], ctx);
    expect(r.findings.some((f) => f.code === 'relation_target_missing' || f.code === 'relation_not_reciprocal')).toBe(false);
  });

  describe('AC-level blocking', () => {
    test('parses blocked-by/blocks sub-lines, resolving bare and cross-issue refs', () => {
      const rec: IssueRecord = { id: 'A-1', title: 'a', status: 'ready', assignee: 'otto',
        body: `## Acceptance Criteria\n\n- [ ] AC-1 v1 second\n  - status: pending\n  - blocked-by: AC-2, B-1:AC-9\n  - blocks: AC-3\n- [ ] AC-2 v1 first\n  - status: pending\n- [ ] AC-3 v1 third\n  - status: pending\n` };
      const ac = DefaultRootSchema.parse(parseDefault([rec])).issues[0]!.acceptanceCriteria[0]!;
      expect(ac.blockedBy).toEqual([{ issue: 'A-1', ac: 'AC-2' }, { issue: 'B-1', ac: 'AC-9' }]);
      expect(ac.blocks).toEqual([{ issue: 'A-1', ac: 'AC-3' }]);
    });

    test('round-trips through serialize (bare stays bare, cross-issue stays qualified)', () => {
      const rec: IssueRecord = { id: 'A-1', title: 'a', status: 'ready', assignee: 'otto',
        body: `## Acceptance Criteria\n\n- [ ] AC-1 v1 first\n  - status: pending\n  - blocked-by: AC-2, B-1:AC-9\n- [ ] AC-2 v1 second\n  - status: pending\n` };
      const root = DefaultRootSchema.parse(parseDefault([rec]));
      const issue = root.issues[0]!;
      const { body, columns } = serializeIssue(issue);
      const reparsed = DefaultRootSchema.parse(parseDefault([{ id: issue.id, title: columns.title!, status: columns.status!, assignee: columns.assignee, labels: columns.labels, body }]));
      expect(reparsed.issues[0]).toEqual(issue);
    });

    test('a blocker to a missing AC fails; a self-block fails', () => {
      const missing: IssueRecord = { id: 'A-1', title: 'a', status: 'ready', assignee: 'otto',
        body: `## Acceptance Criteria\n\n- [ ] AC-1 v1 x\n  - status: pending\n  - blocked-by: AC-9\n` };
      expect(checkDefault([missing], ctx).findings.some((f) => f.code === 'ac_blocker_missing')).toBe(true);
      const self: IssueRecord = { id: 'A-1', title: 'a', status: 'ready', assignee: 'otto',
        body: `## Acceptance Criteria\n\n- [ ] AC-1 v1 x\n  - status: pending\n  - blocked-by: AC-1\n` };
      expect(checkDefault([self], ctx).findings.some((f) => f.code === 'ac_self_block')).toBe(true);
    });

    test('a passed AC blocked by an unpassed AC fails', () => {
      const rec: IssueRecord = { id: 'A-1', title: 'a', status: 'ready', assignee: 'otto',
        body: `## Acceptance Criteria\n\n- [x] AC-1 v1 done\n  - status: passed\n  - evidence ev1: image=a.png commit=${HEAD} acv=1\n  - proof: "ev1 proves it" -> ev1\n  - blocked-by: AC-2\n- [ ] AC-2 v1 not done\n  - status: pending\n` };
      const r = checkDefault([rec], ctx);
      expect(r.findings.some((f) => f.code === 'ac_blocked_by_unpassed')).toBe(true);
    });
  });

  // ZTB-1: fail-closed parse diagnostics — content that LOOKS like tracked work but doesn't
  // parse as intended must be LOUD (a warning finding), never silently dropped. simple-gh-sdlc
  // duplicates parseDefaultIssue's grammar (see simple-sdlc.test.ts for the twin coverage).
  describe('fail-closed parse diagnostics (ZTB-1)', () => {
    test('a clean single-AC-section fixture parses with no `diagnostics` key at all (exact-today shape)', () => {
      expect(parseDefault([REC])).not.toHaveProperty('diagnostics');
    });

    test('two `## Acceptance Criteria` sections MERGE (append) — never last-section-wins; ac_sections_multiple warns', () => {
      // the shape that bit the ZTB-1 plan docs themselves: first section 2 ACs, second 11 — 13 total.
      const section = (start: number, count: number) =>
        Array.from({ length: count }, (_, i) => `- [ ] dev/${String(start + i).padStart(2, '0')} v1 AC number ${start + i}\n  - status: pending\n`).join('');
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `## Acceptance Criteria\n\n${section(1, 2)}\n## Acceptance Criteria\n\n${section(3, 11)}`,
      };
      const root = parseDefault([rec]) as { issues: { acceptanceCriteria: { id: string }[] }[] };
      // ALL 13 survive, in order — the second section APPENDED, not last-section-wins.
      expect(root.issues[0]!.acceptanceCriteria.map((ac) => ac.id)).toEqual(
        Array.from({ length: 13 }, (_, i) => `dev/${String(i + 1).padStart(2, '0')}`),
      );
      const r = checkDefault([rec], ctx);
      const multi = r.findings.filter((f) => f.code === 'ac_sections_multiple');
      expect(multi).toHaveLength(1);
      expect(multi[0]?.severity).toBe('warning');
      expect(r.ok).toBe(true); // a warning never gates
    });

    test('a checkbox item outside any recognized AC section yields ac_outside_section', () => {
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `- [ ] fix the thing outside any section\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 the real AC\n  - status: pending\n`,
      };
      const r = checkDefault([rec], ctx);
      const finding = r.findings.find((f) => f.code === 'ac_outside_section');
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('fix the thing outside any section');
      expect(finding?.issueId).toBe('D-1');
      // the real AC still parses, unaffected
      const root = parseDefault([rec]) as { issues: { acceptanceCriteria: { id: string }[] }[] };
      expect(root.issues[0]!.acceptanceCriteria.map((ac) => ac.id)).toEqual(['dev/01']);
    });

    test('an AC line that only parses via the whole-line fallback yields ac_id_malformed naming the resulting id', () => {
      // a single token (no whitespace) fails BOTH `^(\S+)\s+v(\d+)\s+(.+)$` and `^(\S+)\s+(.+)$`,
      // so the whole line becomes the id — unaddressable by `ac patch`.
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `## Acceptance Criteria\n\n- [ ] fixthebug\n  - status: pending\n`,
      };
      const r = checkDefault([rec], ctx);
      const finding = r.findings.find((f) => f.code === 'ac_id_malformed');
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('fixthebug');
      const ac = (parseDefault([rec]) as { issues: { acceptanceCriteria: { id: string }[] }[] }).issues[0]!.acceptanceCriteria[0]!;
      expect(ac.id).toBe('fixthebug'); // the AC still "exists" (fail LOUD, not fail closed on the parse)
    });
  });

});
