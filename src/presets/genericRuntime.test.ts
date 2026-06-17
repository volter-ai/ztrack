import { describe, expect, test } from 'bun:test';
import { GENERIC_PRESET } from './genericRuntime.ts';

// The generic preset runtime is the legacy fallback runtime. These tests
// cover the pure surface: markdown parsing (acceptance criteria + evidence) and the
// snapshot checker's gates (no git/python needed — ACs cite no commits here).

describe('GENERIC_PRESET.parseIssueMarkdown', () => {
  test('extracts acceptance criteria with id, checked state, and refs', () => {
    const body = [
      '# APP-1: A case',
      '',
      '- [x] dev/01 status: passed Build the thing. commit: a1b2c3d [E1]',
      '- [ ] dev/02 status: pending Not done yet.',
    ].join('\n');
    const parsed = GENERIC_PRESET.parseIssueMarkdown(body, 'parent-case');
    expect(parsed.preset).toBe('generic');
    const acs = parsed.acceptanceCriteria ?? [];
    expect(acs).toHaveLength(2);
    const [first, second] = acs;
    expect(first!.checked).toBe(true);
    expect(first!.status).toBe('passed');
    expect(first!.evidenceRefs).toEqual(['E1']);
    expect(first!.commitHashes).toEqual(['a1b2c3d']);
    expect(second!.checked).toBe(false);
    expect(second!.status).toBe('pending');
  });

  test('prose mentioning a status/id does NOT mislead parsing (anchored to the leading token)', () => {
    const body = [
      '# APP-9: edge cases',
      '',
      '- [ ] dev/01 verify the status: passed banner appears in AC 3 above',
    ].join('\n');
    const ac = (GENERIC_PRESET.parseIssueMarkdown(body, 'parent-case').acceptanceCriteria ?? [])[0]!;
    expect(ac.checked).toBe(false);
    expect(ac.status).toBe('pending');      // not flipped to "passed" by prose
    expect(ac.id).toBe('dev/01');           // not "AC-03" from the "AC 3" mention
    expect(ac.type).toBe('dev');            // type from the real prefix, not "ac-03"
  });

  test('extracts evidence entries with typed fields', () => {
    const body = ['# APP-2: B', '', '[E1] type: screenshot path: uploads/a.png ac: dev/01'].join('\n');
    const parsed = GENERIC_PRESET.parseIssueMarkdown(body, 'parent-case');
    const evidence = parsed.evidence ?? [];
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.id).toBe('E1');
    expect(evidence[0]!.type).toBe('screenshot');
    // multi-word field values are not truncated at the first space
    const e2 = (GENERIC_PRESET.parseIssueMarkdown('# T\n\n[E1] type: pr ac: dev/01,dev/02 note: needs a careful look', 'parent-case').evidence ?? [])[0]!;
    expect((e2.fields ?? {}).note).toBe('needs a careful look');
    expect(e2.ac).toEqual(['dev/01', 'dev/02']);
    expect(evidence[0]!.ac).toContain('dev/01');
  });
});

describe('GENERIC_PRESET.markdownDiagnostics', () => {
  test('warns on an empty body', () => {
    expect(GENERIC_PRESET.markdownDiagnostics('   ', 'parent-case')).toEqual([
      { level: 'warning', code: 'issue_body_empty', message: 'Issue body is empty.' },
    ]);
  });
  test('no diagnostics for a non-empty body', () => {
    expect(GENERIC_PRESET.markdownDiagnostics('# Has content', 'parent-case')).toEqual([]);
  });
});

describe('GENERIC_PRESET.snapshot.checkSnapshot', () => {
  const check = GENERIC_PRESET.snapshot!.checkSnapshot!;
  const ac = (over: Record<string, unknown> = {}) => ({
    id: 'dev/01', type: 'dev', checked: false, status: 'pending', body: '', text: '',
    sourceRefs: [], evidenceRefs: [], proofRefs: [], ...over,
  });
  const baseCase = (over: Record<string, unknown> = {}) => ({
    identifier: 'APP-1', title: 'A', body: '# A', state: 'In Progress', stateType: 'started',
    assignee: 'alice', labels: ['type:case'], sources: [],
    validatedIssue: { preset: 'generic', acceptanceCriteria: [], evidence: [], proofs: [] },
    acceptanceCriteria: [], ...over,
  });
  const snapshot = (cases: unknown[]) => ({ schema: 'tracker-snapshot@1', projectRoot: '/tmp/x', cases });

  test('a clean assigned case with no checked ACs passes', () => {
    const report = check(snapshot([baseCase()]), {}) as { valid: boolean; summary: { errors: number } };
    expect(report.valid).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  test('a non-canceled case without an assignee fails with case_missing_assignee', () => {
    const report = check(snapshot([baseCase({ assignee: '' })]), {}) as { valid: boolean; summary: { findingCounts: Record<string, number> } };
    expect(report.valid).toBe(false);
    expect(report.summary.findingCounts.case_missing_assignee).toBe(1);
  });

  test('a checked AC with no commit and no evidence raises both gates', () => {
    const checked = ac({ checked: true, status: 'passed' });
    const c = baseCase({ acceptanceCriteria: [checked], validatedIssue: { preset: 'generic', acceptanceCriteria: [checked], evidence: [], proofs: [] } });
    const report = check(snapshot([c]), {}) as { valid: boolean; summary: { findingCounts: Record<string, number> } };
    expect(report.valid).toBe(false);
    expect(report.summary.findingCounts.checked_ac_missing_commit_hash).toBe(1);
    expect(report.summary.findingCounts.checked_ac_missing_evidence).toBe(1);
  });

  test('a canceled case is exempt from the assignee gate', () => {
    const report = check(snapshot([baseCase({ assignee: '', stateType: 'canceled' })]), {}) as { valid: boolean };
    expect(report.valid).toBe(true);
  });
});
