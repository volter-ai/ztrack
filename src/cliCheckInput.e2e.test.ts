// ZTB-36 — black-box e2e (real CLI, spawnSync): `check --issues a,b --input root.json` used to
// be silently inert. The parsed `--issues` value never reached `checkTrackerRoot` —
// `target` is forced `null` on the `--input` path (see cliCheck.ts's "Resolve the unified
// TARGET" comment), and `issues` (derived from `target`) is always undefined there — so a
// typo'd or stale id in a CI invocation validating a committed root silently passed with
// `"ok": true` and the WHOLE root validated regardless of `--issues`. The fix threads
// `issuesFromFlag` straight into `checkTrackerRoot`, which now scopes validation to those ids
// WITHIN the root (mirroring the live path's loader-side `wanted` filter, src/core/loader.ts)
// and errors loud — naming the `--input` file, not "the tracker" — on ids absent from it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const FAKE_COMMIT = 'deadbeef'; // never a real commit in these fixture repos — mirrors cliCheckPreset.e2e.test.ts's FAILING_AC
const FAKE_ACK = 'aaaaaaa1111111111111111111111111111111a1'; // 40-hex, mirrors cliCheckHonesty.e2e.test.ts's FAKE_ACK

function ztrackIn(cwd: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function freshRepo(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
  gitIn(root, 'init', '-q');
  gitIn(root, 'config', 'user.email', 't@t.co');
  gitIn(root, 'config', 'user.name', 'Tess');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  gitIn(root, 'add', 'README.md');
  gitIn(root, 'commit', '-q', '-m', 'initial');
  expect(ztrackIn(root, ['init', '--team', 'ZT']).code).toBe(0);
  return root;
}

function createIssue(root: string, title: string, bodyText: string, state = 'ready'): string {
  const bodyFile = join(root, `${title.replace(/\s+/g, '-')}.md`);
  writeFileSync(bodyFile, bodyText);
  const created = ztrackIn(root, ['issue', 'create', '--title', title, '--state', state, '--body-file', bodyFile]);
  expect(created.code).toBe(0);
  return (JSON.parse(created.out) as { identifier: string }).identifier;
}

const cleanBody = '# Clean\n\nSummary: ok, nothing to see here.\n';

// A passed AC citing a commit that does not exist in this repo — `evidence_commit_not_found`
// fires under the default (verify-commits: on) preset. Mirrors cliCheckPreset.e2e.test.ts's
// FAILING_AC fixture.
const failingBody = [
  '# Bad', '', 'Summary: cites a commit that does not exist.', '',
  '## Acceptance Criteria', '',
  '- [x] dev/01 v1 does the thing', '  - status: passed', `  - evidence ev1: commit=${FAKE_COMMIT} acv=1`, '  - proof: "ev1 shows it" -> ev1', '',
].join('\n');

// One AC citing a nonexistent commit, ref-pinned by a signed waiver — downgrades to ONE
// `acknowledged` finding. Mirrors cliCheckHonesty.e2e.test.ts's ackOnlyBody exactly.
const ackOnlyBody = [
  '# Ack only', '', 'Summary: one waived finding, nothing else.', '',
  '## Acceptance Criteria', '',
  '- [x] dev/01 v1 does the thing', '  - status: passed', `  - evidence ev1: commit=${FAKE_ACK} acv=1`, '  - proof: "ev1 shows it" -> ev1', '',
  '## Waivers', '',
  `- code: evidence_commit_not_found ref: ${FAKE_ACK} reason: destroyed in the incident by: Tess (t@t.co)`, '',
].join('\n');

describe('check --issues scoping within --input roots (ZTB-36; --case removed pre-1.0 by ZTB-42)', () => {
  test('1. typo\'d id errors loud, naming the --input root (the money shot)', () => {
    const root = freshRepo('ztrk-input-typo-');
    try {
      const id = createIssue(root, 'Clean', cleanBody, 'draft');
      expect(ztrackIn(root, ['export', '--out', 'root.json']).code).toBe(0);

      const plain = ztrackIn(root, ['check', '--issues', `${id},TOTALLY-MISSING`, '--input', 'root.json']);
      expect(plain.code).not.toBe(0);
      const plainAll = plain.out + plain.err;
      expect(plainAll).toContain('TOTALLY-MISSING');
      expect(plainAll).toMatch(/\broot\.json\b/);
      expect(plainAll).not.toContain('"ok": true');
      expect(plainAll).not.toContain('in the tracker');
      expect(plainAll).not.toContain('issue list');

      const json = ztrackIn(root, ['check', '--issues', `${id},TOTALLY-MISSING`, '--input', 'root.json', '--json']);
      expect(json.code).not.toBe(0);
      const jsonAll = json.out + json.err;
      expect(jsonAll).toContain('TOTALLY-MISSING');
      expect(jsonAll).toMatch(/\broot\.json\b/);
      expect(jsonAll).not.toContain('"ok": true');
      expect(jsonAll).not.toContain('in the tracker');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  describe('scoping + the unscoped no-regression pin, on one shared root (ZT-1 clean, ZT-2 real finding)', () => {
    let root = '';
    let idClean = '';
    let idBad = '';
    beforeAll(() => {
      root = freshRepo('ztrk-input-scope-');
      idClean = createIssue(root, 'Clean', cleanBody, 'draft');
      idBad = createIssue(root, 'Bad', failingBody);
      expect(ztrackIn(root, ['export', '--out', 'root.json']).code).toBe(0);
    }, 60_000);
    afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

    test('2. --issues <clean> --input scopes to it: ok true, summary.issues 1, no Bad finding', () => {
      const r = ztrackIn(root, ['check', '--issues', idClean, '--input', 'root.json', '--json']);
      expect(r.code).toBe(0);
      const payload = JSON.parse(r.out) as { ok: boolean; summary: { issues: number }; findings: Array<{ issueId?: string; code: string }> };
      expect(payload.ok).toBe(true);
      expect(payload.summary.issues).toBe(1);
      expect(payload.findings.some((f) => f.issueId === idBad)).toBe(false);
    });

    test('2b. --issues <bad> --input scopes to it: ok false, the ZT-2 finding present, summary.issues 1', () => {
      const r = ztrackIn(root, ['check', '--issues', idBad, '--input', 'root.json', '--json']);
      expect(r.code).toBe(1);
      const payload = JSON.parse(r.out) as { ok: boolean; summary: { issues: number }; findings: Array<{ issueId?: string; code: string }> };
      expect(payload.ok).toBe(false);
      expect(payload.summary.issues).toBe(1);
      expect(payload.findings.some((f) => f.code === 'evidence_commit_not_found' && f.issueId === idBad)).toBe(true);
    });

    test('3. unscoped --input is unchanged: whole root validated (summary.issues 2, the ZT-2 finding present)', () => {
      const r = ztrackIn(root, ['check', '--input', 'root.json', '--json']);
      expect(r.code).toBe(1);
      const payload = JSON.parse(r.out) as { ok: boolean; summary: { issues: number }; findings: Array<{ issueId?: string; code: string }> };
      expect(payload.ok).toBe(false);
      expect(payload.summary.issues).toBe(2);
      expect(payload.findings.some((f) => f.code === 'evidence_commit_not_found' && f.issueId === idBad)).toBe(true);
    });

    test('4. --case is REMOVED (ZTB-42): rejects loud as an unknown flag on the --input path', () => {
      const r = ztrackIn(root, ['check', '--case', idClean, '--input', 'root.json', '--json']);
      expect(r.code).not.toBe(0);
      const all = r.out + r.err;
      expect(all).toMatch(/unknown flag/);
      expect(all).toContain('--case');
      // did-you-mean is whatever the registry's edit-distance match actually produces for
      // '--case' against `check`'s flag set — currently `--phase`, not `--issues` (closer edit
      // distance); not force-pinned to a "nicer" suggestion.
      expect(all).toContain('--phase');
    });
  });

  test('5. shape-broken root ({ issues: 42 }) + --issues --input, DEFAULT flags: the shape finding wins, not the not-found error, no crash (ZTB-38)', () => {
    const root = freshRepo('ztrk-input-shape-');
    try {
      writeFileSync(join(root, 'root.json'), JSON.stringify({ issues: 42 }));
      // Default flags (commit verification ON) — ZTB-38 gates checkTrackerRoot's loadContext call
      // on the root having a usable `issues` array at all, so the installed preset's loadContext
      // (citedEvidenceFiles/citedCommits in simple-sdlc.ts, which used to dereference
      // `input.root.issues.flatMap` directly) is never even called here — checkRoot's own shape
      // validation reports `root_shape_invalid` instead of a raw TypeError.
      const r = ztrackIn(root, ['check', '--issues', 'ZT-1', '--input', 'root.json', '--json']);
      expect(r.code).not.toBe(0);
      const payload = JSON.parse(r.out) as { ok: boolean; findings: Array<{ code: string }> };
      expect(payload.ok).toBe(false);
      expect(payload.findings.some((f) => f.code === 'root_shape_invalid')).toBe(true);
      expect(r.out + r.err).not.toContain('not found in the --input root');
      expect(r.out + r.err).not.toContain('flatMap');
      expect(r.out + r.err).not.toContain('is not a function');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  test('6. waivers ride along when scoped: an acknowledged finding stays acknowledged, not resurfaced as an error', () => {
    const root = freshRepo('ztrk-input-waiver-');
    try {
      const id = createIssue(root, 'Ack only', ackOnlyBody);
      expect(ztrackIn(root, ['export', '--out', 'root.json']).code).toBe(0);
      const r = ztrackIn(root, ['check', '--issues', id, '--input', 'root.json', '--json']);
      expect(r.code).toBe(0);
      const payload = JSON.parse(r.out) as {
        ok: boolean; summary: { issues: number; acknowledged: number };
        findings: Array<{ code: string; severity: string }>;
      };
      expect(payload.ok).toBe(true);
      expect(payload.summary.issues).toBe(1);
      expect(payload.summary.acknowledged).toBe(1);
      expect(payload.findings.some((f) => f.code === 'evidence_commit_not_found' && f.severity === 'acknowledged')).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});

// ZTB-38 — `ztrack check --input badroot.json` where badroot.json is top-level shape-broken
// crashed with a raw preset TypeError (`input.root.issues.flatMap is not a function`) under
// DEFAULT flags (commit verification on), before checkRoot's own schema validation ever ran.
// `--no-verify-commits` masked it (simple-sdlc's loadContext skips the crashing reads when commit
// verification is off) — these pins run under DEFAULT flags throughout, the money shot as filed.
describe('malformed --input root reports shape findings, never a raw crash (ZTB-38)', () => {
  test('1. top-level-broken root ({ issues: 42 }), plain --input, default flags: root_shape_invalid, no TypeError', () => {
    const root = freshRepo('ztrk-input-crash-toplevel-');
    try {
      writeFileSync(join(root, 'badroot.json'), JSON.stringify({ issues: 42 }));
      const r = ztrackIn(root, ['check', '--input', 'badroot.json', '--json']);
      expect(r.code).not.toBe(0);
      const payload = JSON.parse(r.out) as { ok: boolean; findings: Array<{ code: string }> };
      expect(payload.ok).toBe(false);
      expect(payload.findings.some((f) => f.code === 'root_shape_invalid')).toBe(true);
      expect(r.out + r.err).not.toContain('flatMap');
      expect(r.out + r.err).not.toContain('is not a function');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  test('2a. deep garbage ({ issues: [42] }), plain --input, default flags: shape/wellformed findings, no crash', () => {
    const root = freshRepo('ztrk-input-crash-deep-num-');
    try {
      writeFileSync(join(root, 'badroot.json'), JSON.stringify({ issues: [42] }));
      const r = ztrackIn(root, ['check', '--input', 'badroot.json', '--json']);
      expect(r.code).not.toBe(0);
      const payload = JSON.parse(r.out) as { ok: boolean; findings: Array<{ code: string }> };
      expect(payload.ok).toBe(false);
      expect(payload.findings.length).toBeGreaterThan(0);
      expect(r.out + r.err).not.toContain('flatMap');
      expect(r.out + r.err).not.toContain('is not a function');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  test('2b. deep garbage ({ issues: [{"id":"ZT-9"}] }, no acceptanceCriteria), plain --input, default flags: shape/wellformed findings, no crash', () => {
    const root = freshRepo('ztrk-input-crash-deep-obj-');
    try {
      writeFileSync(join(root, 'badroot.json'), JSON.stringify({ issues: [{ id: 'ZT-9' }] }));
      const r = ztrackIn(root, ['check', '--input', 'badroot.json', '--json']);
      expect(r.code).not.toBe(0);
      const payload = JSON.parse(r.out) as { ok: boolean; findings: Array<{ code: string }> };
      expect(payload.ok).toBe(false);
      expect(payload.findings.length).toBeGreaterThan(0);
      expect(r.out + r.err).not.toContain('flatMap');
      expect(r.out + r.err).not.toContain('is not a function');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});
