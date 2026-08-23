import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, gitWorld } from './gitWorld.ts';

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'ztrack-gitworld-'));
  const run = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
  run(['init', '-b', 'main']);
  run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'one']);
  run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'two']);
  return repo;
}

describe('gitWorld', () => {
  test('existingCommits carries every commit of a real repo', () => {
    const repo = makeRepo();
    const ctx = gitWorld(repo, []);
    expect(ctx.git?.existingCommits?.length).toBe(2);
  });

  test('a NON-repo keeps the empty list — fabricated citations stay catchable', () => {
    // Outside any git repo, no commit citation is verifiable by construction, so
    // commit rules must stay RED on fabricated commits (document trackers outside
    // a repo rely on this — see cliCheckTargets' deadbeef cases).
    const ctx = gitWorld(join(tmpdir(), 'ztrack-definitely-not-a-repo'), []);
    expect(ctx.git?.existingCommits).toEqual([]);
    expect(ctx.git?.prs).toEqual({});
  });

  test('git() survives output beyond the 1 MiB execFileSync default maxBuffer', () => {
    // Regression: a busy repo's `git log --all --format=%H` is >1 MiB at ~26k commits;
    // the default maxBuffer threw ENOBUFS and git() swallowed it into ''. A single
    // commit whose message is 2 MiB makes real `git log` output exceed the old cap.
    const repo = mkdtempSync(join(tmpdir(), 'ztrack-gitworld-big-'));
    const msg = join(repo, 'msg.txt');
    writeFileSync(msg, `big\n\n${'a'.repeat(2 * 1024 * 1024)}\n`);
    const run = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    run(['init', '-b', 'main']);
    run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-F', msg]);
    const out = git(repo, ['log', '--format=%B']);
    expect(out.length).toBeGreaterThan(2 * 1024 * 1024);
  });

  test('PH-386: a real repo whose `git log --all` scan fails throws loudly — never silently mass-fails every commit citation', () => {
    // Regression for the false peak_dev_ac_commit_not_found / peak_evidence_commit_not_found
    // class: gitWorld used to distinguish "not a repo" (safe: empty existingCommits) from
    // "real repo, transient scan failure" (safe: withhold existingCommits) using a SECOND
    // subprocess spawn (`git rev-parse --git-dir`) as the oracle. Under the exact host
    // CPU/process-spawn pressure that makes the primary `git log --all` scan fail, that
    // second spawn can fail too — misclassifying "the host is thrashing" as "there is no
    // repo here", which took the EMPTY-list branch and mass-failed every real commit
    // citation in the org at once. Simulate a real-repo scan failure (corrupt the object
    // database so `git log --all` exits non-zero while `.git/` still exists) and assert
    // gitWorld throws instead of silently returning an empty/withheld commit list.
    const repo = makeRepo();
    rmSync(join(repo, '.git', 'objects'), { recursive: true, force: true });
    expect(() => gitWorld(repo, [])).toThrow(/git log --all.*failed against a real repo/);
  });

  test('a NON-repo still keeps the empty list even though isGitRepo() is now fs-based', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztrack-gitworld-notrepo-'));
    const ctx = gitWorld(dir, []);
    expect(ctx.git?.existingCommits).toEqual([]);
  });
});
