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

export function gitWorld(repo: string, prBranches: string[], opts: { verifyCommits?: boolean } = {}): Context {
  const currentSha = git(repo, ['rev-parse', 'HEAD']) || undefined; // freshness anchor for waivers
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
  if (opts.verifyCommits === false) return { git: { ...(currentSha ? { currentSha } : {}), prs } };
  const existingCommits = git(repo, ['log', '--all', '--format=%H']).split('\n').filter(Boolean);
  return { git: { ...(currentSha ? { currentSha } : {}), existingCommits, prs } };
}
