import { describe, expect, test } from 'bun:test';
import type { CoreRoot, IssueRecord, Preset } from 'ztrack/preset-kit';
import { assertNotePositionFidelity, assertRoundTripFidelity, assertSdlcGrammarConformance } from '../../src/testkit/presetConformance.ts';
import { checkDefault, DefaultPreset, DefaultRootSchema, parseDefault, serializeIssue } from './simple-sdlc.ts';

const HEAD = 'cafe1234beef';
// simple-sdlc is PR-FREE: no PR branches in the git world.
const ctx = { git: { existingCommits: [HEAD] } };

const REC: IssueRecord = {
  id: 'DEF-1', title: 'Appointment search', status: 'in-review', assignee: 'otto',
  body: `Summary: members find appointments fast

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

// an unknown "## Context" section sitting BETWEEN the header (Summary) and "## Acceptance
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

describe('simple-sdlc preset', () => {
  test('mdast parses straight into the hard schema', () => {
    const root = DefaultRootSchema.parse(parseDefault([REC])); // throws unless schema-valid
    const issue = root.issues[0]!;
    expect(issue).toMatchObject({ id: 'DEF-1', title: 'Appointment search', summary: 'members find appointments fast', status: 'in-review', assignee: 'otto' });
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

  assertSdlcGrammarConformance({ checkDefault, parseDefault, HEAD, REC });
  assertRoundTripFidelity({
    preset: rtPreset,
    canonical: { title: REC.title, status: REC.status, body: REC.body },
    edit: { record: EDIT_REC, acId: 'AC-1', patch: { checked: true, status: 'passed', evidence: [{ id: 'ev1', commit: HEAD, acVersion: 1 }], proof: { explanation: 'ev1 shows it', evidenceRefs: ['ev1'] } } },
  });
  assertNotePositionFidelity({ preset: rtPreset, record: NOTE_BETWEEN_REC });
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

  test('gate: in-review WITHOUT a PR passes (PR-free) — review is the verdict, not a PR', () => {
    const rec: IssueRecord = { id: 'D-1', title: 'x', status: 'in-review', assignee: 'otto',
      body: `## Acceptance Criteria\n\n- [x] AC-1 v1 a\n  - status: passed\n  - evidence ev1: image=p.png commit=${HEAD} acv=1\n  - proof: "ev1 shows it" -> ev1\n` };
    const r = checkDefault([rec], { git: { existingCommits: [HEAD], evidenceBlobs: { [`${HEAD}:p.png`]: true } } });
    expect(r.findings.some((f) => f.code === 'review_requires_pr')).toBe(false);
    expect(r.ok).toBe(true);
  });

  test('gate: in-review with an unpassed AC fails', () => {
    const rec: IssueRecord = { ...REC, body: REC.body + `- [ ] AC-2 v1 search by provider\n  - status: pending\n` };
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'review_requires_all_acs_passed')).toBe(true);
  });

  test('gate: done with all ACs passed-with-evidence passes — no PR required', () => {
    const doneRec: IssueRecord = { ...REC, status: 'done' };
    const r = checkDefault([doneRec], { git: { existingCommits: [HEAD], evidenceBlobs: { [`${HEAD}:shots/ac1.png`]: true } } });
    expect(r.findings.some((f) => f.code === 'done_requires_merged_pr')).toBe(false);
    expect(r.ok).toBe(true);
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
  // parse as intended must be LOUD (a warning finding), never silently dropped.
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

  // ZTB-15: non-checkbox content (a bare paragraph, a blockquote, a plain non-checkbox list item)
  // sitting INSIDE a recognized "## Acceptance Criteria" section has no branch in the mdast walk
  // and no model field to carry it — it vanished with no trace at all. `ac_outside_section`
  // (ZTB-1) covers the OUTSIDE case; this is the section's own interior blind spot.
  describe('ac_prose_in_section (ZTB-15)', () => {
    test('a bare paragraph between two checkbox ACs yields ac_prose_in_section, naming the excerpt and line', () => {
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `## Acceptance Criteria\n\n- [ ] dev/01 v1 first\n  - status: pending\n\nA stray note left between two ACs.\n\n- [ ] dev/02 v1 second\n  - status: pending\n`,
      };
      const r = checkDefault([rec], ctx);
      const finding = r.findings.find((f) => f.code === 'ac_prose_in_section');
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('D-1');
      expect(finding?.message).toContain('A stray note left between two ACs.');
      expect(finding?.message).toMatch(/line 6/);
      expect(finding?.issueId).toBe('D-1');
      // the model is untouched: both real ACs still parse, nothing extra
      const root = parseDefault([rec]) as { issues: { acceptanceCriteria: { id: string }[] }[] };
      expect(root.issues[0]!.acceptanceCriteria.map((ac) => ac.id)).toEqual(['dev/01', 'dev/02']);
    });

    test('a blockquote inside the AC section yields ac_prose_in_section', () => {
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `## Acceptance Criteria\n\n- [ ] dev/01 v1 first\n  - status: pending\n\n> a quoted aside inside the AC section\n\n- [ ] dev/02 v1 second\n  - status: pending\n`,
      };
      const r = checkDefault([rec], ctx);
      const finding = r.findings.find((f) => f.code === 'ac_prose_in_section');
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('a quoted aside inside the AC section');
      const root = parseDefault([rec]) as { issues: { acceptanceCriteria: { id: string }[] }[] };
      expect(root.issues[0]!.acceptanceCriteria.map((ac) => ac.id)).toEqual(['dev/01', 'dev/02']);
    });

    test('a plain (non-checkbox) list item inside the AC section yields ac_prose_in_section and is NOT mangled into a bogus AC', () => {
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `## Acceptance Criteria\n\n- [ ] dev/01 v1 first\n  - status: pending\n\n- a plain bullet, not a checkbox\n\n- [ ] dev/02 v1 second\n  - status: pending\n`,
      };
      const r = checkDefault([rec], ctx);
      const finding = r.findings.find((f) => f.code === 'ac_prose_in_section');
      expect(finding?.severity).toBe('warning');
      expect(finding?.message).toContain('a plain bullet, not a checkbox');
      // only the two REAL (checkbox) ACs are in the model — the plain bullet never became a
      // spurious third AC (which is what happened before this fix: see the git history for the
      // pre-fix probe showing it minted a bogus AC id "a").
      const root = parseDefault([rec]) as { issues: { acceptanceCriteria: { id: string }[] }[] };
      expect(root.issues[0]!.acceptanceCriteria.map((ac) => ac.id)).toEqual(['dev/01', 'dev/02']);
    });

    // Every fixture in this file that was green BEFORE ZTB-15 must stay green AFTER it — zero NEW
    // diagnostics, proven explicitly (not just inferred from "the other tests still pass").
    test('previously-green fixtures (REC, EDIT_REC, NOTE_BETWEEN_REC) emit zero ac_prose_in_section diagnostics', () => {
      for (const rec of [REC, EDIT_REC, NOTE_BETWEEN_REC]) {
        const r = checkDefault([rec], ctx);
        expect(r.findings.filter((f) => f.code === 'ac_prose_in_section')).toHaveLength(0);
      }
    });
  });

  // ZTB-10 (residual R4): bare leading prose — content before the FIRST "## " heading that is
  // not a recognized metadata line — used to vanish silently on a patch/fmt round trip. See the
  // `prose` schema field comment. These tests prove the carry, its idempotence, and zero churn
  // for bodies that have none.
  describe('bare leading prose (ZTB-10)', () => {
    test('a bare leading prose paragraph round-trips (structured round-trip)', () => {
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `Bare leading prose paragraph not under any subsection heading.\n\n## Acceptance Criteria\n\n- [ ] AC-1 v1 do the thing\n  - status: pending\n`,
      };
      const root = DefaultRootSchema.parse(parseDefault([rec]));
      const issue = root.issues[0]!;
      expect(issue.prose).toBe('Bare leading prose paragraph not under any subsection heading.');
      const { body, columns } = serializeIssue(issue);
      expect(body).toBe(rec.body); // byte-identical (canonical spacing already matched)
      const reparsed = DefaultRootSchema.parse(parseDefault([{ id: issue.id, title: columns.title!, status: columns.status!, assignee: columns.assignee, labels: columns.labels, body }]));
      expect(reparsed.issues[0]).toEqual(issue);
    });

    test('prose interleaved with metadata lines is preserved without duplication (serialize -> parse -> serialize fixed point)', () => {
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `Intro prose\nSummary: x\nMore prose\n\n## Acceptance Criteria\n\n- [ ] AC-1 v1 do it\n  - status: pending\n`,
      };
      const root1 = DefaultRootSchema.parse(parseDefault([rec]));
      const issue1 = root1.issues[0]!;
      expect(issue1.summary).toBe('x');
      expect(issue1.prose).toBe('Intro prose\nMore prose');
      const { body: body1, columns } = serializeIssue(issue1);
      expect((body1.match(/^Summary:/gm) ?? []).length).toBe(1); // metadata not duplicated
      const root2 = DefaultRootSchema.parse(parseDefault([{ id: issue1.id, title: columns.title!, status: columns.status!, assignee: columns.assignee, labels: columns.labels, body: body1 }]));
      const issue2 = root2.issues[0]!;
      expect(issue2).toEqual(issue1); // fixed point on the model
      const { body: body2 } = serializeIssue(issue2);
      expect(body2).toBe(body1); // fixed point on the bytes
    });

    test('a preamble with a ### sub-heading and a fenced code block is carried verbatim', () => {
      const preamble = '### Design notes\n\nSome context.\n\n```ts\nconst x = 1;\n```';
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `${preamble}\n\n## Acceptance Criteria\n\n- [ ] AC-1 v1 do it\n  - status: pending\n`,
      };
      const root = DefaultRootSchema.parse(parseDefault([rec]));
      const issue = root.issues[0]!;
      expect(issue.prose).toBe(preamble);
      const { body } = serializeIssue(issue);
      expect(body).toContain(preamble);
    });

    test('a body with no bare leading prose serializes to identical bytes to a model with no `prose` field (no churn)', () => {
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `Summary: no prose here\nChildren: D-2\n\n## Acceptance Criteria\n\n- [ ] AC-1 v1 do it\n  - status: pending\n`,
      };
      const root = DefaultRootSchema.parse(parseDefault([rec]));
      const issue = root.issues[0]!;
      expect(issue.prose).toBeUndefined();
      const { body } = serializeIssue(issue);
      const { prose: _drop, ...withoutProseField } = issue as typeof issue & { prose?: string };
      const { body: bodyWithoutProseField } = serializeIssue(withoutProseField as typeof issue);
      expect(body).toBe(bodyWithoutProseField);
      expect(body).toBe(rec.body); // exact byte round trip, matching the pre-ZTB-10 behavior
    });

    test('a checkbox line in the preamble is carried as prose AND still raises ac_outside_section', () => {
      const rec: IssueRecord = {
        id: 'D-1', title: 'x', status: 'draft', assignee: 'otto',
        body: `- [ ] fix the thing outside any section\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 the real AC\n  - status: pending\n`,
      };
      // parseDefault (not schema.parse) — this fixture also raises a `diagnostics` key, which the
      // strict DefaultRootSchema rejects (see the existing ac_outside_section test above).
      const root = parseDefault([rec]) as { issues: { prose?: string }[] };
      expect(root.issues[0]!.prose).toBe('- [ ] fix the thing outside any section');
      const r = checkDefault([rec], ctx);
      expect(r.findings.some((f) => f.code === 'ac_outside_section')).toBe(true);
    });
  });

});
