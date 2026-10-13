// Preset-agnostic git facts for a preset's `loadContext`. Given a repo and the PR
// branches a preset cares about, it builds the `Context.git` an SDLC's
// freshness/merge/commit-existence rules read:
//   existingCommits — every commit in the repo (withheld when verifyCommits===false)
//   prs[branch]     — { headSha = branch tip, merged = contained in main }
// Local PR model (no GitHub): an issue's `PR:` value is a git branch name. Which
// branches matter is the PRESET's call (it passes them in) — this module knows
// nothing about any preset's schema.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from './engine.ts';

// execFileSync's default maxBuffer is 1 MiB — a busy repo's `git log --all --format=%H`
// blows past that at ~26k commits (40 hex chars + newline each) and throws ENOBUFS,
// which the swallow-into-'' path below then turned into an EMPTY existingCommits list:
// every cited commit in the whole org failed *_commit_not_found at once. Commit lists
// are ~41 bytes/commit, so 512 MiB covers ~13M commits.
const MAX_GIT_BUFFER = 512 * 1024 * 1024;

export function git(repo: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_GIT_BUFFER }).trim();
  } catch {
    return '';
  }
}

/** Does `path` exist (as a blob) at `commit` in `repo`? `git cat-file -e <commit>:<path>` exits 0
 *  when the object exists — so a cited evidence file can be verified to actually be in the tree at
 *  the commit it claims, from any worktree that has the commit (the tree is checkout-independent). */
export function gitFileExistsAtCommit(repo: string, commit: string, path: string): boolean {
  try {
    execFileSync('git', ['-C', repo, 'cat-file', '-e', `${commit}:${path}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** The repo-relative paths a commit changed (its diff vs. its first parent; root commit = all
 *  files added). Lets a preset check that a cited commit actually TOUCHES the area an AC claims —
 *  a deterministic partial close of the relevance gap (an unrelated commit touches none of them). */
export function gitCommitFiles(repo: string, commit: string): string[] {
  const out = git(repo, ['show', '--no-renames', '--pretty=format:', '--name-only', commit]);
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

// Filesystem check, NOT a subprocess spawn. `git log --all`'s failure handler used to
// fall back to `git rev-parse --git-dir` to tell "not a repo" (safe: empty list) apart
// from "real repo, scan failed" (safe: withhold existingCommits) — but that fallback is
// ALSO a subprocess spawn, so under the exact host-CPU/process-spawn pressure that makes
// `git log --all` fail transiently, the fallback can fail too, misclassifying "the host
// is thrashing" as "there is no repo here" — mass-failing every *_commit_not_found
// citation in the org at once even though the cited commits are real (PH-386). A plain
// stat is essentially immune to that pressure, so use it as the oracle instead.
function isGitRepo(repo: string): boolean {
  if (existsSync(join(repo, '.git'))) return true; // regular repo (dir) or worktree (file)
  try { return existsSync(join(repo, 'HEAD')) && existsSync(join(repo, 'objects')); } catch { return false; } // bare repo
}

export function gitWorld(repo: string, prBranches: string[], opts: { verifyCommits?: boolean } = {}): Context {
  const prs: Record<string, { headSha?: string; merged?: boolean }> = {};
  for (const branch of prBranches) {
    const headSha = git(repo, ['rev-parse', '--verify', `${branch}^{commit}`]) || undefined;
    let merged = false;
    if (headSha) {
      try {
        execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', headSha, 'main'], { stdio: 'ignore' });
        merged = true;
      } catch { merged = false; }
    }
    prs[branch] = { ...(headSha ? { headSha } : {}), merged };
  }
  // verifyCommits===false withholds commit existence so commit-verification rules
  // skip (the typed replacement for the old `--verify-commits` opt-in).
  if (opts.verifyCommits === false) return { git: { prs } };
  let existingCommits: string[];
  try {
    existingCommits = execFileSync('git', ['-C', repo, 'log', '--all', '--format=%H'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_GIT_BUFFER,
    }).trim().split('\n').filter(Boolean);
  } catch (err) {
    // Two very different failures land here, with opposite correct handling:
    // - Not a git repo at all: every commit citation is unverifiable BY CONSTRUCTION,
    //   so keep the empty list — commit rules stay RED on fabricated citations
    //   (document trackers outside any repo rely on this).
    // - A real repo whose scan FAILED (ENOBUFS is already guarded against above by
    //   MAX_GIT_BUFFER, so this is any OTHER transient git/subprocess breakage —
    //   host CPU/process-spawn pressure, git itself crashing, etc.): silently
    //   withholding existingCommits here would make commit rules skip with no
    //   visible signal, run after run, for as long as the host stays under load —
    //   PH-386's false `*_commit_not_found` class. Fail loudly instead: surface
    //   the problem so it gets investigated rather than silently degrading forever.
    if (!isGitRepo(repo)) {
      existingCommits = [];
    } else {
      throw new Error(
        `gitWorld: 'git log --all' failed against a real repo at ${repo} — refusing to ` +
        `silently degrade existingCommits (that would mass-fail every real commit citation ` +
        `as *_commit_not_found). Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { git: { existingCommits, prs } };
}
