// What `sync jira` keeps locally, beside the GitHub provider's (.volter/sync/): which ztrack issue IS which ticket
// (identity, not linking), the last synced common ancestor of each ticket's fields (the reconcile base), and the
// ticket comments already brought onto the board, so a comment is added once.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { syncStateDir } from '../../config.ts';

export type JiraFields = { title?: string; body?: string; status?: string };
export type JiraStore = {
  site: string;
  byZtrack: Record<string, string>;            // ztrack id -> ticket key
  byKey: Record<string, string>;               // ticket key -> ztrack id
  base: Record<string, JiraFields>;            // ticket key -> fields at the last sync (Jira's status name)
  comments: Record<string, string[]>;          // ticket key -> comment ids already on the board
};

const storePath = (projectRoot: string) => join(syncStateDir(projectRoot), 'jira.json');

export function loadStore(projectRoot: string, site: string): JiraStore {
  const p = storePath(projectRoot);
  if (existsSync(p)) {
    try {
      const d = JSON.parse(readFileSync(p, 'utf8')) as Partial<JiraStore>;
      if (d.site === site && d.byZtrack && d.byKey) return { base: {}, comments: {}, ...d } as JiraStore;
    } catch { /* a fresh store */ }
  }
  return { site, byZtrack: {}, byKey: {}, base: {}, comments: {} };
}

export function saveStore(projectRoot: string, store: JiraStore): void {
  const p = storePath(projectRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(store, null, 2)}\n`);
}

export function bind(store: JiraStore, ztrackId: string, key: string): void {
  store.byZtrack[ztrackId] = key;
  store.byKey[key] = ztrackId;
}
