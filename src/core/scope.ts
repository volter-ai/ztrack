// Auto-scope: derive the "active issue" for a check from the git context (the
// branch or worktree name) so a Stop-hook gate blocks only on the issue THIS
// checkout is for — not the whole tracker. The point is composition: drop the
// same hook into N worktrees and each scopes itself, with no shared marker state.
//
// PURE by construction: the impure git reads happen at the CLI boundary (it owns
// gitWorld's `git()`), and the resulting strings are passed in here. This file
// does no I/O, so the resolution is a unit-testable function of its inputs.

import type { Finding } from './engine.ts';

export interface ScopeSignals {
  explicit?: string;   // an issue id pinned by the caller (ZTRACK_ACTIVE_ISSUE / the loop); wins over git
  branch?: string;     // current branch — `git rev-parse --abbrev-ref HEAD`
  worktree?: string;   // basename of the worktree root
  issueIds: string[];  // ids present in the loaded tracker
}

export interface ScopeResolution {
  issueId: string | null;
  reason: string;      // human-readable why, for the scope banner / debugging
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// An id "appears in" a name only on alphanumeric boundaries, so `ZT-4` does NOT
// match `ZT-42-foo` (the trailing `2` is a boundary failure) — boundary matching,
// not substring. Case-insensitive so the common lowercased branch (`zt-42-fix`)
// still resolves `ZT-42`.
function idInName(name: string, id: string): boolean {
  if (!id) return false;
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(id)}([^A-Za-z0-9]|$)`, 'i').test(name);
}

function matchName(name: string, issueIds: string[]): string[] {
  return [...new Set(issueIds)].filter((id) => idInName(name, id));
}

/** Resolve the active issue from git signals. Precedence: branch, then worktree.
 *  Zero matches → null (the caller fails closed and gates the whole tracker).
 *  Two distinct ids in one name → ambiguous → null: never guess the scope. */
export function resolveActiveIssue(signals: ScopeSignals): ScopeResolution {
  // An explicitly pinned issue (e.g. the loop's armed issue) wins over git resolution;
  // an unknown pin fails closed rather than silently falling back to the branch.
  if (signals.explicit) {
    return signals.issueIds.includes(signals.explicit)
      ? { issueId: signals.explicit, reason: `pinned to ${signals.explicit}` }
      : { issueId: null, reason: `pinned issue '${signals.explicit}' is not in the tracker` };
  }
  const sources: Array<readonly [string, string | undefined]> = [
    ['branch', signals.branch],
    ['worktree', signals.worktree],
  ];
  for (const [label, name] of sources) {
    if (!name) continue;
    const matched = matchName(name, signals.issueIds);
    if (matched.length === 1) return { issueId: matched[0]!, reason: `matched ${matched[0]} in ${label} '${name}'` };
    if (matched.length > 1) return { issueId: null, reason: `ambiguous: ${label} '${name}' matches ${matched.join(', ')}` };
  }
  const where = sources.filter(([, n]) => n).map(([l, n]) => `${l} '${n}'`).join(' / ') || 'git context';
  return { issueId: null, reason: `no issue id found in ${where}` };
}

export interface FindingPartition {
  blocking: Finding[];
  informational: Finding[];
}

/** Split findings for a scoped gate. With an active issue, only that issue's
 *  findings — plus workspace-level findings that carry no issueId (e.g. a parse
 *  failure) — gate the turn; everything else is informational. With no active
 *  issue, fail closed: every finding gates. */
export function partitionFindings(findings: Finding[], activeId: string | null): FindingPartition {
  if (!activeId) return { blocking: findings, informational: [] };
  const blocking: Finding[] = [];
  const informational: Finding[] = [];
  for (const f of findings) {
    if (!f.issueId || f.issueId === activeId) blocking.push(f);
    else informational.push(f);
  }
  return { blocking, informational };
}
