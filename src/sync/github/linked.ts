// `syncLinked` — drive the provider from the PERMANENT link in tracker-config (`sync: { provider,
// repo }`, set by `ztrack init --sync github --repo o/n`). It resolves the repo + executor +
// tracker client from config so callers (init, the `sync` command, user-facing check/loop) need
// only say which direction(s). Best-effort by contract: callers wrap it so a sync failure (offline,
// auth) never breaks the underlying command — ztrack must keep working without the network.
import { loadTrackerConfig } from '../../config.ts';
import { createTrackerClient } from '../../sdk.ts';
import type { ReconcilePolicy } from '@volter-ai-dev/twin';
import { resolveGithubExecute } from './execute.ts';
import { pull, push, reconcileSync } from './sync.ts';

/** The linked repo as `owner/name`, or null if this project has no github link. */
export function linkedRepo(projectRoot: string): string | null {
  try {
    const sync = loadTrackerConfig(projectRoot).sync;
    return sync?.provider === 'github' && sync.repo ? sync.repo : null;
  } catch { return null; }
}

/** The configured reconcile policy for the link (default `merge`). */
export function linkedPolicy(projectRoot: string): ReconcilePolicy {
  try { return loadTrackerConfig(projectRoot).sync?.policy ?? 'merge'; } catch { return 'merge'; }
}

/** Pull and/or push the linked GitHub repo. No-op when the project has no github link. */
export async function syncLinked(projectRoot: string, dir: { pull?: boolean; push?: boolean }): Promise<void> {
  const repo = linkedRepo(projectRoot);
  if (!repo) return;
  const [owner, name] = repo.split('/');
  if (!owner || !name) return;
  const o = { projectRoot, owner, repo: name, execute: resolveGithubExecute(), client: createTrackerClient({ projectRoot }), occurredAt: new Date().toISOString() };
  // Both directions → the three-way reconcile (conflict-aware). A single direction → one-way.
  if (dir.pull && dir.push) await reconcileSync(o, linkedPolicy(projectRoot));
  else if (dir.pull) await pull(o);
  else if (dir.push) await push(o);
}
