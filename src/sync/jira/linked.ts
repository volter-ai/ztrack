// The permanent link (`sync: { provider: 'jira', site, jql, statuses?, create?, policy? }` in tracker-config, set by
// `ztrack init --sync jira --site <url> --jql <jql>`), resolved into the provider's options.
import { loadTrackerConfig } from '../../config.ts';
import { createTrackerClient } from '../../sdk.ts';
import type { ReconcilePolicy } from '../github/reconcile.ts';
import { resolveJiraExecute } from './execute.ts';
import { DEFAULT_STATUSES, type StatusTable } from './map.ts';
import { syncJira, type JiraSyncResult } from './sync.ts';

export type JiraLink = { site: string; jql: string; statuses: StatusTable; create: boolean; people: boolean; policy: ReconcilePolicy };

export function linkedJira(projectRoot: string): JiraLink | null {
  try {
    const sync = loadTrackerConfig(projectRoot).sync;
    if (sync?.provider !== 'jira') return null;
    return { site: sync.site, jql: sync.jql, statuses: sync.statuses ?? DEFAULT_STATUSES, create: sync.create ?? false, people: sync.people ?? false, policy: sync.policy ?? 'merge' };
  } catch { return null; }
}

/** Sync the linked site in the directions asked; null when the project has no Jira link. */
export async function syncLinkedJira(projectRoot: string, dir: { pull?: boolean; push?: boolean } = { pull: true, push: true }): Promise<JiraSyncResult | null> {
  const link = linkedJira(projectRoot);
  if (!link) return null;
  return syncJira({ projectRoot, site: link.site, jql: link.jql, statuses: link.statuses, create: link.create, people: link.people, execute: resolveJiraExecute(link.site), client: createTrackerClient({ projectRoot }) }, link.policy, dir);
}
