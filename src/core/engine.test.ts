import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { check, checkRoot, rule, type IssueRecord, type Preset } from './engine.ts';

const RootSchema = z.object({ issues: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), status: z.string(), acceptanceCriteria: z.array(z.object({ id: z.string(), status: z.string(), evidence: z.array(z.object({ id: z.string() })) })) })) }).strict();
type R = z.infer<typeof RootSchema>;
const emptyIssue = { id: 'A-1', title: 't', summary: '', status: 'open', acceptanceCriteria: [] };
// the trivial single-record input most tests feed in (content body is irrelevant to a fixed-root parse stub)
const rec = (body = 'x'): IssueRecord[] => [{ id: 'A-1', title: 't', status: 'draft', body }];

describe('check() runner', () => {
  test('a rule that throws becomes a finding, not a crash (public extension point)', () => {
    const preset = {
      name: 'throwy',
      schema: z.object({ issues: z.array(z.any()) }),
      parse: () => ({ issues: [] }),
      rules: [{ code: 'boom', select: () => { throw new Error('kaboom'); }, message: () => '' }],
      primitives: {},
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = check(preset as any, rec());
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.code).toBe('rule_threw');
    expect(result.findings[0]?.message).toContain('boom');
    expect(result.findings[0]?.message).toContain('kaboom');
  });

  test('rules receive the derived model carrying { context, root }', () => {
    let seen: { root: R; context: { now?: string } } | undefined;
    const preset: Preset<R> = {
      name: 'spy', schema: RootSchema, parse: () => ({ issues: [emptyIssue] }),
      rules: [rule<R, { issueId?: string }>({ code: 'spy', select: (m) => { seen = m; return []; }, message: () => '' })],
    };
    const result = check(preset, rec(), { now: '2026-01-01', git: { existingCommits: ['abc'] } });
    expect(result.ok).toBe(true);
    expect(seen?.root.issues[0]?.id).toBe('A-1');
    expect(seen?.context.now).toBe('2026-01-01');
  });

  test('per-state gating: a state-tagged rule runs only on issues in that state; untagged runs always', () => {
    const issues = [
      { id: 'R-1', title: 't', summary: '', status: 'ready', acceptanceCriteria: [] },
      { id: 'D-1', title: 't', summary: '', status: 'draft', acceptanceCriteria: [] },
      { id: 'X-1', title: 't', summary: '', status: 'Done', acceptanceCriteria: [] },
    ];
    const preset: Preset<R> = {
      name: 'gated', schema: RootSchema, parse: () => ({ issues }),
      rules: [
        rule<R, { issueId?: string }>({ code: 'always', select: (m) => m.issues, message: (i) => `always ${i.issueId}` }),
        rule<R, { issueId?: string }>({ code: 'ready_only', state: 'ready', select: (m) => m.issues, message: (i) => `ready ${i.issueId}` }),
        rule<R, { issueId?: string }>({ code: 'ready_or_done', state: ['ready', 'DONE'], select: (m) => m.issues, message: (i) => `rd ${i.issueId}` }),
      ],
    };
    const f = check(preset, rec()).findings;
    const codesFor = (id: string): string[] => f.filter((x) => x.issueId === id).map((x) => x.code).sort();
    expect(codesFor('R-1')).toEqual(['always', 'ready_only', 'ready_or_done']); // in 'ready'
    expect(codesFor('D-1')).toEqual(['always']);                                 // 'draft' → only the invariant
    expect(codesFor('X-1')).toEqual(['always', 'ready_or_done']);                // case-insensitive: 'DONE' tag ↔ 'Done'
  });

  test('waivers: an eslint-style `## Waivers` directive downgrades the matching finding; unused/unreasoned are reported', () => {
    const preset: Preset<R> = {
      name: 'w', schema: RootSchema,
      // the body is irrelevant to the parse (fixed root); waivers are parsed by the CORE from each record's body section.
      parse: () => ({ issues: [{ id: 'A-1', title: 't', summary: '', status: 'open', acceptanceCriteria: [{ id: 'AC-1', status: 'pending', evidence: [] }] }] }),
      rules: [rule<R, { issueId?: string; acId?: string }>({ code: 'needs_work', select: (m) => m.acs, message: () => 'AC needs work' })],
    };
    // a located waiver for exactly the firing finding → downgraded to acknowledged (non-gating).
    // the waiver lives in record.body; the issue id is record.id (no longer a `# id:` heading).
    const r = check(preset, [{ id: 'A-1', title: 't', status: 'draft', body: '## Waivers\n\n- code: needs_work ac: AC-1 reason: tracked elsewhere by: Otto\n' }]);
    expect(r.findings.find((x) => x.code === 'needs_work')?.severity).toBe('acknowledged');
    expect(r.ok).toBe(true);
    // a waiver naming a code that did not fire → waiver_unused (warning); the real finding stands
    const r2 = check(preset, [{ id: 'A-1', title: 't', status: 'draft', body: '## Waivers\n\n- code: never_fires reason: x by: Otto\n' }]);
    expect(r2.findings.some((x) => x.code === 'waiver_unused' && x.severity === 'warning')).toBe(true);
    expect(r2.findings.some((x) => x.code === 'needs_work' && x.severity === 'error')).toBe(true);
    expect(r2.ok).toBe(false);
    // a waiver with no reason → waiver_missing_reason (error), downgrades nothing
    const r3 = check(preset, [{ id: 'A-1', title: 't', status: 'draft', body: '## Waivers\n\n- code: needs_work ac: AC-1 by: Otto\n' }]);
    expect(r3.findings.some((x) => x.code === 'waiver_missing_reason')).toBe(true);
    expect(r3.findings.find((x) => x.code === 'needs_work')?.severity).toBe('error');
  });

  test('an unknown context key is rejected by the strict ValidationInputSchema', () => {
    const preset: Preset<R> = { name: 'p', schema: RootSchema, parse: () => ({ issues: [] }), rules: [] };
    // @ts-expect-error — bogus context field must not be accepted
    const result = check(preset, [], { bogus: true });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === 'wellformed_shape')).toBe(true);
  });

  test('checkRoot validates an already-parsed root and flags a bad shape', () => {
    const preset: Preset<R> = { name: 'p', schema: RootSchema, parse: () => ({ issues: [] }), rules: [] };
    expect(checkRoot(preset, { issues: [emptyIssue] }).ok).toBe(true);
    const bad = checkRoot(preset, { cases: [] });
    expect(bad.ok).toBe(false);
    expect(bad.findings[0]?.code).toBe('root_shape_invalid');
  });

  test('categories selector skips rules deeper than requested; invariants always run', () => {
    const preset: Preset<R> = {
      name: 'p', schema: RootSchema, parse: () => ({ issues: [emptyIssue] }),
      rules: [
        rule<R, { issueId: string }>({ code: 'inv', severity: 'warning', select: (m) => m.issues, message: () => 'i' }),
        rule<R, { issueId: string }>({ code: 'deep', severity: 'warning', category: 'code', depth: 3, select: (m) => m.issues, message: () => 'd' }),
        rule<R, { issueId: string }>({ code: 'shallow', severity: 'warning', category: 'code', depth: 1, select: (m) => m.issues, message: () => 's' }),
      ],
    };
    const codes = check(preset, rec(), { categories: { code: 1 } }).findings.map((f) => f.code).sort();
    expect(codes).toEqual(['inv', 'shallow']);
  });
});
