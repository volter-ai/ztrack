import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGenericPreset } from './presetKit.ts';
import { check, issueAcFingerprint } from './core/engine.ts';
import { buildIssueBundle } from './core/bundle.ts';
import { applyAcMutation } from './mutate.ts';

const HEAD = 'a1b2c3d4e5f6';
const ctx = { git: { existingCommits: [HEAD] } };

// Mirrors how the loader frames a backend row into issue markdown.
function frame(id: string, opts: { state?: string; stateType?: string; assignee?: string; body?: string }): { id: string; body: string } {
  const head = [`# ${id}: ${id} title`, ''];
  if (opts.state) head.push(`Status: ${opts.state}`);
  if (opts.stateType) head.push(`StateType: ${opts.stateType}`);
  if (opts.assignee) head.push(`Assignee: ${opts.assignee}`);
  head.push('');
  return { id, body: `${head.join('\n')}\n${opts.body ?? ''}\n` };
}

describe('createGenericPreset', () => {
  const sdlc = createGenericPreset({ name: 'simple-sdlc', requireSourceMarker: true, requireSdlcGates: true });

  test('parses ACs (id/status/checked/evidence/commit/source refs) via mdast into the strict schema', () => {
    const body = `## Acceptance Criteria\n\n- [x] dev/01 status: passed Build it. commit: ${HEAD} [E1] [1]\n- [ ] dev/02 status: pending Not yet.\n\n## Evidence\n\n[E1] type: pr ac: dev/01\n\n## Sources\n\n[1] Requirement: do it.\n`;
    const root = sdlc.schema.parse(sdlc.parse(buildIssueBundle([frame('APP-1', { state: 'In Progress', stateType: 'open', assignee: 'otto', body })])));
    const issue = root.issues[0]!;
    expect(issue.id).toBe('APP-1');
    expect(issue.acceptanceCriteria).toHaveLength(2);
    const ac = issue.acceptanceCriteria[0]!;
    expect(ac).toMatchObject({ id: 'dev/01', type: 'dev', checked: true, status: 'passed' });
    expect(ac.commitHashes).toEqual([HEAD]);
    expect(ac.evidenceRefs).toEqual(['E1']);
    expect(ac.evidence).toEqual([{ id: 'E1', type: 'pr', ac: ['dev/01'] }]);
    expect(issue.sourceMarkers).toContain('1');
  });

  test('clean passing case', () => {
    const body = `## Acceptance Criteria\n\n- [x] dev/01 status: passed Done. commit: ${HEAD} [E1] [1]\n\n## Evidence\n\n[E1] type: pr ac: dev/01\n\n## Sources\n\n[1] req\n`;
    const r = check(sdlc, buildIssueBundle([frame('APP-1', { state: 'done', stateType: 'completed', assignee: 'otto', body })]), ctx);
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('rules fire: missing source marker, missing assignee, no ACs, checked AC missing commit/evidence', () => {
    const noMarkerNoAssignee = check(sdlc, buildIssueBundle([frame('A-1', { state: 'open', stateType: 'open', body: '## Acceptance Criteria\n' })]), ctx);
    const codes = noMarkerNoAssignee.findings.map((f) => f.code);
    expect(codes).toContain('simple-sdlc_case_missing_source_marker');
    expect(codes).toContain('simple-sdlc_case_missing_assignee');
    expect(codes).toContain('simple-sdlc_case_missing_acceptance_criteria');

    const badAc = check(sdlc, buildIssueBundle([frame('A-2', { state: 'open', stateType: 'open', assignee: 'a', body: '## Acceptance Criteria\n\n- [x] dev/01 status: passed no commit no evidence [1]\n\n## Sources\n\n[1] r\n' })]), ctx);
    const c2 = badAc.findings.map((f) => f.code);
    expect(c2).toContain('simple-sdlc_checked_ac_missing_commit_hash');
    expect(c2).toContain('simple-sdlc_checked_ac_missing_evidence');
  });

  test('checked AC citing a missing commit fails against ctx.git', () => {
    const body = '## Acceptance Criteria\n\n- [x] dev/01 status: passed done commit: deadbeef1234 [E1] [1]\n\n## Evidence\n\n[E1] type: pr\n\n## Sources\n\n[1] r\n';
    const r = check(sdlc, buildIssueBundle([frame('A-3', { state: 'open', stateType: 'open', assignee: 'a', body })]), ctx);
    expect(r.findings.some((f) => f.code === 'simple-sdlc_checked_ac_commit_hash_missing')).toBe(true);
  });

  test('loadContext injects git commits for installed repo-local presets', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ztrack-preset-kit-'));
    try {
      execFileSync('git', ['-C', repo, 'init', '-q']);
      execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
      execFileSync('git', ['-C', repo, 'config', 'user.name', 'ztrack test']);
      execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-q', '-m', 'initial']);
      const context = await sdlc.loadContext?.({ projectRoot: repo });
      const body = '## Acceptance Criteria\n\n- [x] dev/01 status: passed done commit: deadbee [E1] [1]\n\n## Evidence\n\n[E1] type: pr\n\n## Sources\n\n[1] r\n';
      const r = check(sdlc, buildIssueBundle([frame('A-5', { state: 'open', stateType: 'open', assignee: 'a', body })]), context);
      expect(r.findings.some((f) => f.code === 'simple-sdlc_checked_ac_commit_hash_missing')).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('cross-issue (root) rule: duplicate issue ids across the tracker fail', () => {
    const b = '## Acceptance Criteria\n\n[1] marker\n';
    const r = check(sdlc, buildIssueBundle([
      { id: 'DUP', body: frame('DUP', { state: 'open', stateType: 'open', assignee: 'a', body: b }).body },
      { id: 'DUP', body: frame('DUP', { state: 'open', stateType: 'open', assignee: 'a', body: b }).body },
    ]), ctx);
    expect(r.findings.some((f) => f.code === 'simple-sdlc_duplicate_issue_id')).toBe(true);
  });

  test('canceled issues are exempt from assignee/AC gates', () => {
    const r = check(sdlc, buildIssueBundle([frame('A-4', { state: 'Canceled', stateType: 'canceled', body: '[1] marker\n' })]), ctx);
    expect(r.findings.some((f) => f.code === 'simple-sdlc_case_missing_assignee')).toBe(false);
    expect(r.findings.some((f) => f.code === 'simple-sdlc_case_missing_acceptance_criteria')).toBe(false);
  });

  test('evidence is discovered structurally from the ## Evidence section only (no global line-scan)', () => {
    // A stray "[E9] ..." line OUTSIDE the Evidence section must NOT become an
    // evidence record; only the entry inside ## Evidence is registered.
    const body = '## Notes\n\n[E9] type: bogus not in the evidence section\n\n## Acceptance Criteria\n\n- [x] dev/01 status: passed done. commit: ' + HEAD + ' [E1] [1]\n\n## Evidence\n\n[E1] type: pr repo: x/y\n\n## Sources\n\n[1] r\n';
    const root = sdlc.schema.parse(sdlc.parse(buildIssueBundle([frame('A-9', { state: 'open', stateType: 'open', assignee: 'a', body })])));
    const ac = root.issues[0]!.acceptanceCriteria[0]!;
    // dev/01 cites [E1] which resolves; [E9] is outside ## Evidence so it does not exist
    expect(ac.evidence.map((e) => e.id)).toEqual(['E1']);
    const r = check(sdlc, buildIssueBundle([frame('A-9', { state: 'open', stateType: 'open', assignee: 'a', body })]), ctx);
    // citing only [E1] (which exists) → no unknown-evidence finding
    expect(r.findings.some((f) => f.code === 'simple-sdlc_checked_ac_missing_evidence')).toBe(false);
  });

  test('multi-entry evidence as GFM list items is parsed node-structurally (one record per node)', () => {
    const body = '## Acceptance Criteria\n\n- [x] dev/01 status: passed a. commit: ' + HEAD + ' [E1] [E2] [1]\n\n## Evidence\n\n- [E1] type: pr repo: x/y\n- [E2] type: screenshot path: shots/a.png\n\n## Sources\n\n[1] r\n';
    const root = sdlc.schema.parse(sdlc.parse(buildIssueBundle([frame('A-7', { state: 'open', stateType: 'open', assignee: 'a', body })])));
    const ac = root.issues[0]!.acceptanceCriteria[0]!;
    expect(ac.evidence.map((e) => e.id)).toEqual(['E1', 'E2']); // both list items discovered as records
    expect(ac.evidence.find((e) => e.id === 'E2')).toMatchObject({ type: 'screenshot', path: 'shots/a.png' });
  });

  test('evidence justification keeps colons/URLs (free text to EOL, not truncated)', () => {
    const body = '## Acceptance Criteria\n\n- [x] dev/01 status: passed a. commit: ' + HEAD + ' [E1] [1]\n\n## Evidence\n\n- [E1] type: doc justification: see ticket: VOL-12 at https://x/y for context\n\n## Sources\n\n[1] r\n';
    const root = sdlc.schema.parse(sdlc.parse(buildIssueBundle([frame('A-1', { state: 'open', stateType: 'open', assignee: 'a', body })])));
    expect(root.issues[0]!.acceptanceCriteria[0]!.evidence[0]).toMatchObject({ id: 'E1', type: 'doc', justification: 'see ticket: VOL-12 at https://x/y for context' });
  });

  test('legacy multi-[En] paragraph: all entries read (not just the first)', () => {
    const body = '## Acceptance Criteria\n\n- [x] dev/01 status: passed a. commit: ' + HEAD + ' [E1] [E2] [1]\n\n## Evidence\n\n[E1] type: pr\n[E2] type: screenshot\n\n## Sources\n\n[1] r\n';
    const root = sdlc.schema.parse(sdlc.parse(buildIssueBundle([frame('A-2', { state: 'open', stateType: 'open', assignee: 'a', body })])));
    expect(root.issues[0]!.acceptanceCriteria[0]!.evidence.map((e) => e.id)).toEqual(['E1', 'E2']);
  });

  test('nested evidence list: entries under a grouping bullet are still discovered', () => {
    const body = '## Acceptance Criteria\n\n- [x] dev/01 status: passed a. commit: ' + HEAD + ' [E1] [1]\n\n## Evidence\n\n- Group:\n  - [E1] type: pr repo: x/y\n\n## Sources\n\n[1] r\n';
    const root = sdlc.schema.parse(sdlc.parse(buildIssueBundle([frame('A-3', { state: 'open', stateType: 'open', assignee: 'a', body })])));
    expect(root.issues[0]!.acceptanceCriteria[0]!.evidence.map((e) => e.id)).toEqual(['E1']);
  });

  test('a second H1 in the body does NOT hijack the issue id', () => {
    const body = '## Acceptance Criteria\n\n- [ ] dev/01 status: pending a [1]\n\n# NOT THE ID: nope\n\n## Sources\n\n[1] r\n';
    const root = sdlc.schema.parse(sdlc.parse(buildIssueBundle([frame('REAL-1', { state: 'open', stateType: 'open', assignee: 'a', body })])));
    expect(root.issues[0]!.id).toBe('REAL-1');
  });

  test('a body line forging the ===ISSUE=== marker does not split into a phantom issue', () => {
    const body = '## Acceptance Criteria\n\n- [ ] dev/01 status: pending a [1]\n\n## Notes\n\n===ISSUE injected===\n\n## Sources\n\n[1] r\n';
    const root = sdlc.schema.parse(sdlc.parse(buildIssueBundle([frame('ONLY-1', { state: 'open', stateType: 'open', assignee: 'a', body })])));
    expect(root.issues.map((i) => i.id)).toEqual(['ONLY-1']);
  });

  test('checkbox/status contradiction is flagged (- [x] with status: pending)', () => {
    const body = '## Acceptance Criteria\n\n- [x] dev/01 status: pending contradictory [1]\n\n## Sources\n\n[1] r\n';
    const r = check(sdlc, buildIssueBundle([frame('A-8', { state: 'open', stateType: 'open', assignee: 'a', body })]), ctx);
    expect(r.findings.some((f) => f.code === 'simple-sdlc_checkbox_status_mismatch')).toBe(true);
  });

  test('spec-sections variant requires ## Requirements and ## Acceptance Criteria', () => {
    const spec = createGenericPreset({ name: 'simple-spec', requireSourceMarker: true, requireSpecSections: true });
    const r = check(spec, buildIssueBundle([frame('S-1', { state: 'open', stateType: 'open', assignee: 'a', body: '## Summary\n\nx [1]\n' })]), ctx);
    expect(r.findings.some((f) => f.code === 'simple-spec_missing_requirements')).toBe(true);
    expect(r.findings.some((f) => f.code === 'simple-spec_missing_acceptance_criteria')).toBe(true);
  });

  describe('AC blocking (universal refs)', () => {
    const basic = createGenericPreset({ name: 'basic' });

    test('parses inline blocked-by / blocks, resolving bare refs to this issue and colon refs cross-issue', () => {
      const body = '## Acceptance Criteria\n\n- [ ] dev/02 status: pending Later. blocked-by: dev/01, APP-2:dev/09 blocks: dev/03 [1]\n- [ ] dev/01 status: pending First.\n- [ ] dev/03 status: pending After.\n';
      const root = basic.schema.parse(basic.parse(buildIssueBundle([frame('APP-1', { assignee: 'a', body })])));
      const ac = root.issues[0]!.acceptanceCriteria.find((a) => a.id === 'dev/02')!;
      expect(ac.blockedBy).toEqual([{ issue: 'APP-1', ac: 'dev/01' }, { issue: 'APP-2', ac: 'dev/09' }]);
      expect(ac.blocks).toEqual([{ issue: 'APP-1', ac: 'dev/03' }]);
    });

    test('a blocker pointing at a non-existent AC fails', () => {
      const body = '## Acceptance Criteria\n\n- [ ] dev/01 status: pending x. blocked-by: dev/99 [1]\n';
      const r = check(basic, buildIssueBundle([frame('APP-1', { assignee: 'a', body })]), ctx);
      expect(r.findings.some((f) => f.code === 'basic_ac_blocker_missing')).toBe(true);
    });

    test('a cross-issue blocker that does resolve is clean', () => {
      const a = frame('APP-1', { assignee: 'a', body: '## Acceptance Criteria\n\n- [ ] dev/01 status: pending x. blocked-by: APP-2:dev/09 [1]\n' });
      const b = frame('APP-2', { assignee: 'a', body: '## Acceptance Criteria\n\n- [ ] dev/09 status: pending y [1]\n' });
      const r = check(basic, buildIssueBundle([a, b]), ctx);
      expect(r.findings.some((f) => f.code.startsWith('basic_ac_block'))).toBe(false);
    });

    test('an AC listing itself as a blocker is flagged', () => {
      const body = '## Acceptance Criteria\n\n- [ ] dev/01 status: pending x. blocked-by: dev/01 [1]\n';
      const r = check(basic, buildIssueBundle([frame('APP-1', { assignee: 'a', body })]), ctx);
      expect(r.findings.some((f) => f.code === 'basic_ac_self_block')).toBe(true);
    });

    test('a passed AC blocked by an unpassed AC fails', () => {
      const body = '## Acceptance Criteria\n\n- [x] dev/02 status: passed Done. commit: ' + HEAD + ' [E1] blocked-by: dev/01\n- [ ] dev/01 status: pending Not done.\n\n## Evidence\n\n- [E1] type: pr\n';
      const r = check(basic, buildIssueBundle([frame('APP-1', { assignee: 'a', body })]), ctx);
      expect(r.findings.some((f) => f.code === 'basic_ac_blocked_by_unpassed')).toBe(true);
    });

    test('the gate fires through the inverse `blocks` edge too (unified graph)', () => {
      // dev/01 is unpassed and `blocks: dev/02`, while dev/02 is passed → dev/02
      // depends on an unpassed dev/01, even though dev/02 has no blocked-by of its own.
      const body = '## Acceptance Criteria\n\n- [ ] dev/01 status: pending First. blocks: dev/02\n- [x] dev/02 status: passed Done. commit: ' + HEAD + ' [E1]\n\n## Evidence\n\n- [E1] type: pr\n';
      const r = check(basic, buildIssueBundle([frame('APP-1', { assignee: 'a', body })]), ctx);
      expect(r.findings.some((f) => f.code === 'basic_ac_blocked_by_unpassed')).toBe(true);
    });

    test('a blocking cycle is reported', () => {
      const body = '## Acceptance Criteria\n\n- [ ] dev/01 status: pending a. blocked-by: dev/02\n- [ ] dev/02 status: pending b. blocked-by: dev/01\n';
      const r = check(basic, buildIssueBundle([frame('APP-1', { assignee: 'a', body })]), ctx);
      expect(r.findings.some((f) => f.code === 'basic_ac_block_cycle')).toBe(true);
    });

    test('cross-level: a bare token naming an issue blocks on the whole issue', () => {
      // `blocked-by: APP-2` is not a local AC, so it resolves to issue APP-2. APP-2 has a
      // pending AC, so the passed dev/01 is completed out of order.
      const a = frame('APP-1', { assignee: 'a', body: '## Acceptance Criteria\n\n- [x] dev/01 status: passed Done. commit: ' + HEAD + ' [E1] blocked-by: APP-2\n\n## Evidence\n\n- [E1] type: pr\n' });
      const b = frame('APP-2', { assignee: 'a', body: '## Acceptance Criteria\n\n- [ ] dev/09 status: pending Not done.\n' });
      const root = basic.schema.parse(basic.parse(buildIssueBundle([a, b])));
      expect(root.issues[0]!.acceptanceCriteria[0]!.blockedBy).toEqual([{ issue: 'APP-2' }]); // issue-level, not a dangling AC
      const r = check(basic, buildIssueBundle([a, b]), ctx);
      expect(r.findings.some((f) => f.code === 'basic_ac_blocked_by_unpassed')).toBe(true);
    });

    test('a blocker written by `ac block` parses correctly even with a trailing AC-Version stamp', () => {
      // structured write path: check (stamps AC-Version), then block. The parser must
      // read the blocker and NOT swallow the AC-Version token into the ref.
      const start = '# APP-1: t\n\n## Acceptance Criteria\n\n- [ ] dev/03 status: pending Wire it. [1]\n- [ ] dev/02 status: pending First.\n\n## Sources\n\n[1] r\n';
      const checked = applyAcMutation(start, { op: 'check', acId: 'dev/03', commit: 'abc1234' }).body;
      const blocked = applyAcMutation(checked, { op: 'block', acId: 'dev/03', field: 'blocked-by', refs: ['dev/02'] }).body;
      const root = basic.schema.parse(basic.parse(buildIssueBundle([{ id: 'APP-1', body: blocked }])));
      const ac = root.issues[0]!.acceptanceCriteria.find((a) => a.id === 'dev/03')!;
      expect(ac.blockedBy).toEqual([{ issue: 'APP-1', ac: 'dev/02' }]); // clean ref, no AC-Version garbage
      const r = check(basic, buildIssueBundle([{ id: 'APP-1', body: blocked }]), ctx);
      expect(r.findings.some((f) => f.code === 'basic_ac_blocker_missing')).toBe(false);
    });
  });
});

describe('freshness-anchored waiver', () => {
  const wv = createGenericPreset({ name: 'wv', requireSdlcGates: true });
  // a checked AC that cites no commit and no evidence — two real `error` findings to waive.
  const AC = '## Acceptance Criteria\n\n- [x] dev/01 status: passed Do the thing.\n';
  const body = (w?: { reason?: string; by?: string; acv?: string }): string =>
    !w ? AC : `${AC}\n## Waiver\n\nreason: ${w.reason ?? ''}\nby: ${w.by ?? ''}\nac-version: ${w.acv ?? ''}\n`;
  const run = (b: string) => check(wv, buildIssueBundle([frame('W-1', { state: 'open', stateType: 'open', assignee: 'a', body: b })]), {});
  // the fingerprint the engine computes for this issue's ACs (the waiver section doesn't change ACs).
  const FP = issueAcFingerprint(wv.schema.parse(wv.parse(buildIssueBundle([frame('W-1', { state: 'open', stateType: 'open', assignee: 'a', body: body() })]))).issues[0]!);

  test('the unwaived red issue gates (errors stand)', () => {
    const r = run(body());
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === 'wv_checked_ac_missing_commit_hash' && f.severity === 'error')).toBe(true);
  });

  test('a reasoned, signed, FRESH waiver downgrades the issue’s errors to acknowledged → ok', () => {
    const r = run(body({ reason: 'known infra gap, tracked in APP-9', by: 'alice (a@x)', acv: FP }));
    expect(r.ok).toBe(true);
    expect(r.findings.some((f) => f.severity === 'error')).toBe(false);
    const ack = r.findings.find((f) => f.code === 'wv_checked_ac_missing_commit_hash');
    expect(ack?.severity).toBe('acknowledged');
    expect(ack?.message).toContain('acknowledged by alice (a@x)');
    expect(r.findings.some((f) => f.code.startsWith('waiver_'))).toBe(false);
  });

  test('a waiver with no reason is itself an error and does NOT downgrade', () => {
    const r = run(body({ by: 'alice', acv: FP }));
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === 'waiver_missing_reason' && f.severity === 'error')).toBe(true);
    expect(r.findings.some((f) => f.code === 'wv_checked_ac_missing_commit_hash' && f.severity === 'error')).toBe(true);
  });

  test('a waiver with no sign-off is itself an error and does NOT downgrade', () => {
    const r = run(body({ reason: 'x', acv: FP }));
    expect(r.findings.some((f) => f.code === 'waiver_missing_signoff' && f.severity === 'error')).toBe(true);
    expect(r.ok).toBe(false);
  });

  test('a waiver whose ac-version no longer matches (criteria edited) is stale and does NOT downgrade', () => {
    const r = run(body({ reason: 'x', by: 'alice', acv: 'acw_000000000000' }));
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.code === 'waiver_stale' && f.severity === 'warning')).toBe(true);
    expect(r.findings.some((f) => f.code === 'wv_checked_ac_missing_commit_hash' && f.severity === 'error')).toBe(true);
  });

  test('a fresh waiver downgrades readiness errors but NOT structural invariants (H2)', () => {
    // dev/01: checked, no commit — a waivable readiness error. dev/02: self-block — a
    // non-waivable structural invariant (can never be coherent no matter who signs off).
    const acBlock = '- [x] dev/01 status: passed Did it.\n- [ ] dev/02 status: pending Wait. blocked-by: dev/02\n';
    const base = `## Acceptance Criteria\n\n${acBlock}`;
    const fp = issueAcFingerprint(wv.schema.parse(wv.parse(buildIssueBundle([frame('W-2', { state: 'open', stateType: 'open', assignee: 'a', body: base })]))).issues[0]!);
    const waived = `${base}\n## Waiver\n\nreason: accept it\nby: alice\nac-version: ${fp}\n`;
    const r = check(wv, buildIssueBundle([frame('W-2', { state: 'open', stateType: 'open', assignee: 'a', body: waived })]), {});
    expect(r.findings.find((f) => f.code === 'wv_ac_self_block')?.severity).toBe('error');            // invariant survives the waiver
    expect(r.findings.find((f) => f.code === 'wv_checked_ac_missing_commit_hash')?.severity).toBe('acknowledged'); // readiness error downgraded
    expect(r.ok).toBe(false); // the non-waivable error still gates
  });
});

describe('descope: the honest alternative to a waiver', () => {
  const wv = createGenericPreset({ name: 'wv', requireSdlcGates: true });
  const run = (acBlock: string, state = 'done', stateType = 'completed') =>
    check(wv, buildIssueBundle([frame('D-1', { state, stateType, assignee: 'a', body: `## Acceptance Criteria\n\n${acBlock}\n` })]), {});

  test('a done case with a descoped (reasoned) AC is green — no waiver needed', () => {
    const r = run('- [x] dev/01 status: passed Did it. commit: a1b2c3d4 [E1]\n- [ ] dev/02 status: descoped reason: out of scope for v1\n');
    expect(r.findings.some((f) => f.code === 'wv_done_with_unpassed_acceptance_criteria')).toBe(false);
    expect(r.findings.some((f) => f.code === 'wv_descoped_ac_missing_reason')).toBe(false);
  });

  test('a descoped AC with no reason is an error', () => {
    const r = run('- [ ] dev/02 status: descoped\n', 'open', 'open');
    expect(r.findings.some((f) => f.code === 'wv_descoped_ac_missing_reason' && f.severity === 'error')).toBe(true);
  });

  test('a BLOCKED AC is NOT settled — a done case carrying one still fails', () => {
    const r = run('- [x] dev/01 status: passed Did it. commit: a1b2c3d4 [E1]\n- [ ] dev/02 status: blocked\n');
    expect(r.findings.some((f) => f.code === 'wv_done_with_unpassed_acceptance_criteria')).toBe(true);
  });

  test('a done case with EVERY AC descoped is flagged (needs ≥1 actually passed)', () => {
    const r = run('- [ ] dev/01 status: descoped reason: cut from v1\n- [ ] dev/02 status: descoped reason: cut from v1\n');
    expect(r.findings.some((f) => f.code === 'wv_done_with_unpassed_acceptance_criteria')).toBe(true);
  });

  test('`reason:` on the same line as `blocked-by:` does not corrupt the blocker (H1)', () => {
    const root = wv.schema.parse(wv.parse(buildIssueBundle([frame('D-1', { state: 'open', stateType: 'open', assignee: 'a',
      body: '## Acceptance Criteria\n\n- [ ] dev/01 status: pending First.\n- [ ] dev/02 status: descoped blocked-by: dev/01 reason: out of scope\n' })])));
    const ac2 = root.issues[0]!.acceptanceCriteria.find((a) => a.id === 'dev/02')!;
    expect(ac2.blockedBy).toEqual([{ issue: 'D-1', ac: 'dev/01' }]); // the real blocker survives, not "dev/01 reason"
    expect(ac2.descopeReason).toBe('out of scope');
  });

  test('descopeReason is set only on descoped ACs and does not swallow trailing refs (M4)', () => {
    const root = wv.schema.parse(wv.parse(buildIssueBundle([frame('D-1', { state: 'open', stateType: 'open', assignee: 'a',
      body: '## Acceptance Criteria\n\n- [x] dev/01 status: passed Do it for a reason: clarity [E1] commit: abc1234\n- [ ] dev/02 status: descoped reason: superseded by auth work [E1]\n\n## Evidence\n\n[E1] type: pr\n' })])));
    const acs = root.issues[0]!.acceptanceCriteria;
    expect(acs.find((a) => a.id === 'dev/01')!.descopeReason).toBeUndefined();   // not descoped → no reason
    expect(acs.find((a) => a.id === 'dev/02')!.descopeReason).toBe('superseded by auth work'); // [E1] not swallowed
  });
});
