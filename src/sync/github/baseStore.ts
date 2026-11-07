// The reconciliation BASE — the last-synced common ancestor per issue, the third input the
// twin's three-way `reconcile` needs (base = value at last sync, fork = tracker now, real =
// GitHub now). Without it, reconcile can't tell WHO changed a field, so a concurrent edit on
// one side silently clobbers the other. The fork lives in ztrack's markdown tracker (not the
// twin), so ztrack owns this snapshot. Stored next to the identity bindings, keyed by the
// GitHub resource id (`owner/repo#issue:N`).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { syncStateDir } from '../../config.ts';

export type BaseFields = { title?: string; body?: string; state?: string };
export type GithubBase = { repo: string; resources: Record<string, BaseFields> };

const basePath = (projectRoot: string): string => join(syncStateDir(projectRoot), 'github-base.json');

export function loadBase(projectRoot: string, repo: string): GithubBase {
  const p = basePath(projectRoot);
  if (existsSync(p)) {
    try {
      const d = JSON.parse(readFileSync(p, 'utf8')) as Partial<GithubBase>;
      if (d.repo === repo && d.resources) return d as GithubBase;
    } catch { /* fall through to an empty base */ }
  }
  return { repo, resources: {} };
}

export function saveBase(projectRoot: string, base: GithubBase): void {
  const p = basePath(projectRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(base, null, 2)}\n`);
}
