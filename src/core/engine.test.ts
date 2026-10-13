import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { check, checkRoot, parseWaiverLine, rule, type IssueRecord, type Preset } from './engine.ts';

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

  // Waivers are core-owned: a preset's contextSchema must not be able to eat them.
  // Regression for the peak preset shipping weeks with every signed waiver silently
  // no-oped — its contextSchema had no `waivers` field, and z.object() strips
  // undeclared keys on parse, so applyWaivers never saw a single directive.
  test('waivers survive a preset contextSchema that does not declare them (non-strict AND strict)', () => {
    const mk = (contextSchema: z.ZodTypeAny): Preset<R> => ({
      name: 'wstrip', schema: RootSchema, contextSchema,
      parse: () => ({ issues: [{ id: 'A-1', title: 't', summary: '', status: 'open', acceptanceCriteria: [{ id: 'AC-1', status: 'pending', evidence: [] }] }] }),
      rules: [rule<R, { issueId?: string; acId?: string }>({ code: 'needs_work', select: (m) => m.acs, message: () => 'AC needs work' })],
    });
    const waived = [{ id: 'A-1', title: 't', status: 'draft', body: '## Waivers\n\n- code: needs_work ac: AC-1 reason: tracked elsewhere by: Otto\n' }];
    // non-strict: undeclared keys are silently stripped — the historical failure mode
    const r = check(mk(z.object({ now: z.string().optional() })), waived);
    expect(r.findings.find((x) => x.code === 'needs_work')?.severity).toBe('acknowledged');
    expect(r.ok).toBe(true);
    // strict: undeclared keys reject the parse — waivers must not reach it at all
    const r2 = check(mk(z.object({ now: z.string().optional() }).strict()), waived);
    expect(r2.findings.find((x) => x.code === 'needs_work')?.severity).toBe('acknowledged');
    expect(r2.ok).toBe(true);
  });

  test('malformed context.waivers surface as a loud finding, not silence or a crash', () => {
    const preset: Preset<R> = {
      name: 'wbad', schema: RootSchema,
      parse: () => ({ issues: [emptyIssue] }),
      rules: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = checkRoot(preset, { issues: [emptyIssue] }, { waivers: [{ nonsense: true }] as any });
    expect(r.ok).toBe(false);
    expect(r.findings.some((x) => x.code === 'waivers_context_invalid' && x.severity === 'error')).toBe(true);
  });

  // ── fingerprinted, self-expiring waivers (`// eslint-disable-next-line` parity) ──────────────
  // A preset whose rule emits one finding per evidence entry, each carrying the commit sha as its
  // `subject` — so a `ref:` waiver can pin to exactly one occurrence.
  const ESchema = z.object({ issues: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), status: z.string(), acceptanceCriteria: z.array(z.object({ id: z.string(), status: z.string(), evidence: z.array(z.object({ id: z.string(), commit: z.string() })) })) })) }).strict();
  type ER = z.infer<typeof ESchema>;
  const twoBadCommits = (): ER => ({ issues: [{ id: 'A-1', title: 't', summary: '', status: 'open', acceptanceCriteria: [{ id: 'AC-1', status: 'passed', evidence: [{ id: 'ev1', commit: 'badA' }, { id: 'ev2', commit: 'badB' }] }] }] });
  const subjPreset: Preset<ER> = {
    name: 'subj', schema: ESchema, parse: () => twoBadCommits(),
    rules: [rule<ER, { issueId?: string; acId?: string; evidenceId?: string; ev: { id: string; commit: string } }>({
      code: 'evidence_commit_not_found', select: (m) => m.evidence,
      message: ({ ev }) => `Evidence ${ev.id} cites commit ${ev.commit}, which does not exist.`,
      subject: ({ ev }) => ev.commit,
    })],
  };
  const wbody = (rows: string) => [{ id: 'A-1', title: 't', status: 'draft', body: `## Waivers\n\n${rows}\n` }];

  test('subject: a rule can stamp the offending token onto each finding occurrence', () => {
    const f = check(subjPreset, rec()).findings.filter((x) => x.code === 'evidence_commit_not_found');
    expect(f.map((x) => x.subject).sort()).toEqual(['badA', 'badB']);
    expect(f.every((x) => x.acId === 'AC-1' && x.evidenceId)).toBe(true);
  });

  test('a ref-pinned waiver suppresses ONLY its occurrence — a different bad sha still fails (no masking)', () => {
    const r = check(subjPreset, wbody('- code: evidence_commit_not_found ref: badA reason: lost in incident by: Otto'));
    const byS = (s: string) => r.findings.find((x) => x.code === 'evidence_commit_not_found' && x.subject === s);
    expect(byS('badA')?.severity).toBe('acknowledged'); // the pinned one is accepted
    expect(byS('badB')?.severity).toBe('error');        // the other still gates — NOT masked
    expect(r.ok).toBe(false);
    expect(r.findings.some((x) => x.code === 'waiver_overbroad')).toBe(false); // a pinned waiver is never overbroad
  });

  test('ref also matches by evidenceId', () => {
    const r = check(subjPreset, wbody('- code: evidence_commit_not_found ref: ev1 reason: r by: Otto'));
    expect(r.findings.find((x) => x.evidenceId === 'ev1')?.severity).toBe('acknowledged');
    expect(r.findings.find((x) => x.evidenceId === 'ev2')?.severity).toBe('error');
  });

  test('an unpinned waiver still downgrades (back-compat) but is flagged waiver_overbroad, naming the subjects', () => {
    const r = check(subjPreset, wbody('- code: evidence_commit_not_found reason: broad by: Otto'));
    expect(r.findings.filter((x) => x.code === 'evidence_commit_not_found').every((x) => x.severity === 'acknowledged')).toBe(true);
    expect(r.ok).toBe(true); // back-compat: it does gate-pass
    const ob = r.findings.find((x) => x.code === 'waiver_overbroad');
    expect(ob?.severity).toBe('warning');
    expect(ob?.message).toContain('badA');
    expect(ob?.message).toContain('badB'); // it silenced BOTH — the masking the warning is about
  });

  test('a ref pinned to a subject that no finding carries is waiver_unused (self-expiring)', () => {
    const r = check(subjPreset, wbody('- code: evidence_commit_not_found ref: badGONE reason: r by: Otto'));
    expect(r.findings.some((x) => x.code === 'waiver_unused')).toBe(true);
    expect(r.findings.filter((x) => x.code === 'evidence_commit_not_found').every((x) => x.severity === 'error')).toBe(true);
  });

  test('the most specific waiver wins: a ref pin absorbs the hit, leaving the broad one to fire/overbroad on the rest', () => {
    const r = check(subjPreset, wbody('- code: evidence_commit_not_found ref: badA reason: pinned by: Otto\n- code: evidence_commit_not_found reason: broad by: Otto'));
    const byS = (s: string) => r.findings.find((x) => x.code === 'evidence_commit_not_found' && x.subject === s);
    expect(byS('badA')?.severity).toBe('acknowledged'); // pinned waiver took it
    expect(byS('badB')?.severity).toBe('acknowledged'); // broad waiver took the other
    expect(r.ok).toBe(true);
    expect(r.findings.some((x) => x.code === 'waiver_overbroad')).toBe(true); // the broad one still nudged
  });

  // ZTB-32 review finding 1: a `ref:` value is not a per-occurrence license — the same subject can
  // recur across ACs. One issue-level (no `ac:`) `ref:` must NOT silently silence both; it downgrades
  // (back-compat) but is flagged overbroad, and scoping it with `ac:` pins exactly one.
  const dupePreset: Preset<ER> = {
    ...subjPreset, name: 'dupe',
    parse: (): ER => ({ issues: [{ id: 'A-1', title: 't', summary: '', status: 'open', acceptanceCriteria: [
      { id: 'AC-1', status: 'passed', evidence: [{ id: 'ev1', commit: 'dupe' }] },
      { id: 'AC-2', status: 'passed', evidence: [{ id: 'ev2', commit: 'dupe' }] },
    ] }] }),
  };
  test('a ref matching the same subject on two ACs is flagged waiver_overbroad, not silently masked; ac-scoping pins one', () => {
    const r = check(dupePreset, wbody('- code: evidence_commit_not_found ref: dupe reason: issue-level by: Otto'));
    expect(r.findings.filter((x) => x.code === 'evidence_commit_not_found').every((x) => x.severity === 'acknowledged')).toBe(true);
    const ob = r.findings.find((x) => x.code === 'waiver_overbroad');
    expect(ob?.severity).toBe('warning');
    expect(ob?.message).toContain('AC-1'); // names BOTH ACs the one ref hit
    expect(ob?.message).toContain('AC-2');
    // scoped: `ac: AC-1 ref: dupe` pins exactly AC-1; AC-2 still gates; no overbroad
    const r2 = check(dupePreset, wbody('- code: evidence_commit_not_found ac: AC-1 ref: dupe reason: scoped by: Otto'));
    expect(r2.findings.find((x) => x.acId === 'AC-1' && x.code === 'evidence_commit_not_found')?.severity).toBe('acknowledged');
    expect(r2.findings.find((x) => x.acId === 'AC-2' && x.code === 'evidence_commit_not_found')?.severity).toBe('error');
    expect(r2.findings.some((x) => x.code === 'waiver_overbroad')).toBe(false);
    expect(r2.ok).toBe(false);
  });

  // ZTB-32 re-review: a `ref:` also pins by evidenceId, so a subjectLESS rule that selects evidence is
  // equally maskable — overbroad detection must cover it too (silenced key = subject ?? evidenceId).
  const evOnly = (evidence: ER['issues'][number]['acceptanceCriteria']): Preset<ER> => ({
    ...subjPreset, name: 'evonly',
    rules: [rule<ER, { issueId?: string; acId?: string; evidenceId?: string; ev: { id: string; commit: string } }>({
      code: 'evidence_commit_not_found', select: (m) => m.evidence,
      message: ({ ev }) => `Evidence ${ev.id} missing.`, // NO subject fn — only evidenceId identifies it
    })],
    parse: (): ER => ({ issues: [{ id: 'A-1', title: 't', summary: '', status: 'open', acceptanceCriteria: evidence }] }),
  });
  test('overbroad detection also covers evidenceId-only findings (rule with no subject fn)', () => {
    const twoSameEv = evOnly([
      { id: 'AC-1', status: 'passed', evidence: [{ id: 'dupeEv', commit: 'badA' }] },
      { id: 'AC-2', status: 'passed', evidence: [{ id: 'dupeEv', commit: 'badB' }] },
    ]);
    const r = check(twoSameEv, wbody('- code: evidence_commit_not_found ref: dupeEv reason: issue-level by: Otto'));
    expect(r.findings.filter((x) => x.code === 'evidence_commit_not_found').every((x) => x.severity === 'acknowledged')).toBe(true);
    const ob = r.findings.find((x) => x.code === 'waiver_overbroad');
    expect(ob?.severity).toBe('warning'); // the masking now has a signal (was silent before the re-review fix)
    expect(ob?.message).toContain('AC-1');
    expect(ob?.message).toContain('AC-2');
    // a ref pinned to a single evidenceId occurrence is still NOT overbroad
    const one = check(evOnly([{ id: 'AC-1', status: 'passed', evidence: [{ id: 'solo', commit: 'badA' }] }]),
      wbody('- code: evidence_commit_not_found ref: solo reason: r by: Otto'));
    expect(one.findings.some((x) => x.code === 'waiver_overbroad')).toBe(false);
    expect(one.ok).toBe(true);
  });

  // ZTB-32 review finding 2: `by:` splits on its LAST occurrence, so a reason that itself contains
  // "by:" keeps the real signer (parseWaiverLine is the shared source of truth for engine + CLI).
  test('parseWaiverLine splits reason/signer on the last by:, not the first', () => {
    const p = parseWaiverLine('- code: evidence_commit_not_found reason: covered by: the vendor outage report by: Real Signer');
    expect(p?.reason).toBe('covered by: the vendor outage report');
    expect(p?.approvedBy).toBe('Real Signer');
    // pins parse only from the head before reason: — prose can't fake a ref/ac
    const q = parseWaiverLine('- code: x ac: AC-1 ref: sha1 reason: mentions ref: nope and ac: nope by: Sig');
    expect(q?.acId).toBe('AC-1'); expect(q?.ref).toBe('sha1');
    expect(q?.reason).toBe('mentions ref: nope and ac: nope'); expect(q?.approvedBy).toBe('Sig');
    expect(parseWaiverLine('- no code here')).toBeNull();
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

  // ZTB-19 (ZL-E9c): a shape-invalid root has no `export` (validation never got that far), but
  // the raw candidate still HAD issues — cliStyle's old `export?.issues.length ?? 0` reported
  // "issues 0" while findings simultaneously cited `root.issues.0`. `examinedIssues` is the
  // engine's honest fallback count so a summary reader downstream never has to choose between
  // the two.
  test('a shape-invalid root/candidate still reports how many issues were examined, even though export is unset', () => {
    const preset: Preset<R> = { name: 'p', schema: RootSchema, parse: () => ({ issues: [] }), rules: [] };
    // one malformed issue (title empty, status not a real one) — exactly the 0.37.0 repro shape.
    const badRoot = { issues: [{ id: 'X-1', title: '', summary: '', status: 123, acceptanceCriteria: [] }] };
    const bad = checkRoot(preset, badRoot);
    expect(bad.ok).toBe(false);
    expect(bad.export).toBeUndefined();
    expect(bad.examinedIssues).toBe(1); // NOT 0 — one issue really was there and was examined
    // and every wellformed_shape finding does cite that one issue, by construction:
    expect(bad.findings.some((f) => f.code === 'wellformed_shape' && f.message.startsWith('root.issues.0.'))).toBe(true);

    // check() (the whole-input parse-failure path) reports the same honest count from `records`.
    const throwyPreset: Preset<R> = { name: 'throwy', schema: RootSchema, parse: () => { throw new Error('nope'); }, rules: [] };
    const viaCheck = check(throwyPreset, [{ id: 'X-1', title: 't', status: 'draft', body: 'b' }]);
    expect(viaCheck.ok).toBe(false);
    expect(viaCheck.export).toBeUndefined();
    expect(viaCheck.examinedIssues).toBe(1);
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
