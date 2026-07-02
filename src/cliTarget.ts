// The unified check/loop TARGET — the one grammar both `ztrack check` and `ztrack loop`
// resolve a positional/contextual argument into. The same four shapes drive both commands:
//
//   <issue-id>      a tracker issue          e.g. `ztrack check ZT-1`   / `ztrack loop start ZT-1`
//   <file.md>       a loose markdown file    e.g. `ztrack check ./x.md`
//   (none, in a worktree that maps to an issue) -> auto-resolve from the branch/worktree name
//   (none, otherwise)                            -> the whole tracker
//
// File-vs-id is decided by shape (a path/`.md`/an existing file is a file; `ABC-123` is an id);
// an ambiguous bare token is rejected rather than silently ignored (the old footgun: a dropped
// positional made `check <x>` a false green).
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isIssueId } from './issueId.ts';

export type CheckTarget =
  | { kind: 'file'; path: string }
  | { kind: 'issues'; ids: string[] }
  | { kind: 'auto' }            // resolve the active issue from the git branch/worktree
  | { kind: 'all' };

export function looksLikeFile(token: string, cwd: string): boolean {
  return token.endsWith('.md') || token.includes('/') || token.includes('\\')
    || existsSync(isAbsolute(token) ? token : resolve(cwd, token));
}
export const looksLikeIssueId = isIssueId;

/** Pull the bare positional tokens out of an arg list, skipping flags and the values of
 *  flags that take one. Used to find a check/loop target among the flags. */
export function positionalArgs(args: string[], valueFlags: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--') && a.includes('=')) continue;       // --flag=value
    if (a.startsWith('-')) { if (valueFlags.has(a)) i++; continue; } // flag (+ skip its value)
    out.push(a);
  }
  return out;
}

/** Classify a check/loop invocation into a target. `inWorktreeIssue` is whether the current
 *  git branch/worktree resolves to a known issue (lets bare `check`/`loop` auto-scope). */
export function resolveTarget(opts: {
  positionals: string[];
  issuesFlag?: string[];        // explicit --issues a,b
  forceAuto?: boolean;          // explicit --auto-scope
  inWorktreeIssue?: boolean;
  cwd: string;
}): CheckTarget {
  const { positionals, issuesFlag, forceAuto, inWorktreeIssue, cwd } = opts;
  if (forceAuto) return { kind: 'auto' };
  if (positionals.length) {
    const files = positionals.filter((p) => looksLikeFile(p, cwd));
    if (files.length) {
      if (positionals.length > 1) throw new Error(`ztrack: check a single file at a time (got ${positionals.length} targets: ${positionals.join(', ')})`);
      return { kind: 'file', path: files[0]! };
    }
    const bad = positionals.filter((p) => !looksLikeIssueId(p));
    if (bad.length) throw new Error(`ztrack: '${bad[0]}' is neither an issue id (e.g. ZT-1) nor a markdown file. Did you mean a path ending in .md?`);
    return { kind: 'issues', ids: positionals };
  }
  if (issuesFlag?.length) return { kind: 'issues', ids: issuesFlag };
  if (inWorktreeIssue) return { kind: 'auto' };
  return { kind: 'all' };
}
