import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

  test('a failing existence scan WITHHOLDS existingCommits instead of returning an empty list', () => {
    // Regression: `git log --all` failure (e.g. ENOBUFS on a large repo) used to be
    // swallowed into '' → existingCommits: [] → every cited commit in the org failed
    // *_commit_not_found at once. Failure must degrade like verifyCommits === false.
    const ctx = gitWorld(join(tmpdir(), 'ztrack-definitely-not-a-repo'), []);
    expect(ctx.git?.existingCommits).toBeUndefined();
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
});
