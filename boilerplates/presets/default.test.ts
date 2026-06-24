import { describe, expect, test } from 'bun:test';
import type { IssueRecord } from 'ztrack/preset-kit';
import { checkDefault, DefaultPreset, DefaultRootSchema, parseDefault, serializeIssue } from './default.ts';

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

describe('default preset', () => {
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

  describe('rule: evidence_commit_unrelated (relevance gap)', () => {
    // A passed AC may declare `paths:`; its cited commit must TOUCH at least one. ctx.git.commitFiles
    // maps commit→files-it-changed (resolved offline by loadContext via `git show --name-only`).
    const recWith = (pathsLine: string) => ({
      ...REC,
      body: `## Acceptance Criteria\n\n- [x] AC-1 v2 do it\n  - status: passed\n${pathsLine}  - evidence ev1: commit=${HEAD} acv=2\n  - proof: "ev1 shows it" -> ev1\n`,
    } as IssueRecord);
    const ctxFiles = (files: string[]) => ({ git: { existingCommits: [HEAD], prs: {}, commitFiles: { [HEAD]: files } } });
    const fired = (pathsLine: string, files: string[]) =>
      checkDefault([recWith(pathsLine)], ctxFiles(files)).findings.some((f) => f.code === 'evidence_commit_unrelated');

    test('relevant commit (src/** ⊇ src/health.ts) → passes', () => {
      expect(fired('  - paths: src/**\n', ['src/health.ts'])).toBe(false);
    });
    test('unrelated commit (src/** vs docs/x.md) → fires', () => {
      expect(fired('  - paths: src/**\n', ['docs/x.md'])).toBe(true);
    });
    test('opt-in: no paths declared → never fires', () => {
      expect(fired('', ['docs/x.md'])).toBe(false);
    });
    test('single-star stays within a segment: src/*.ts matches src/a.ts but not src/sub/a.ts', () => {
      expect(fired('  - paths: src/*.ts\n', ['src/a.ts'])).toBe(false);
      expect(fired('  - paths: src/*.ts\n', ['src/sub/a.ts'])).toBe(true);
    });
    test('no commitFiles in context (offline, unresolved) → never false-flags', () => {
      const r = checkDefault([recWith('  - paths: src/**\n')], { git: { existingCommits: [HEAD], prs: {} } });
      expect(r.findings.some((f) => f.code === 'evidence_commit_unrelated')).toBe(false);
    });

    // ── adversarial matcher battery: glob/literal edge cases through the real rule path ──
    test('exact file path: matches itself, fires on a sibling', () => {
      expect(fired('  - paths: src/health.ts\n', ['src/health.ts'])).toBe(false);
      expect(fired('  - paths: src/health.ts\n', ['src/other.ts'])).toBe(true);
    });
    test('directory prefix respects the / boundary (src ⊉ srcfoo)', () => {
      expect(fired('  - paths: src\n', ['src/a.ts'])).toBe(false);   // dir prefix
      expect(fired('  - paths: src\n', ['srcfoo/a.ts'])).toBe(true); // not a prefix at a boundary
    });
    test('trailing slash on a dir path is normalized', () => {
      expect(fired('  - paths: src/\n', ['src/a.ts'])).toBe(false);
    });
    test('dots in a non-glob path are literal, not wildcards', () => {
      expect(fired('  - paths: src/a.b.ts\n', ['src/aXbYts'])).toBe(true);   // dots must not match arbitrary chars
      expect(fired('  - paths: src/a.b.ts\n', ['src/a.b.ts'])).toBe(false);
    });
    test('dots inside a glob are escaped (v*.ts is literal-dot then ts)', () => {
      expect(fired('  - paths: src/v*.ts\n', ['src/v1.ts'])).toBe(false);
      expect(fired('  - paths: src/v*.ts\n', ['src/v1.2.ts'])).toBe(false); // [^/]* spans the inner dot
      expect(fired('  - paths: src/v*.ts\n', ['src/v1Xts'])).toBe(true);    // the escaped dot must bite
    });
    test('? matches exactly one non-separator char', () => {
      expect(fired('  - paths: src/a?.ts\n', ['src/ab.ts'])).toBe(false);
      expect(fired('  - paths: src/a?.ts\n', ['src/abc.ts'])).toBe(true);   // ? is one char
      expect(fired('  - paths: src/a?.ts\n', ['src/a/.ts'])).toBe(true);    // ? must not cross /
    });
    test('** spans segments; bare ** matches everything', () => {
      expect(fired('  - paths: **\n', ['any/deep/nested/file.x'])).toBe(false);
      expect(fired('  - paths: src/**/util.ts\n', ['src/a/b/util.ts'])).toBe(false);
      expect(fired('  - paths: src/**/util.ts\n', ['src/util.ts'])).toBe(true); // ** between slashes needs a segment
    });
    test('multiple declared paths: touching ANY one passes', () => {
      expect(fired('  - paths: src/**, docs/**\n', ['docs/x.md'])).toBe(false);
      expect(fired('  - paths: src/**, docs/**\n', ['test/x.ts'])).toBe(true);
    });
    test('multiple cited commits: ANY commit touching a path passes', () => {
      const SHA2 = 'beadfacebeadfacebeadfacebeadfacebeadface';
      const rec = {
        ...REC,
        body: `## Acceptance Criteria\n\n- [x] AC-1 v2 do it\n  - status: passed\n  - paths: src/**\n  - evidence ev1: commit=${HEAD} acv=2\n  - evidence ev2: commit=${SHA2} acv=2\n  - proof: "ev1, ev2 show it" -> ev1, ev2\n`,
      } as IssueRecord;
      const ctx = { git: { existingCommits: [HEAD, SHA2], prs: {}, commitFiles: { [HEAD]: ['docs/x.md'], [SHA2]: ['src/a.ts'] } } };
      expect(checkDefault([rec], ctx).findings.some((f) => f.code === 'evidence_commit_unrelated')).toBe(false);
    });
    test('empty commit (touched nothing) → does not false-flag', () => {
      expect(fired('  - paths: src/**\n', [])).toBe(false);
    });
  });

  describe('rule: passed_ac_missing_paths (relevance enforcement, config.relevance: required)', () => {
    // A passed AC with no `paths`. ctx.relevance is the dial loadContext reads from config.
    const rec = (pathsLine: string) => ({
      ...REC,
      body: `## Acceptance Criteria\n\n- [x] AC-1 v2 do it\n  - status: passed\n${pathsLine}  - evidence ev1: commit=${HEAD} acv=2\n  - proof: "ev1 shows it" -> ev1\n`,
    } as IssueRecord);
    const base = { git: { existingCommits: [HEAD], prs: {}, commitFiles: { [HEAD]: ['src/a.ts'] } } };
    const fired = (ctx: object) =>
      checkDefault([rec('')], ctx).findings.some((f) => f.code === 'passed_ac_missing_paths');

    test('required + passed AC missing paths → fires', () => {
      expect(fired({ ...base, relevance: 'required' })).toBe(true);
    });
    test('default (no relevance dial) → never fires (opt-in, non-breaking)', () => {
      expect(fired(base)).toBe(false);
    });
    test("explicit 'optional' → never fires", () => {
      expect(fired({ ...base, relevance: 'optional' })).toBe(false);
    });
    test('required but paths ARE declared → does not fire', () => {
      const r = checkDefault([rec('  - paths: src/**\n')], { ...base, relevance: 'required' });
      expect(r.findings.some((f) => f.code === 'passed_ac_missing_paths')).toBe(false);
    });
    test('required + pending AC (not passed) → does not fire', () => {
      const pending = { ...REC, body: `## Acceptance Criteria\n\n- [ ] AC-1 v2 do it\n  - status: pending\n` } as IssueRecord;
      const r = checkDefault([pending], { ...base, relevance: 'required' });
      expect(r.findings.some((f) => f.code === 'passed_ac_missing_paths')).toBe(false);
    });
  });

  test('rule: PR head unknown when git world has no head', () => {
    const r = checkDefault([REC], { git: { existingCommits: [HEAD], prs: {} } });
    expect(r.findings.some((f) => f.code === 'current_head_unknown')).toBe(true);
  });

  test('rule: evidence captured against a stale AC version fails', () => {
    const rec: IssueRecord = { ...REC, body: REC.body.replace('AC-1 v2', 'AC-1 v3') }; // AC now v3, evidence still acv=2
    const r = checkDefault([rec], ctx);
    expect(r.findings.some((f) => f.code === 'evidence_ac_version_stale')).toBe(true);
  });

  describe('evidence field order-independence (anti-tamper)', () => {
    // SECURITY regression: a fabricated `image=` written AFTER `commit=` (the order the docs show)
    // must NOT be silently dropped — or the gate would pass an unverified screenshot. See parseEvidenceLine.
    const imageLast = (img: string) => ({
      ...REC,
      body: `## Acceptance Criteria\n\n- [x] AC-1 v2 do it\n  - status: passed\n  - evidence ev1: commit=${HEAD} acv=2 image=${img}\n  - proof: "ev1 shows it" -> ev1\n`,
    } as IssueRecord);

    test('image after commit is still captured by the parser', () => {
      const root = parseDefault([imageLast('shots/late.png')]) as { issues: { acceptanceCriteria: { evidence: { image?: string }[] }[] }[] };
      expect(root.issues[0]!.acceptanceCriteria[0]!.evidence[0]!.image).toBe('shots/late.png');
    });
    test('a fabricated image written AFTER commit is caught (evidence_file_not_found)', () => {
      const blobCtx = { git: { existingCommits: [HEAD], prs: {}, evidenceBlobs: { [`${HEAD}:shots/FAKE.png`]: false } } };
      const r = checkDefault([imageLast('shots/FAKE.png')], blobCtx);
      expect(r.findings.some((f) => f.code === 'evidence_file_not_found')).toBe(true);
    });
    test('a real image (present in tree) passes in image-after-commit order', () => {
      const blobCtx = { git: { existingCommits: [HEAD], prs: {}, evidenceBlobs: { [`${HEAD}:shots/real.png`]: true } } };
      const r = checkDefault([imageLast('shots/real.png')], blobCtx);
      expect(r.findings.some((f) => f.code === 'evidence_file_not_found')).toBe(false);
    });
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

});
