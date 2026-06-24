// Two-way GitHub issue sync over the twin's event-sourced engine.
//
// READ is incremental: `runConnectorPoll` over githubIssueConnector — a `since` cursor poll that
// reads only issues changed past the persisted cursor (closed ones included), never a full scan.
// WRITE is idempotent: `applyGithubWrite` morphs the twin (one pending action per changed issue)
// and `pushPendingGithubActions` flushes through the egress ledger, so an unchanged issue is
// never re-PATCHed. The identity binding ties each ztrack id to the GitHub issue number it IS.
//
// Directions:
//   pull(o)           one-way GitHub → tracker   (CLI `--pull`)
//   push(o)           one-way tracker → GitHub   (CLI `--push`)
//   reconcileSync(o)  bidirectional THREE-WAY merge (CLI default + auto-sync): per-field
//                     base/fork/real reconciliation, so a concurrent edit on one side does not
//                     clobber the other — non-overlapping field changes MERGE, only a same-field
//                     collision is a surfaced conflict (default policy `merge`). `base` (the last
//                     synced common ancestor) is persisted by ztrack since the fork is the tracker.
import { applyGithubWrite, pushPendingGithubActions, type GithubExecute } from '@volter-ai-dev/twin-github';
import { currentResources, pendingActions, reconcile, runConnectorPoll, type ReconcilePolicy, type TwinResource } from '@volter-ai-dev/twin';
import { githubIssueConnector } from './connector.ts';
import type { TrackerClient } from '../../types.ts';
import { githubStateToStatus, issueResourceToRecordFields, statusToGithubState } from './map.ts';
import { loadBindings, saveBindings, bind, type GithubBindings } from './bindings.ts';
import { loadBase, saveBase, type BaseFields } from './baseStore.ts';
import { loadConflicts, saveConflicts, stripConflictSection, withConflictSection, type ConflictRecord } from '../conflicts.ts';

export type SyncOpts = { projectRoot: string; owner: string; repo: string; execute: GithubExecute; client: TrackerClient; occurredAt: string };
export type PullResult = { created: string[]; updated: string[]; total: number };
export type PushResult = { created: Array<{ ztrack: string; number: number }>; updated: string[]; total: number };
export type ReconcileResult = { pulled: string[]; pushed: string[]; created: Array<{ ztrack: string; number: number }>; conflicts: Array<{ issue: string; number: number; fields: string[] }> };

// PUSH-side egress timestamp — a STABLE constant keeps re-confirming the same content idempotent
// (the egress ledger keys on the action; a constant avoids minting a re-observation that would
// conflict on a later poll). The pull no longer needs it (the cursor connector shadow-diffs).
const OBSERVED_AT = '2020-01-01T00:00:00.000Z';

// the tracker 'state'/'status' may arrive as a string or a nested { name }.
function stateName(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return String((v as { name?: unknown }).name ?? '');
  return '';
}

// One issue resource as currentResources('github') returns it: the FLAT TwinResource shape.
type IssueResource = { id: string; number: number; title?: string; body?: string; state?: string };
function issueResources(projectRoot: string): IssueResource[] {
  const opt = (v: unknown) => (v == null ? undefined : String(v));
  return (currentResources('github', projectRoot) as Array<Record<string, unknown>>)
    .filter((r) => r.type === 'issue')
    .map((r) => ({ id: String(r.id), number: Number(r.number), title: opt(r.title), body: opt(r.body), state: opt(r.state) }));
}
const asSyncResource = (r: IssueResource) => ({ type: 'issue', id: r.id, fields: { title: r.title, body: r.body, state: r.state } });

const numberOf = (id: string) => Number(id.split('#issue:').pop());

// --- shared CREATE flows (issues present on only one side; no conflict is possible) ---

/** Create a tracker issue for each unbound GitHub issue, recording the binding. */
async function createInTracker(o: SyncOpts, b: GithubBindings, real: IssueResource[]): Promise<Array<{ ztrack: string; number: number }>> {
  const out: Array<{ ztrack: string; number: number }> = [];
  for (const res of real) {
    if (b.byNumber[String(res.number)]) continue;
    const f = issueResourceToRecordFields(asSyncResource(res));
    const r = await o.client.issue.create({ title: f.title || `GitHub issue #${res.number}`, body: f.body, state: f.status }) as Record<string, unknown>;
    const ztrackId = String(r.identifier ?? '');
    if (ztrackId) { bind(b, ztrackId, res.number); out.push({ ztrack: ztrackId, number: res.number }); }
  }
  return out;
}

/** Create a GitHub issue for each unbound tracker issue, binding it to the real number the
 *  egress push returns (and closing it after if the local issue is done). */
async function createOnGithub(o: SyncOpts, b: GithubBindings, rows: Array<{ ztrack: string; title: string; body: string; closed: boolean }>): Promise<Array<{ ztrack: string; number: number }>> {
  const pendingCreate = new Map<string, { ztrack: string; closed: boolean }>();
  for (const row of rows) {
    const before = new Set(pendingActions('github', o.projectRoot).map((a) => a.id));
    await applyGithubWrite({ method: 'POST', path: `/repos/${o.owner}/${o.repo}/issues`, body: JSON.stringify({ title: row.title, body: row.body }), root: o.projectRoot, occurredAt: OBSERVED_AT });
    const fresh = pendingActions('github', o.projectRoot).find((a) => !before.has(a.id));
    if (fresh) pendingCreate.set(fresh.id, { ztrack: row.ztrack, closed: row.closed });
  }
  if (!pendingCreate.size) return [];
  const { externalIds } = await pushPendingGithubActions(o.execute, { root: o.projectRoot, occurredAt: OBSERVED_AT });
  const out: Array<{ ztrack: string; number: number }> = [];
  const closeAfter: number[] = [];
  for (const [actionId, info] of pendingCreate) {
    const num = Number(externalIds[actionId]);
    if (!num) continue;
    bind(b, info.ztrack, num);
    out.push({ ztrack: info.ztrack, number: num });
    if (info.closed) closeAfter.push(num); // issue.create always OPENS — close as a 2nd morph
  }
  for (const num of closeAfter) {
    await applyGithubWrite({ method: 'PATCH', path: `/repos/${o.owner}/${o.repo}/issues/${num}`, body: JSON.stringify({ state: 'closed' }), root: o.projectRoot, occurredAt: OBSERVED_AT });
  }
  if (closeAfter.length) await pushPendingGithubActions(o.execute, { root: o.projectRoot, occurredAt: OBSERVED_AT });
  return out;
}

const unboundForkRows = (rows: Array<Record<string, unknown>>, b: GithubBindings) =>
  rows.map((row) => ({ id: String(row.identifier ?? ''), title: String(row.title ?? ''), body: stripConflictSection(String(row.body ?? '')), ghState: statusToGithubState(stateName(row.state)) }))
    .filter((r) => r.id && !b.byZtrack[r.id])
    .map((r) => ({ ztrack: r.id, title: r.title, body: r.body, closed: r.ghState === 'closed' }));

/** PULL: incremental fold, then write to the tracker only the issues that differ (or create new). */
export async function pull(o: SyncOpts): Promise<PullResult> {
  const repoKey = `${o.owner}/${o.repo}`;
  const b = loadBindings(o.projectRoot, repoKey);
  await runConnectorPoll(githubIssueConnector(o.execute, o.owner, o.repo), { root: o.projectRoot });
  const resources = issueResources(o.projectRoot);
  const updated: string[] = [];
  for (const res of resources) {
    const boundId = b.byNumber[String(res.number)];
    if (!boundId) continue;
    const cur = await o.client.issue.view(boundId, { json: 'title,body,state' }) as Record<string, unknown>;
    const f = issueResourceToRecordFields(asSyncResource(res), stateName(cur.state));
    const same = String(cur.title ?? '') === (f.title ?? '') && stripConflictSection(String(cur.body ?? '')) === (f.body ?? '') && stateName(cur.state) === f.status;
    if (!same) { await o.client.issue.edit(boundId, { title: f.title, body: f.body, state: f.status }); updated.push(boundId); }
  }
  const created = await createInTracker(o, b, resources);
  saveBindings(o.projectRoot, b);
  // Seed the reconcile base: a pull makes the tracker agree with GitHub, so THIS is the common
  // ancestor. Without it, the first bidirectional `sync` after `init --sync` sees base=∅, treats
  // a locally-developed issue as a both-sides change, and refuses to push it (phantom conflict).
  const base = loadBase(o.projectRoot, repoKey);
  for (const res of resources) {
    base.resources[`${repoKey}#issue:${res.number}`] = { ...(res.title !== undefined ? { title: res.title } : {}), ...(res.body !== undefined ? { body: res.body } : {}), state: res.state ?? 'open' };
  }
  saveBase(o.projectRoot, base);
  return { created: created.map((c) => c.ztrack), updated, total: resources.length };
}

/** PUSH: morph the twin for each changed/new tracker issue, then idempotent egress to GitHub. */
export async function push(o: SyncOpts): Promise<PushResult> {
  const repoKey = `${o.owner}/${o.repo}`;
  const b = loadBindings(o.projectRoot, repoKey);
  await runConnectorPoll(githubIssueConnector(o.execute, o.owner, o.repo), { root: o.projectRoot });
  const baseline = new Map(issueResources(o.projectRoot).map((r) => [r.number, r]));
  const rows = await o.client.issue.list({ state: 'all', limit: 5000, json: 'identifier,title,state,body' }) as Array<Record<string, unknown>>;
  const list = Array.isArray(rows) ? rows : [];
  const updated: string[] = [];
  for (const row of list) {
    const id = String(row.identifier ?? '');
    const number = id ? b.byZtrack[id] : undefined;
    if (!number) continue;
    const title = String(row.title ?? '');
    const body = stripConflictSection(String(row.body ?? ''));
    const ghState = statusToGithubState(stateName(row.state));
    const base = baseline.get(number);
    if (base && (base.title ?? '') === title && (base.body ?? '') === body && (base.state ?? 'open') === ghState) continue;
    await applyGithubWrite({ method: 'PATCH', path: `/repos/${o.owner}/${o.repo}/issues/${number}`, body: JSON.stringify({ title, body, state: ghState }), root: o.projectRoot, occurredAt: OBSERVED_AT });
    updated.push(id);
  }
  if (updated.length) await pushPendingGithubActions(o.execute, { root: o.projectRoot, occurredAt: OBSERVED_AT });
  const created = await createOnGithub(o, b, unboundForkRows(list, b));
  saveBindings(o.projectRoot, b);
  return { created, updated, total: list.length };
}

// project to a TwinResource carrying only the reconciled fields (state in GitHub vocabulary).
const SYNCED: Array<keyof BaseFields> = ['title', 'body', 'state'];
function res(id: string, f: BaseFields): TwinResource {
  const out: Record<string, unknown> = { id, type: 'issue', updatedAt: '' };
  for (const k of SYNCED) if (f[k] !== undefined) out[k] = f[k];
  return out as TwinResource;
}

/** RECONCILE: bidirectional three-way merge. Non-overlapping concurrent edits merge; a same-field
 *  collision is surfaced as a conflict (under `merge`) instead of one side silently clobbering. */
export async function reconcileSync(o: SyncOpts, policy: ReconcilePolicy = 'merge'): Promise<ReconcileResult> {
  const repoKey = `${o.owner}/${o.repo}`;
  const b = loadBindings(o.projectRoot, repoKey);
  const baseStore = loadBase(o.projectRoot, repoKey);

  // REAL: a fresh incremental pull.
  await runConnectorPoll(githubIssueConnector(o.execute, o.owner, o.repo), { root: o.projectRoot });
  const real = issueResources(o.projectRoot);
  const realByNumber = new Map(real.map((r) => [r.number, r]));

  // FORK: the tracker, keyed by GitHub resource id via the binding.
  const rows = (await o.client.issue.list({ state: 'all', limit: 5000, json: 'identifier,title,state,body' }) as Array<Record<string, unknown>>) || [];
  const trackerById = new Map(rows.filter((r) => r.identifier).map((r) => [String(r.identifier), r]));

  const ghId = (n: number) => `${repoKey}#issue:${n}`;
  const boundFork: TwinResource[] = [];
  const boundReal: TwinResource[] = [];
  const boundBase: TwinResource[] = [];
  for (const [ztrackId, number] of Object.entries(b.byZtrack)) {
    const id = ghId(number);
    const row = trackerById.get(ztrackId);
    if (row) boundFork.push(res(id, { title: String(row.title ?? ''), body: stripConflictSection(String(row.body ?? '')), state: statusToGithubState(stateName(row.state)) }));
    const r = realByNumber.get(number);
    if (r) boundReal.push(res(id, { title: r.title, body: r.body, state: r.state ?? 'open' }));
    if (baseStore.resources[id]) boundBase.push(res(id, baseStore.resources[id]!));
  }

  const plan = reconcile({ policy, base: boundBase, fork: boundFork, real: boundReal });
  const pulled: string[] = [];
  const pushed: string[] = [];

  // toPull: real → tracker (only the fields the merge says the tracker should take)
  for (const item of plan.toPull) {
    const ztrackId = b.byNumber[String(numberOf(item.id))];
    if (!ztrackId) continue;
    const cur = await o.client.issue.view(ztrackId, { json: 'state' }) as Record<string, unknown>;
    const edit: Record<string, unknown> = {};
    if (item.fields.title !== undefined) edit.title = String(item.fields.title);
    if (item.fields.body !== undefined) edit.body = String(item.fields.body);
    if (item.fields.state !== undefined) edit.state = githubStateToStatus(String(item.fields.state), stateName(cur.state));
    if (Object.keys(edit).length) { await o.client.issue.edit(ztrackId, edit); pulled.push(ztrackId); }
  }
  // toPush: fork → real (only the fields the merge says GitHub should take)
  for (const item of plan.toPush) {
    const number = numberOf(item.id);
    const body: Record<string, unknown> = {};
    for (const k of SYNCED) if (item.fields[k] !== undefined) body[k] = item.fields[k];
    if (!Object.keys(body).length) continue;
    await applyGithubWrite({ method: 'PATCH', path: `/repos/${o.owner}/${o.repo}/issues/${number}`, body: JSON.stringify(body), root: o.projectRoot, occurredAt: OBSERVED_AT });
    const ztrackId = b.byNumber[String(number)];
    if (ztrackId) pushed.push(ztrackId);
  }
  if (plan.toPush.length) await pushPendingGithubActions(o.execute, { root: o.projectRoot, occurredAt: OBSERVED_AT });

  // creates (one-sided issues — no conflict possible)
  const created = [...await createInTracker(o, b, real), ...await createOnGithub(o, b, unboundForkRows(rows, b))];
  // Seed the base for each created issue to its now-agreed content, or the NEXT sync sees both
  // sides as "changed from nothing" and the differing fields collide as phantom conflicts.
  for (const c of created) {
    const r = realByNumber.get(c.number);
    if (r) { baseStore.resources[ghId(c.number)] = { ...(r.title !== undefined ? { title: r.title } : {}), ...(r.body !== undefined ? { body: r.body } : {}), state: r.state ?? 'open' }; continue; }
    const row = trackerById.get(c.ztrack);
    if (row) baseStore.resources[ghId(c.number)] = { title: String(row.title ?? ''), body: String(row.body ?? ''), state: statusToGithubState(stateName(row.state)) };
  }

  // surfaced conflicts (same field changed on both sides) — left untouched on both sides, and
  // RECORDED so `ztrack check` gates on them until resolved (cleared here once they converge).
  const conflicts = plan.subjects.filter((s) => s.conflicts.length).map((s) => ({ issue: b.byNumber[String(numberOf(s.id))] ?? s.id, number: numberOf(s.id), fields: s.conflicts.map((c) => c.field) }));
  const conflictStore = loadConflicts(o.projectRoot);
  const prior = new Set(Object.keys(conflictStore.issues));
  const now = new Map<string, ConflictRecord[]>();
  for (const s of plan.subjects) {
    const ztrackId = b.byNumber[String(numberOf(s.id))];
    if (!ztrackId || !s.conflicts.length) continue;
    now.set(ztrackId, s.conflicts.map((c) => ({ field: c.field, local: String(c.fork ?? ''), remote: String(c.real ?? '') })));
  }
  for (const [zid, recs] of now) conflictStore.issues[zid] = recs;
  for (const zid of prior) if (!now.has(zid)) delete conflictStore.issues[zid];
  saveConflicts(o.projectRoot, conflictStore);
  // Refresh the LOCAL-ONLY `## Conflicts` block in each touched issue's body (added when a
  // conflict appears, removed once it converges). Stripped from the synced body above, so it
  // never round-trips to GitHub. Only touch issues whose conflict state actually changed.
  for (const zid of new Set([...now.keys(), ...prior])) {
    const view = await o.client.issue.view(zid, { json: 'body' }) as Record<string, unknown>;
    const body = String(view.body ?? '');
    const next = withConflictSection(body, now.get(zid) ?? []);
    if (next.trim() !== body.trim()) await o.client.issue.edit(zid, { body: next });
  }

  // advance the base to the converged value (non-conflict fields only, so an unresolved conflict
  // stays detected next time instead of auto-resolving in one side's favour).
  for (const s of plan.subjects) {
    const next: BaseFields = { ...(baseStore.resources[s.id] ?? {}) };
    for (const fd of s.fields) if (fd.resolution !== 'conflict') (next as Record<string, unknown>)[fd.field] = fd.value;
    baseStore.resources[s.id] = next;
  }

  saveBindings(o.projectRoot, b);
  saveBase(o.projectRoot, baseStore);
  return { pulled, pushed, created, conflicts };
}
