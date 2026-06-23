// The identity binding: which ztrack issue IS which GitHub issue. Stored at
// .volter/sync/github.json. A synced issue is the GitHub issue (identity, not linking), so we
// persist the ztrack-id <-> GitHub-issue-number correspondence per repo. The map is the only
// state two-way sync needs locally (the issue content itself lives in the tracker + GitHub).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type GithubBindings = {
  repo: string;                          // owner/repo this binding set is for
  byZtrack: Record<string, number>;      // ztrack issue id  -> GitHub issue number
  byNumber: Record<string, string>;      // GitHub issue number -> ztrack issue id
};

function storePath(projectRoot: string): string {
  return join(projectRoot, '.volter', 'sync', 'github.json');
}

export function loadBindings(projectRoot: string, repo: string): GithubBindings {
  const p = storePath(projectRoot);
  if (existsSync(p)) {
    try {
      const d = JSON.parse(readFileSync(p, 'utf8')) as Partial<GithubBindings>;
      if (d.repo === repo && d.byZtrack && d.byNumber) return d as GithubBindings;
    } catch { /* fall through to a fresh binding set */ }
  }
  return { repo, byZtrack: {}, byNumber: {} };
}

export function saveBindings(projectRoot: string, b: GithubBindings): void {
  const p = storePath(projectRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(b, null, 2)}\n`);
}

export function bind(b: GithubBindings, ztrackId: string, number: number): void {
  b.byZtrack[ztrackId] = number;
  b.byNumber[String(number)] = ztrackId;
}
