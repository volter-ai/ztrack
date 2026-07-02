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

  test('a diagnostics side-channel on parse() is lifted into findings (default severity warning), stripped before schema validation', () => {
    const preset: Preset<R> = {
      name: 'diag', schema: RootSchema,
      parse: () => ({ issues: [emptyIssue], diagnostics: [{ code: 'fake_diag', message: 'something looked off' }, { code: 'fake_diag_error', severity: 'error', message: 'this one gates', issueId: 'A-1' }] }),
      rules: [],
    };
    const records = rec();
    records[0]!.origin = { path: '/store/A-1.md' };
    const result = check(preset, records);
    // the diagnostics-derived findings default to 'warning' unless the preset says otherwise
    expect(result.findings.find((f) => f.code === 'fake_diag')).toMatchObject({ severity: 'warning', message: 'something looked off' });
    // a diagnostic that names its issue also inherits that record's origin (ZTB-1 × ZTB-2)
    expect(result.findings.find((f) => f.code === 'fake_diag_error')).toMatchObject({ severity: 'error', issueId: 'A-1', origin: { path: '/store/A-1.md' } });
    // an error-severity diagnostic gates the check, same as any other error finding
    expect(result.ok).toBe(false);
    // the `diagnostics` key never reaches schema validation — no root_shape_invalid / wellformed_shape noise
    expect(result.findings.some((f) => f.code === 'wellformed_shape' || f.code === 'root_shape_invalid')).toBe(false);
  });

  test('a preset that returns no `diagnostics` key behaves exactly as today (no diagnostics findings, no shape change)', () => {
    const preset: Preset<R> = { name: 'nodiag', schema: RootSchema, parse: () => ({ issues: [emptyIssue] }), rules: [] };
    const result = check(preset, rec());
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
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

  // ZTB-2: IssueRecord.origin is copied onto the findings the engine emits for that issue, so a
  // finding cites where its issue actually lives — never authored by a rule itself.
  describe('origin propagation', () => {
    const preset: Preset<R> = {
      name: 'p', schema: RootSchema, parse: () => ({ issues: [emptyIssue] }),
      rules: [rule<R, { issueId: string }>({ code: 'always', select: (m) => m.issues, message: () => 'x' })],
    };

    test('a record with origin propagates onto its issue\'s findings', () => {
      const records: IssueRecord[] = [{ id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/repo/issues/A-1.md' } }];
      const result = check(preset, records);
      expect(result.findings.find((f) => f.code === 'always')?.origin).toEqual({ path: '/repo/issues/A-1.md' });
    });

    test('a record with no origin leaves findings without one', () => {
      const result = check(preset, rec());
      expect(result.findings.find((f) => f.code === 'always')?.origin).toBeUndefined();
    });

    test('a document-source origin (lineStart) narrows to a single `line` on the finding', () => {
      const records: IssueRecord[] = [{ id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/repo/BACKLOG.md', lineStart: 42, lineEnd: 50 } }];
      const result = check(preset, records);
      expect(result.findings.find((f) => f.code === 'always')?.origin).toEqual({ path: '/repo/BACKLOG.md', line: 42 });
    });

    test('a single-record parse failure cites that record\'s origin', () => {
      const throwyPreset: Preset<R> = { name: 'p', schema: RootSchema, parse: () => { throw new Error('bad shape'); }, rules: [] };
      const records: IssueRecord[] = [{ id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/repo/issues/A-1.md' } }];
      const result = check(throwyPreset, records);
      expect(result.findings[0]?.code).toBe('parse_failed');
      expect(result.findings[0]?.origin).toEqual({ path: '/repo/issues/A-1.md' });
    });

    test('a multi-record parse failure has no single issue to cite — origin stays unset', () => {
      const throwyPreset: Preset<R> = { name: 'p', schema: RootSchema, parse: () => { throw new Error('bad shape'); }, rules: [] };
      const records: IssueRecord[] = [
        { id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/repo/issues/A-1.md' } },
        { id: 'A-2', title: 't', status: 'draft', body: 'x', origin: { path: '/repo/issues/A-2.md' } },
      ];
      const result = check(throwyPreset, records);
      expect(result.findings[0]?.origin).toBeUndefined();
    });

    test('a wellformed_shape finding on one issue of a multi-issue root cites that issue\'s origin', () => {
      // The second issue's `title` is malformed (a number, not a string) — the strict root schema
      // rejects it at zod path `root.issues.1.title`; shapeFindings resolves index 1 back to
      // A-2's record and attaches its origin (index 0's A-1 origin must NOT leak onto it).
      const multiPreset: Preset<R> = {
        name: 'p', schema: RootSchema,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parse: () => ({ issues: [emptyIssue, { id: 'A-2', title: 123 as any, summary: '', status: 'open', acceptanceCriteria: [] }] }),
        rules: [],
      };
      const records: IssueRecord[] = [
        { id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/repo/issues/A-1.md' } },
        { id: 'A-2', title: 't', status: 'draft', body: 'x', origin: { path: '/repo/issues/A-2.md' } },
      ];
      const result = check(multiPreset, records);
      expect(result.ok).toBe(false);
      const finding = result.findings.find((f) => f.code === 'wellformed_shape');
      expect(finding?.origin).toEqual({ path: '/repo/issues/A-2.md' });
    });
  });

  // ZTB-3: a config-declared `sources` union can surface the SAME id from two DIFFERENT files
  // (see MarkdownBackend.loadAll) — a data error the engine reports directly (`issue_id_conflict`),
  // not silent precedence. This is distinct from — and must not disturb — the PRESET's own
  // structural `duplicate_issue_id` (built on `root.issues`), which still fires independently
  // once both records parse: see boilerplates/presets/simple-sdlc.test.ts's
  // "cross-issue: duplicate issue ids across the tracker fail".
  describe('issue_id_conflict (ZTB-3: cross-source id collision)', () => {
    const echoPreset: Preset<R> = {
      name: 'p', schema: RootSchema,
      parse: (records) => ({ issues: records.map((r) => ({ id: r.id, title: r.title, summary: '', status: 'open', acceptanceCriteria: [] })) }),
      rules: [],
    };

    test('the same id backed by two DIFFERENT origins is a waivable:false error naming both paths', () => {
      const records: IssueRecord[] = [
        { id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/store-a/A-1.md' } },
        { id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/store-b/A-1.md' } },
      ];
      const result = check(echoPreset, records);
      expect(result.ok).toBe(false);
      const finding = result.findings.find((f) => f.code === 'issue_id_conflict');
      expect(finding).toMatchObject({ severity: 'error', waivable: false, issueId: 'A-1' });
      expect(finding?.message).toContain('/store-a/A-1.md');
      expect(finding?.message).toContain('/store-b/A-1.md');
    });

    test('the same id with NO origin (or the same origin twice) is NOT a cross-source conflict — untouched', () => {
      const noOrigin: IssueRecord[] = [rec()[0]!, rec()[0]!];
      expect(check(echoPreset, noOrigin).findings.some((f) => f.code === 'issue_id_conflict')).toBe(false);

      const sameOrigin: IssueRecord[] = [
        { id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/store-a/A-1.md' } },
        { id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/store-a/A-1.md' } },
      ];
      expect(check(echoPreset, sameOrigin).findings.some((f) => f.code === 'issue_id_conflict')).toBe(false);
    });

    test('an id unique to one origin among several records is unaffected', () => {
      const records: IssueRecord[] = [
        { id: 'A-1', title: 't', status: 'draft', body: 'x', origin: { path: '/store-a/A-1.md' } },
        { id: 'A-2', title: 't', status: 'draft', body: 'x', origin: { path: '/store-b/A-2.md' } },
      ];
      expect(check(echoPreset, records).findings.some((f) => f.code === 'issue_id_conflict')).toBe(false);
    });
  });
});
