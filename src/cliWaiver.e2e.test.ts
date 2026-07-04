// ZTB-32 — fingerprinted, self-expiring waivers (`// eslint-disable-next-line` parity).
// Black-box e2e (real CLI, spawnSync): an issue with TWO acceptance criteria each citing a
// NONEXISTENT commit produces two `evidence_commit_not_found` findings with distinct subjects
// (the two shas). We prove: `waiver sign` auto-captures the ref when unambiguous and refuses
// (listing choices) when ambiguous; a pinned waiver does not mask the other occurrence;
// `waiver migrate` rewrites a legacy issue-level waiver into per-occurrence pinned rows.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const FAKE_A = 'aaaaaaa1111111111111111111111111111111a1';
const FAKE_B = 'bbbbbbb2222222222222222222222222222222b2';

function ztrackIn(cwd: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// Two ACs, each citing a nonexistent commit → two evidence_commit_not_found findings (subjects
// FAKE_A, FAKE_B). `waivers` (optional) appends a legacy unpinned `## Waivers` section, stored
// through the backend by `issue create` (a raw file append lands outside the parsed body).
function body(waivers = false): string {
  const lines = [
    '# Wire the widget', '', 'Summary: one verifiable outcome.', '',
    '## Acceptance Criteria', '',
    '- [x] dev/01 v1 first thing', '  - status: passed', `  - evidence ev1: commit=${FAKE_A} acv=1`, '  - proof: "ev1 shows it" -> ev1',
    '- [x] dev/02 v1 second thing', '  - status: passed', `  - evidence ev1: commit=${FAKE_B} acv=1`, '  - proof: "ev1 shows it" -> ev1', '',
  ];
  if (waivers) lines.push('## Waivers', '', '- code: evidence_commit_not_found reason: destroyed in the 2026-07-03 incident by: Tess (t@t.co)', '');
  return lines.join('\n');
}

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
  return root;
}

function createIssue(root: string, withWaivers = false): string {
  expect(ztrackIn(root, ['init', '--team', 'ZT']).code).toBe(0);
  const bodyFile = join(root, 'body.md');
  writeFileSync(bodyFile, body(withWaivers));
  const created = ztrackIn(root, ['issue', 'create', '--title', 'Wire the widget', '--state', 'ready', '--body-file', bodyFile]);
  expect(created.code).toBe(0);
  return (JSON.parse(created.out) as { identifier: string }).identifier;
}

describe('fingerprinted waivers e2e (ZTB-32)', () => {
  test('waiver sign auto-captures the ref when one occurrence, refuses (lists) when ambiguous, and does not mask the other', () => {
    const root = freshRepo('ztrk-wv-sign-');
    try {
      const id = createIssue(root);
      // ambiguous: issue-level (no --ac) has TWO bad commits → must refuse and list both shas
      const amb = ztrackIn(root, ['waiver', 'sign', id, '--code', 'evidence_commit_not_found', '--reason', 'lost']);
      expect(amb.code).not.toBe(0);
      expect(amb.err + amb.out).toContain('distinct occurrences');
      expect(amb.err + amb.out).toContain(FAKE_A);
      expect(amb.err + amb.out).toContain(FAKE_B);
      // unambiguous: scope to dev/01 (one bad commit) → auto-captures ref = FAKE_A
      const signed = ztrackIn(root, ['waiver', 'sign', id, '--code', 'evidence_commit_not_found', '--ac', 'dev/01', '--reason', 'lost in incident']);
      expect(signed.code).toBe(0);
      expect(signed.out).toContain(`ref ${FAKE_A}`);
      expect(ztrackIn(root, ['issue', 'view', id]).out).toContain(`ref: ${FAKE_A}`);
      // it did NOT mask dev/02: that finding still fires, so check is not green
      const chk = ztrackIn(root, ['check']);
      expect(chk.out).toContain('evidence_commit_not_found');
      expect(chk.code).not.toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  test('waiver migrate rewrites a legacy issue-level waiver into per-occurrence pinned rows', () => {
    const root = freshRepo('ztrk-wv-migrate-');
    try {
      const id = createIssue(root, /* withWaivers */ true);
      // legacy state: check passes (both downgraded) but is flagged overbroad
      const before = ztrackIn(root, ['check']);
      expect(before.code).toBe(0);
      expect(before.out).toContain('waiver_overbroad');
      // migrate → one pinned row per occurrence, reason preserved
      const mig = ztrackIn(root, ['waiver', 'migrate', id]);
      expect(mig.code).toBe(0);
      const view = ztrackIn(root, ['issue', 'view', id]).out;
      expect(view).toContain(`ref: ${FAKE_A}`);
      expect(view).toContain(`ref: ${FAKE_B}`);
      expect(view).toContain('destroyed in the 2026-07-03 incident');
      // after: still green, and no longer overbroad
      const after = ztrackIn(root, ['check']);
      expect(after.code).toBe(0);
      expect(after.out).not.toContain('waiver_overbroad');
      // idempotent: a second migrate changes nothing
      expect(ztrackIn(root, ['waiver', 'migrate', id]).out.toLowerCase()).toContain('nothing to migrate');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});
