// Preset-agnostic git facts for a preset's `loadContext`. Given a repo and the PR
// branches a preset cares about, it builds the `Context.git` an SDLC's
// freshness/merge/commit-existence rules read:
//   existingCommits — every commit in the repo (withheld when verifyCommits===false)
//   prs[branch]     — { headSha = branch tip, merged = contained in main }
// Local PR model (no GitHub): an issue's `PR:` value is a git branch name. Which
// branches matter is the PRESET's call (it passes them in) — this module knows
// nothing about any preset's schema.

import { execFileSync } from 'node:child_process';
import type { Context } from './engine.ts';

export function git(repo: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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
  const existingCommits = git(repo, ['log', '--all', '--format=%H']).split('\n').filter(Boolean);
  return { git: { existingCommits, prs } };
}
