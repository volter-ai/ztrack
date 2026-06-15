// The git-world context provider, shared by the CLI and the board. Builds the
// injected `Context` for the default preset from a real repo:
//   existingCommits — every commit in the repo
//   prs[branch]     — { headSha = branch tip, merged = contained in main }
// Local PR model (no GitHub): an issue's `PR:` value is a git branch name.

import { execFileSync } from 'node:child_process';
import { parseDefault, DefaultRootSchema } from '../presets/default.ts';
import type { Context } from './engine.ts';

export function git(repo: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function gitWorld(repo: string, prBranches: string[]): Context {
  const existingCommits = git(repo, ['log', '--all', '--format=%H']).split('\n').filter(Boolean);
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
  return { git: { existingCommits, prs } };
}

export function prBranchesFrom(markdown: string): string[] {
  const parsed = DefaultRootSchema.safeParse(parseDefault(markdown));
  if (!parsed.success) return [];
  return parsed.data.issues.map((i) => i.pr?.url).filter((u): u is string => !!u);
}
