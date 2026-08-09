// Z2 — black-box e2e (real CLI, real git repo, subprocess): `evidence_sha_stale` in
// simple-gh-sdlc.ts used to require an evidence commit to be EQUAL to the PR head sha
// (`shaMatches`), rejecting honest multi-commit evidence (e.g. a baseline commit captured
// earlier in the same PR's history, cited alongside a `PR:` line naming the eventual head).
// The fix (`isAncestorOfPrHead`) accepts any commit reachable as an ancestor of (or equal to)
// the PR head, via `git merge-base --is-ancestor` — a real git-repo check, so this proves it
// against an ACTUAL branch history, not a synthetic Context fixture (see
// simple-gh-sdlc.test.ts's existing synthetic-context tests for the equality-preserving case).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..'); // boilerplates/presets -> repo root
const CLI = join(import.meta.dir, '..', '..', 'src', 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const headSha = (cwd: string) => gitIn(cwd, 'rev-parse', 'HEAD').stdout.trim();

function freshRepo(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
  gitIn(root, 'init', '-q', '-b', 'main');
  gitIn(root, 'config', 'user.email', 't@t.co');
  gitIn(root, 'config', 'user.name', 'Tess');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  gitIn(root, 'add', 'README.md');
  gitIn(root, 'commit', '-q', '-m', 'initial');
  expect(ztrackIn(root, ['init', '--team', 'ZT', '--preset', 'simple-gh-sdlc']).code).toBe(0);
  return root;
}

function commitFile(root: string, name: string, contents: string, message: string): string {
  writeFileSync(join(root, name), contents);
  gitIn(root, 'add', name);
  gitIn(root, 'commit', '-q', '-m', message);
  return headSha(root);
}

function issueBody(prBranch: string, evidenceCommit: string): string {
  return [
    '# Multi-commit evidence', '', 'Summary: an honest multi-commit evidence trail.',
    `PR: ${prBranch}`, '',
    '## Acceptance Criteria', '',
    '- [x] dev/01 v1 does the thing', '  - status: passed',
    `  - evidence ev1: commit=${evidenceCommit} acv=1`,
    '  - proof: "ev1 shows it" -> ev1', '',
  ].join('\n');
}

function createIssue(root: string, title: string, body: string): string {
  const bodyFile = join(root, `${title.replace(/\s+/g, '-')}.md`);
  writeFileSync(bodyFile, body);
  const created = ztrackIn(root, ['issue', 'create', '--title', title, '--state', 'in-review', '--assignee', 'me', '--body-file', bodyFile]);
  expect(created.code).toBe(0);
  return (JSON.parse(created.out) as { identifier: string }).identifier;
}

describe('evidence_sha_stale accepts an ancestor of the PR head, not just an equal sha (Z2)', () => {
  test('an EARLIER commit on the PR branch (ancestor of head) passes — no evidence_sha_stale', () => {
    const root = freshRepo('ztrk-sha-ancestor-');
    try {
      gitIn(root, 'checkout', '-q', '-b', 'feat/multi-commit');
      const baseline = commitFile(root, 'a.txt', 'baseline\n', 'bk/01 baseline'); // the evidence commit
      commitFile(root, 'b.txt', 'impl\n', 'dev/01 implementation'); // moves the branch head forward
      const head = headSha(root);
      expect(head).not.toBe(baseline); // sanity: head has moved past the evidence commit
      gitIn(root, 'checkout', '-q', 'main');

      const id = createIssue(root, 'Ancestor OK', issueBody('feat/multi-commit', baseline));
      const r = ztrackIn(root, ['check', id, '--json']);
      expect(r.code).toBe(0);
      const payload = JSON.parse(r.out) as { ok: boolean; findings: Array<{ code: string }> };
      expect(payload.ok).toBe(true);
      expect(payload.findings.some((f) => f.code === 'evidence_sha_stale')).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  test('a commit NOT on the PR branch\'s history fires evidence_sha_stale', () => {
    const root = freshRepo('ztrk-sha-not-ancestor-');
    try {
      // a sibling branch off main, never merged into feat/off-branch — its tip is a REAL commit
      // that exists in the repo (so evidence_commit_not_found does not fire instead) but is not
      // reachable from the PR branch's head.
      gitIn(root, 'checkout', '-q', '-b', 'unrelated/other');
      const offBranch = commitFile(root, 'z.txt', 'off\n', 'unrelated work');
      gitIn(root, 'checkout', '-q', 'main');
      gitIn(root, 'checkout', '-q', '-b', 'feat/off-branch');
      commitFile(root, 'y.txt', 'impl\n', 'dev/01 implementation');
      gitIn(root, 'checkout', '-q', 'main');

      const id = createIssue(root, 'Not Ancestor', issueBody('feat/off-branch', offBranch));
      const r = ztrackIn(root, ['check', id, '--json']);
      expect(r.code).not.toBe(0);
      const payload = JSON.parse(r.out) as { ok: boolean; findings: Array<{ code: string; issueId?: string }> };
      expect(payload.ok).toBe(false);
      expect(payload.findings.some((f) => f.code === 'evidence_sha_stale' && f.issueId === id)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  test('a fabricated (unreachable/nonexistent) sha still fails — as evidence_commit_not_found, not silently ancestor-accepted', () => {
    const root = freshRepo('ztrk-sha-fabricated-');
    try {
      gitIn(root, 'checkout', '-q', '-b', 'feat/fabricated');
      commitFile(root, 'a.txt', 'impl\n', 'dev/01 implementation');
      gitIn(root, 'checkout', '-q', 'main');

      const FABRICATED = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'; // 40-hex, never a real commit
      const id = createIssue(root, 'Fabricated', issueBody('feat/fabricated', FABRICATED));
      const r = ztrackIn(root, ['check', id, '--json']);
      expect(r.code).not.toBe(0);
      const payload = JSON.parse(r.out) as { ok: boolean; findings: Array<{ code: string; issueId?: string }> };
      expect(payload.ok).toBe(false);
      // a nonexistent commit is caught by evidence_commit_not_found (checked first); the ancestry
      // check independently also fails closed on it (isAncestorOfPrHead's catch branch) — either
      // way this must never be silently accepted.
      expect(payload.findings.some((f) => f.code === 'evidence_commit_not_found' && f.issueId === id)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});
