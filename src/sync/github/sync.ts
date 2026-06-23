// Two-way GitHub issue sync driven through the twin's EVENT-SOURCED engine — never a full
// read + full rewrite. PULL ingests real GitHub incrementally via the cursor connector
// (`runConnectorPoll` over githubIssueConnector — a `since` poll that reads only issues changed
// past the persisted cursor, closed ones included), then writes to the tracker ONLY the issues
// whose folded twin resource actually differs from the local issue. PUSH morphs the twin with
// `applyGithubWrite` (one pending LOCAL action per genuinely-changed issue) and then
// `pushPendingGithubActions` flushes those pending actions to real GitHub through the egress
// idempotency ledger — a re-push of an already-confirmed action calls the GitHub API ZERO
// times, so an unchanged issue is never re-PATCHed. The identity binding ties each ztrack id to
// the GitHub issue number it IS. v1 conflict policy is GitHub-wins (pull precedes push in a
// full `sync`). The twin's per-repo state + poll cursor live under <projectRoot>/.volter, so the
// observed log persists between runs — that is what makes the read incremental, not a cold scan.
import { applyGithubWrite, pushPendingGithubActions, type GithubExecute } from '@volter-ai-dev/twin-github';
import { currentResources, pendingActions, runConnectorPoll } from '@volter-ai-dev/twin';
import { githubIssueConnector } from './connector.ts';
import type { TrackerClient } from '../../types.ts';
import { issueResourceToRecordFields, statusToGithubState } from './map.ts';
import { loadBindings, saveBindings, bind } from './bindings.ts';

export type SyncOpts = { projectRoot: string; owner: string; repo: string; execute: GithubExecute; client: TrackerClient; occurredAt: string };
export type PullResult = { created: string[]; updated: string[]; total: number };
export type PushResult = { created: Array<{ ztrack: string; number: number }>; updated: string[]; total: number };

// PUSH-side egress timestamp. The pull no longer needs a stable sentinel (the cursor connector
// shadow-diffs on real `updated_at`, so re-observing identical content is a genuine no-op). The
// push's local write-actions + their confirm events still take an occurredAt; a STABLE constant
// keeps re-confirming the same content idempotent (the egress ledger keys on the action, and a
// constant avoids minting a "new observation at a new time" that would conflict on a later poll).
const OBSERVED_AT = '2020-01-01T00:00:00.000Z';

// the tracker 'state'/'status' may arrive as a string or a nested { name }.
function stateName(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return String((v as { name?: unknown }).name ?? '');
  return '';
}

// One folded issue resource as currentResources('github') returns it: the FLAT TwinResource
// shape ({id, type, updatedAt, ...fields}), not the nested {fields} of a SyncResource.
type IssueResource = { id: string; number: number; title?: string; body?: string; state?: string };
function issueResources(projectRoot: string): IssueResource[] {
  const opt = (v: unknown) => (v == null ? undefined : String(v));
  return (currentResources('github', projectRoot) as Array<Record<string, unknown>>)
    .filter((r) => r.type === 'issue')
    .map((r) => ({ id: String(r.id), number: Number(r.number), title: opt(r.title), body: opt(r.body), state: opt(r.state) }));
}
// Re-wrap a flat issue resource as the {type,id,fields} SyncResource shape that
// issueResourceToRecordFields (the github<->ztrack field mapper) expects.
const asSyncResource = (r: IssueResource) => ({ type: 'issue', id: r.id, fields: { title: r.title, body: r.body, state: r.state } });

/** PULL: fold real GitHub into the twin (deltas only), then write to the tracker only the
 *  issues whose folded resource differs from the bound local issue (or create + bind new ones). */
export async function pull(o: SyncOpts): Promise<PullResult> {
  const repo = `${o.owner}/${o.repo}`;
  const b = loadBindings(o.projectRoot, repo);
  await runConnectorPoll(githubIssueConnector(o.execute, o.owner, o.repo), { root: o.projectRoot });
  const resources = issueResources(o.projectRoot);
  const created: string[] = [];
  const updated: string[] = [];
  for (const res of resources) {
    const boundId = b.byNumber[String(res.number)];
    if (boundId) {
      const cur = await o.client.issue.view(boundId, { json: 'title,body,state' }) as Record<string, unknown>;
      const f = issueResourceToRecordFields(asSyncResource(res), stateName(cur.state));
      // Only write when the tracker issue actually differs — no full rewrite.
      const same = String(cur.title ?? '') === (f.title ?? '') && String(cur.body ?? '') === (f.body ?? '') && stateName(cur.state) === f.status;
      if (!same) {
        await o.client.issue.edit(boundId, { title: f.title, body: f.body, state: f.status });
        updated.push(boundId);
      }
    } else {
      const f = issueResourceToRecordFields(asSyncResource(res));
      const r = await o.client.issue.create({ title: f.title || `GitHub issue #${res.number}`, body: f.body, state: f.status }) as Record<string, unknown>;
      const ztrackId = String(r.identifier ?? '');
      if (ztrackId) { bind(b, ztrackId, res.number); created.push(ztrackId); }
    }
  }
  saveBindings(o.projectRoot, b);
  return { created, updated, total: resources.length };
}

/** PUSH: morph the twin (one pending action per genuinely-changed tracker issue), then flush
 *  pending actions to real GitHub through the idempotent egress ledger. Unchanged issues
 *  produce no pending action and so are never re-PATCHed; a re-push replays nothing. */
export async function push(o: SyncOpts): Promise<PushResult> {
  const repo = `${o.owner}/${o.repo}`;
  const b = loadBindings(o.projectRoot, repo);
  // Fold first so the twin's observed state is the change-detection baseline (idempotent: if a
  // full `sync` already pulled this run, this fold appends nothing).
  await runConnectorPoll(githubIssueConnector(o.execute, o.owner, o.repo), { root: o.projectRoot });
  const baseline = new Map(issueResources(o.projectRoot).map((r) => [r.number, r]));
  const rows = await o.client.issue.list({ state: 'all', limit: 5000, json: 'identifier,title,state,body' }) as Array<Record<string, unknown>>;
  const updated: string[] = [];
  // Map the pending CREATE action -> the ztrack issue that spawned it, so we can bind the real
  // GitHub number (externalIds, keyed by action id) and close it after push if the issue is done.
  const pendingCreate = new Map<string, { ztrack: string; closed: boolean }>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row.identifier ?? '');
    if (!id) continue;
    const title = String(row.title ?? '');
    const body = String(row.body ?? '');
    const ghState = statusToGithubState(stateName(row.state));
    const number = b.byZtrack[id];
    if (number) {
      const base = baseline.get(number);
      // Skip when the tracker issue already matches the twin's observed GitHub state.
      if (base && (base.title ?? '') === title && (base.body ?? '') === body && (base.state ?? 'open') === ghState) continue;
      await applyGithubWrite({ method: 'PATCH', path: `/repos/${o.owner}/${o.repo}/issues/${number}`, body: JSON.stringify({ title, body, state: ghState }), root: o.projectRoot, occurredAt: OBSERVED_AT });
      updated.push(id);
    } else {
      const before = new Set(pendingActions('github', o.projectRoot).map((a) => a.id));
      await applyGithubWrite({ method: 'POST', path: `/repos/${o.owner}/${o.repo}/issues`, body: JSON.stringify({ title, body }), root: o.projectRoot, occurredAt: OBSERVED_AT });
      const fresh = pendingActions('github', o.projectRoot).find((a) => !before.has(a.id));
      if (fresh) pendingCreate.set(fresh.id, { ztrack: id, closed: ghState === 'closed' });
    }
  }
  // Flush every pending local action to real GitHub (idempotent: confirmed actions never re-fire).
  const { externalIds } = await pushPendingGithubActions(o.execute, { root: o.projectRoot, occurredAt: OBSERVED_AT });
  const created: Array<{ ztrack: string; number: number }> = [];
  const closeAfter: number[] = [];
  for (const [actionId, info] of pendingCreate) {
    const num = Number(externalIds[actionId]);
    if (!num) continue;
    bind(b, info.ztrack, num);
    created.push({ ztrack: info.ztrack, number: num });
    if (info.closed) closeAfter.push(num); // issue.create always OPENS — close as a 2nd morph.
  }
  for (const num of closeAfter) {
    await applyGithubWrite({ method: 'PATCH', path: `/repos/${o.owner}/${o.repo}/issues/${num}`, body: JSON.stringify({ state: 'closed' }), root: o.projectRoot, occurredAt: OBSERVED_AT });
  }
  if (closeAfter.length) await pushPendingGithubActions(o.execute, { root: o.projectRoot, occurredAt: OBSERVED_AT });
  saveBindings(o.projectRoot, b);
  return { created, updated, total: Array.isArray(rows) ? rows.length : 0 };
}
