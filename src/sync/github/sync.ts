// Two-way GitHub issue sync over the GitHub twin in the project's world.
//
// READ: `syncGithubFromRemote` pulls the repo's issues (closed ones included) into the twin, and
// `twinResources` reads them back. WRITE: `applyGithubWrite` records one pending entry per changed
// issue and `performEntries` settles those entries against GitHub through the kernel's head
// transaction (checks, reference resolution, one performer per twin, the vendor's id rebound), so
// an entry already deployed is never performed again. The world's github root names the repo and
// holds (`deploy: 'hold'`): nothing reaches GitHub until ztrack performs. The identity binding ties
// each ztrack id to the GitHub issue number it IS.
//
// Directions:
//   pull(o)           one-way GitHub → tracker   (CLI `--pull`)
//   push(o)           one-way tracker → GitHub   (CLI `--push`)
//   reconcileSync(o)  bidirectional THREE-WAY merge (CLI default + auto-sync): per-field
//                     base/fork/real reconciliation, so a concurrent edit on one side does not
//                     clobber the other — non-overlapping field changes MERGE, only a same-field
//                     collision is a surfaced conflict (default policy `merge`). `base` (the last
//                     synced common ancestor) is persisted by ztrack since the fork is the tracker.
// NOTE: `@volter/world-core`/`@volter/twin-github` are an OPTIONAL peer (package.json
// `peerDependenciesMeta`) — only TYPES are imported statically here (erased at build time, so
// they impose no runtime resolution). The actual runtime bindings come from `loadTwinRuntime()`
// (twinRuntime.ts), a lazy `import()` so a plain `npm i -D @volter/ztrack` (peers absent) never fails to
// even LOAD this module — see twinRuntime.ts for why a static value import here would be fatal.
import type { DeployReport, RemoteExecute } from '@volter/world-core';
import { reconcile, type ReconcilePolicy, type TwinResource } from './reconcile.ts';
import type { TrackerClient } from '../../types.ts';
import { githubStateToStatus, issueResourceToRecordFields, statusToGithubState } from './map.ts';
import { loadBindings, saveBindings, bind, type GithubBindings } from './bindings.ts';
import { loadBase, saveBase, type BaseFields } from './baseStore.ts';
import { loadConflicts, saveConflicts, stripConflictSection, withConflictSection, type ConflictRecord } from '../conflicts.ts';
import { loadTwinRuntime, type TwinRuntime } from './twinRuntime.ts';

export type SyncOpts = { projectRoot: string; owner: string; repo: string; execute: RemoteExecute; client: TrackerClient; occurredAt: string };
export type PullResult = { created: string[]; updated: string[]; total: number; note?: string };
export type PushResult = { created: Array<{ ztrack: string; number: number }>; updated: string[]; skipped: number; total: number; conflicts: Array<{ issue: string; number: number; fields: string[] }> };
export type ReconcileResult = { pulled: string[]; pushed: string[]; created: Array<{ ztrack: string; number: number }>; conflicts: Array<{ issue: string; number: number; fields: string[] }> };

// The instant ztrack's writes and their settlement carry: a STABLE constant keeps re-recording the
// same content idempotent.
const OBSERVED_AT = '2020-01-01T00:00:00.000Z';

/** The world's github root names this repo and holds: its entries reach GitHub only when ztrack
 *  performs them. Written once, and again only if the repo changes. */
function ensureRoot(o: SyncOpts, twin: TwinRuntime): void {
  const scope = `repos/${o.owner}/${o.repo}`;
  const current = twin.readRoot('github', o.projectRoot);
  if (current?.url === 'https://api.github.com' && current.scope === scope && current.deploy === 'hold') return;
  twin.writeRoot('github', { url: 'https://api.github.com', scope, deploy: 'hold' }, o.projectRoot);
}

/** Pull the repo's issues (all states) from GitHub into the twin. */
async function pullRemote(o: SyncOpts, twin: TwinRuntime): Promise<{ observed: number }> {
  ensureRoot(o, twin);
  return twin.syncGithubFromRemote(o.execute, { root: o.projectRoot, origin: `https://api.github.com/repos/${o.owner}/${o.repo}`, state: 'all', perPage: 100 });
}

/** Settle pending github entries against GitHub; a refusal or failure stops the sync with the vendor's words. */
async function deploy(o: SyncOpts, twin: TwinRuntime, actionIds?: string[]): Promise<DeployReport> {
  ensureRoot(o, twin);
  const report = await twin.performEntries({ service: 'github', root: o.projectRoot, execute: o.execute, at: OBSERVED_AT, ...(actionIds ? { actionIds } : {}) });
  if (report.refused) throw new Error(`github push refused ${report.refused.actionId} (${report.refused.check}): ${report.refused.reason}`);
  if (report.failed) throw new Error(`github push failed at ${report.failed.actionId}: ${report.failed.error}`);
  return report;
}

// the tracker 'state'/'status' may arrive as a string or a nested { name }.
function stateName(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return String((v as { name?: unknown }).name ?? '');
  return '';
}

// One issue resource as twinResources('github') returns it: the FLAT TwinResource shape.
type IssueResource = { id: string; number: number; title?: string; body?: string; state?: string };
function issueResources(projectRoot: string, twin: TwinRuntime): IssueResource[] {
  const opt = (v: unknown) => (v == null ? undefined : String(v));
  return (twin.twinResources('github', projectRoot) as Array<Record<string, unknown>>)
    .filter((r) => r.type === 'issue')
    // GitHub's body in the tracker's canonical form (what stripConflictSection leaves: no trailing
    // whitespace, no run of blank lines), so pull, push and the merge compare like with like. An
    // issue with no body has GitHub's null, which is the tracker's empty body.
    .map((r) => ({ id: String(r.id), number: Number(r.number), title: opt(r.title), body: stripConflictSection(String(r.body ?? '')), state: opt(r.state) }));
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

/** Create a GitHub issue for each unbound tracker issue, binding it to the real number GitHub
 *  minted (and closing it after if the local issue is done). */
async function createOnGithub(o: SyncOpts, b: GithubBindings, rows: Array<{ ztrack: string; title: string; body: string; closed: boolean }>, twin: TwinRuntime): Promise<Array<{ ztrack: string; number: number }>> {
  const pendingCreate = new Map<string, { ztrack: string; closed: boolean }>();
  for (const row of rows) {
    const before = new Set(twin.pendingActions('github', o.projectRoot).map((a) => a.id));
    await twin.applyGithubWrite({ method: 'POST', path: `/repos/${o.owner}/${o.repo}/issues`, body: JSON.stringify({ title: row.title, body: row.body }), root: o.projectRoot, occurredAt: OBSERVED_AT });
    const fresh = twin.pendingActions('github', o.projectRoot).find((a) => !before.has(a.id));
    if (fresh) pendingCreate.set(fresh.id, { ztrack: row.ztrack, closed: row.closed });
  }
  if (!pendingCreate.size) return [];
  const report = await deploy(o, twin, [...pendingCreate.keys()]);
  const externalIds = new Map(report.deployed.map((d) => [d.actionId, d.externalId]));
  const out: Array<{ ztrack: string; number: number }> = [];
  const closeAfter: number[] = [];
  for (const [actionId, info] of pendingCreate) {
    // the vendor's id in the pack's subject grammar (`o/r#issue:57`): its trailing number
    const num = Number(String(externalIds.get(actionId) ?? '').split(/[#:]/).pop());
    if (!num) continue;
    bind(b, info.ztrack, num);
    out.push({ ztrack: info.ztrack, number: num });
    if (info.closed) closeAfter.push(num); // issue.create always OPENS — close as a 2nd morph
  }
  for (const num of closeAfter) {
    await twin.applyGithubWrite({ method: 'PATCH', path: `/repos/${o.owner}/${o.repo}/issues/${num}`, body: JSON.stringify({ state: 'closed' }), root: o.projectRoot, occurredAt: OBSERVED_AT });
  }
  if (closeAfter.length) await deploy(o, twin);
  return out;
}

const unboundForkRows = (rows: Array<Record<string, unknown>>, b: GithubBindings) =>
  rows.map((row) => ({ id: String(row.identifier ?? ''), title: String(row.title ?? ''), body: stripConflictSection(String(row.body ?? '')), ghState: statusToGithubState(stateName(row.state)) }))
    .filter((r) => r.id && !b.byZtrack[r.id])
    .map((r) => ({ ztrack: r.id, title: r.title, body: r.body, closed: r.ghState === 'closed' }));

// GitHub's issue list is eventually consistent: an issue created a moment before the very FIRST
// pull (no bindings yet) can be missing from it, and "0 created, 0 updated" would read as success.
// A pull observes the whole list each time, so a second one is risk-free. Retry ONCE, after a short
// delay, but ONLY in that narrow "first pull found nothing" case: a repo that legitimately has zero
// issues after N prior syncs must not pay this delay on every call.
const FIRST_PULL_RETRY_DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PULL: incremental fold, then write to the tracker only the issues that differ (or create new). */
export async function pull(o: SyncOpts, opts: { retryDelayMs?: number } = {}): Promise<PullResult> {
  const twin = await loadTwinRuntime();
  const repoKey = `${o.owner}/${o.repo}`;
  const b = loadBindings(o.projectRoot, repoKey);
  const isFirstPull = Object.keys(b.byNumber).length === 0;
  let poll = await pullRemote(o, twin);
  let retried = false;
  if (isFirstPull && poll.observed === 0) {
    await sleep(opts.retryDelayMs ?? FIRST_PULL_RETRY_DELAY_MS);
    poll = await pullRemote(o, twin);
    retried = true;
  }
  const resources = issueResources(o.projectRoot, twin);
  // Even the retry can still lose the race on a slower propagation — be honest about that
  // residual case instead of a bare "0 created, 0 updated" that looks identical to "really empty".
  const note = retried && poll.observed === 0
    ? 'first pull found zero remote issues (retried once after GitHub list lag) — if you just created one, GitHub list results can still lag a few more seconds; retry the pull.'
    : undefined;
  const updated: string[] = [];
  for (const res of resources) {
    const boundId = b.byNumber[String(res.number)];
    if (!boundId) continue;
    const cur = await o.client.issue.view(boundId, { json: 'title,body,state' }) as Record<string, unknown> | null;
    if (!cur) continue; // stale binding: the bound ztrack issue was deleted locally — skip, don't crash
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
  return { created: created.map((c) => c.ztrack), updated, total: resources.length, ...(note ? { note } : {}) };
}

/** PUSH: tracker → GitHub, one-sided at the CALLER's request — but NOT one-sided in mechanism.
 *  Delegates to the same three-way `reconcileSync` merge used by the bidirectional default, with
 *  `applyPull: false` so nothing is ever written back to the tracker; only `toPush` (the fields
 *  the merge decided GitHub should take) is applied. This is the fix for the data-integrity bug
 *  where a naive push diffed the tracker against a fresh pull baseline with NO base-state check:
 *  if GitHub had independently changed a field (e.g. an issue closed on GitHub) after that
 *  baseline was captured, ANY local diff on the same issue caused push to PATCH GitHub back to
 *  the stale local value — silently reopening a closed issue instead of detecting the conflict.
 *  Routing through `reconcileSync`'s base/fork/real comparison means a same-field collision
 *  (closed remotely, edited locally) is now a surfaced conflict — recorded and gating `check` —
 *  never a silent clobber; only genuinely non-conflicting local changes are pushed. */
export async function push(o: SyncOpts, policy: ReconcilePolicy = 'merge'): Promise<PushResult> {
  const before = loadBindings(o.projectRoot, `${o.owner}/${o.repo}`).byZtrack;
  const boundBefore = new Set(Object.keys(before));
  const r = await reconcileSync(o, policy, { applyPull: false });
  const updated = r.pushed;
  const createdIds = new Set(r.created.map((c) => c.ztrack));
  // skipped: bound issues that existed before this push, weren't pushed, weren't (re)created, and
  // aren't sitting in an unresolved conflict (a conflicted field is neither "pushed" nor "settled
  // skip" — it's surfaced separately in `conflicts`, same as reconcileSync reports it).
  const conflicted = new Set(r.conflicts.map((c) => c.issue));
  const pushedSet = new Set(updated);
  let skipped = 0;
  for (const id of boundBefore) if (!pushedSet.has(id) && !createdIds.has(id) && !conflicted.has(id)) skipped += 1;
  return { created: r.created, updated, skipped, total: r.created.length + updated.length + skipped, conflicts: r.conflicts };
}

// project to a TwinResource carrying only the reconciled fields (state in GitHub vocabulary).
const SYNCED: Array<keyof BaseFields> = ['title', 'body', 'state'];
function res(id: string, f: BaseFields): TwinResource {
  const out: Record<string, unknown> = { id, type: 'issue', updatedAt: '' };
  for (const k of SYNCED) if (f[k] !== undefined) out[k] = f[k];
  return out as TwinResource;
}

/** RECONCILE: bidirectional three-way merge. Non-overlapping concurrent edits merge; a same-field
 *  collision is surfaced as a conflict (under `merge`) instead of one side silently clobbering.
 *  `applyPull: false` (used by `push()` above) computes the same base/fork/real plan and still
 *  applies `toPush`/records conflicts exactly as the bidirectional default does, but never writes
 *  `plan.toPull` back to the tracker — a push-only caller's whole point is "don't touch local". */
export async function reconcileSync(o: SyncOpts, policy: ReconcilePolicy = 'merge', reconcileOpts: { applyPull?: boolean } = {}): Promise<ReconcileResult> {
  const applyPull = reconcileOpts.applyPull ?? true;
  const twin = await loadTwinRuntime();
  const repoKey = `${o.owner}/${o.repo}`;
  const b = loadBindings(o.projectRoot, repoKey);
  const baseStore = loadBase(o.projectRoot, repoKey);

  // REAL: a fresh pull.
  await pullRemote(o, twin);
  const real = issueResources(o.projectRoot, twin);
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

  // toPull: real → tracker (only the fields the merge says the tracker should take) — skipped
  // entirely when applyPull is false (push-only caller): those fields are simply left as the
  // merge computed them (unpushed, unpulled) rather than written back to the tracker.
  if (applyPull) {
    for (const item of plan.toPull) {
      const ztrackId = b.byNumber[String(numberOf(item.id))];
      if (!ztrackId) continue;
      const cur = await o.client.issue.view(ztrackId, { json: 'state' }) as Record<string, unknown> | null;
      if (!cur) continue; // stale binding: the bound ztrack issue was deleted locally — skip, don't crash
      const edit: Record<string, unknown> = {};
      if (item.fields.title !== undefined) edit.title = String(item.fields.title);
      if (item.fields.body !== undefined) edit.body = String(item.fields.body);
      if (item.fields.state !== undefined) edit.state = githubStateToStatus(String(item.fields.state), stateName(cur.state));
      if (Object.keys(edit).length) { await o.client.issue.edit(ztrackId, edit); pulled.push(ztrackId); }
    }
  }
  // toPush: fork → real (only the fields the merge says GitHub should take)
  for (const item of plan.toPush) {
    const number = numberOf(item.id);
    const body: Record<string, unknown> = {};
    for (const k of SYNCED) if (item.fields[k] !== undefined) body[k] = item.fields[k];
    if (!Object.keys(body).length) continue;
    await twin.applyGithubWrite({ method: 'PATCH', path: `/repos/${o.owner}/${o.repo}/issues/${number}`, body: JSON.stringify(body), root: o.projectRoot, occurredAt: OBSERVED_AT });
    const ztrackId = b.byNumber[String(number)];
    if (ztrackId) pushed.push(ztrackId);
  }
  if (plan.toPush.length) await deploy(o, twin);

  // creates (one-sided issues — no conflict possible)
  // a push (applyPull false) writes nothing to the tracker: an unbound GitHub issue is imported only by a sync that pulls
  const created = [...(applyPull ? await createInTracker(o, b, real) : []), ...await createOnGithub(o, b, unboundForkRows(rows, b), twin)];
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
  // stays detected next time instead of auto-resolving in one side's favour). A `take-real`
  // (pull) decision only converges the base when applyPull actually wrote it to the tracker —
  // otherwise the tracker is still on the OLD value, and advancing the base to the new `real`
  // value here would make a still-outstanding GitHub-side change look "already synced" on the
  // next reconcile, silently losing it instead of pushing/surfacing it later.
  for (const s of plan.subjects) {
    const next: BaseFields = { ...(baseStore.resources[s.id] ?? {}) };
    for (const fd of s.fields) {
      if (fd.resolution === 'conflict') continue;
      if (fd.resolution === 'take-real' && !applyPull) continue;
      (next as Record<string, unknown>)[fd.field] = fd.value;
    }
    baseStore.resources[s.id] = next;
  }

  saveBindings(o.projectRoot, b);
  saveBase(o.projectRoot, baseStore);
  return { pulled, pushed, created, conflicts };
}
