// Two-way Jira sync over the Jira twin (company RFC 0026 decision 2): a ticket is an arc. The form of sync/github.
//
// READ: `syncJiraFromRemote` folds the site's tickets (the project's JQL) into the twin in the project's world, and
// `twinResources('jira')` reads them back. WRITE: `applyJiraWrite` records one pending entry per change (a field
// update, or a transition, which the twin records as its target status) and `performEntries` settles them against the
// site, where the push resolves the real transition by its target status. The world's jira root holds
// (`deploy: 'hold'`): nothing reaches Jira until ztrack performs.
//
// Fields: summary <-> title, description <-> body (plain text; Jira's ADF on the wire), status <-> status by the
// project's table (map.ts). A ticket the JQL finds with no arc becomes one. A board card with no ticket stays the
// board's: a client's Jira is never written a ticket it did not have, unless `create` is set. Comments: every comment
// of a bound ticket, paged past the page a search embeds (board.py's rule: a long thread is never cut), is added to its
// arc once, with its author and time.
import type { DeployReport, RemoteExecute } from '@volter/world-core';
import type { TrackerClient } from '../../types.ts';
import { reconcile, type ReconcilePolicy, type TwinResource } from '../github/reconcile.ts';
import { stripConflictSection } from '../conflicts.ts';
import { boardToJiraStatus, jiraToBoardStatus, sameStatus, type StatusTable } from './map.ts';
import { bind, loadStore, saveStore, type JiraFields, type JiraStore } from './store.ts';
import { loadJiraTwinRuntime, type JiraTwinRuntime } from './twinRuntime.ts';

export type JiraSyncOpts = { projectRoot: string; site: string; jql: string; statuses: StatusTable; create?: boolean; execute: RemoteExecute; client: TrackerClient };
export type JiraSyncResult = { pulled: string[]; pushed: string[]; created: Array<{ ztrack: string; key: string }>; comments: number; conflicts: Array<{ issue: string; key: string; fields: string[] }> };

const OBSERVED_AT = '2020-01-01T00:00:00.000Z';
const stateName = (v: unknown): string => typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as { name?: unknown }).name ?? '') : '';

function ensureRoot(o: JiraSyncOpts, twin: JiraTwinRuntime): void {
  const url = o.site.replace(/\/+$/, '');
  const current = twin.readRoot('jira', o.projectRoot);
  if (current?.url === url && current.deploy === 'hold') return;
  twin.writeRoot('jira', { url, scope: 'rest/api/3', deploy: 'hold' }, o.projectRoot);
}

type Ticket = { key: string; title: string; body: string; status: string };
function tickets(o: JiraSyncOpts, twin: JiraTwinRuntime): Ticket[] {
  return (twin.twinResources('jira', o.projectRoot) as Array<Record<string, unknown>>)
    .filter((r) => r.type === 'issue')
    .map((r) => ({ key: String(r.key ?? r.id), title: String(r.summary ?? ''), body: stripConflictSection(String(r.description ?? '')), status: String(r.status ?? '') }));
}

async function pullRemote(o: JiraSyncOpts, twin: JiraTwinRuntime): Promise<void> {
  ensureRoot(o, twin);
  await twin.syncJiraFromRemote(o.execute, { root: o.projectRoot, jql: o.jql, maxResults: 1000 });
}

async function deploy(o: JiraSyncOpts, twin: JiraTwinRuntime): Promise<DeployReport> {
  ensureRoot(o, twin);
  const report = await twin.performEntries({ service: 'jira', root: o.projectRoot, execute: o.execute, at: OBSERVED_AT });
  if (report.refused) throw new Error(`jira push refused ${report.refused.actionId} (${report.refused.check}): ${report.refused.reason}`);
  if (report.failed) throw new Error(`jira push failed at ${report.failed.actionId}: ${report.failed.error}`);
  return report;
}

/** Record a ticket's change in the twin: its fields by PUT, its status by the transition that reaches it. */
async function recordChange(o: JiraSyncOpts, twin: JiraTwinRuntime, key: string, fields: JiraFields): Promise<boolean> {
  let recorded = false;
  const put: Record<string, unknown> = {};
  if (fields.title !== undefined) put.summary = fields.title;
  if (fields.body !== undefined) put.description = twin.textToAdf(fields.body);
  if (Object.keys(put).length) {
    const out = await twin.applyJiraWrite({ method: 'PUT', path: `/rest/api/3/issue/${encodeURIComponent(key)}`, body: JSON.stringify({ fields: put }), root: o.projectRoot, occurredAt: OBSERVED_AT });
    if (out.response.status >= 300) throw new Error(`jira: the twin refused ${key}'s update (${out.response.status})`);
    recorded = true;
  }
  if (fields.status !== undefined) {
    const listed = twin.handleJiraRequest({ method: 'GET', path: `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, root: o.projectRoot });
    const transitions = ((listed.body as { transitions?: Array<{ id: string; to?: { name?: string } }> } | undefined)?.transitions) ?? [];
    const to = transitions.find((t) => String(t.to?.name ?? '').toLowerCase() === fields.status!.toLowerCase());
    if (!to) throw new Error(`jira: ${key} offers no transition to "${fields.status}" (its workflow decides; map that board status to a status it reaches)`);
    const out = await twin.applyJiraWrite({ method: 'POST', path: `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, body: JSON.stringify({ transition: { id: to.id } }), root: o.projectRoot, occurredAt: OBSERVED_AT });
    if (out.response.status >= 300) throw new Error(`jira: the twin refused ${key}'s transition to "${fields.status}" (${out.response.status})`);
    recorded = true;
  }
  return recorded;
}

/** Every comment of a ticket, page by page past the page a search embeds, added once to its arc. */
async function pullComments(o: JiraSyncOpts, twin: JiraTwinRuntime, store: JiraStore, key: string, ztrackId: string): Promise<number> {
  const seen = new Set(store.comments[key] ?? []);
  let added = 0;
  for (let startAt = 0; ; ) {
    const res = await o.execute({ method: 'GET', path: `/rest/api/3/issue/${encodeURIComponent(key)}/comment?startAt=${startAt}&maxResults=100&orderBy=created` });
    if (res.status >= 300) throw new Error(`jira: ${key}'s comments answered ${res.status}`);
    const page = JSON.parse(res.body) as { comments?: Array<{ id?: string; author?: { displayName?: string }; created?: string; body?: unknown }>; total?: number; maxResults?: number };
    const comments = page.comments ?? [];
    for (const c of comments) {
      if (!c.id || seen.has(c.id)) continue;
      const text = (typeof c.body === 'string' ? c.body : twin.adfToText(c.body)) ?? '';
      await o.client.issue.comment(ztrackId, `${c.author?.displayName ?? 'Someone'} on ${key}, ${c.created ?? ''} (Jira comment ${c.id}):\n\n${text}`);
      seen.add(c.id);
      added += 1;
    }
    startAt += comments.length;
    if (comments.length === 0 || startAt >= (page.total ?? 0)) break;
  }
  store.comments[key] = [...seen];
  return added;
}

const res = (id: string, f: JiraFields): TwinResource => ({ id, type: 'issue', updatedAt: '', ...(f.title !== undefined ? { title: f.title } : {}), ...(f.body !== undefined ? { body: f.body } : {}), ...(f.status !== undefined ? { status: f.status } : {}) });

/** The bidirectional sync: a three-way merge per field against the last synced base. Non-overlapping changes merge;
 *  a field changed on both sides is a conflict under `merge`, left as it is on both, and reported. */
export async function syncJira(o: JiraSyncOpts, policy: ReconcilePolicy = 'merge', direction: { pull?: boolean; push?: boolean } = { pull: true, push: true }): Promise<JiraSyncResult> {
  const twin = await loadJiraTwinRuntime();
  const store = loadStore(o.projectRoot, o.site);
  await pullRemote(o, twin);
  const real = tickets(o, twin);
  const realByKey = new Map(real.map((t) => [t.key, t]));
  const rows = (await o.client.issue.list({ state: 'all', limit: 5000, json: 'identifier,title,state,body' }) as Array<Record<string, unknown>>) || [];
  const byId = new Map(rows.filter((r) => r.identifier).map((r) => [String(r.identifier), r]));

  // The board's side in Jira's words: its status as the Jira status the table sends it to, or the ticket's own when
  // the ticket's status already stands for it (so a ticket in one of several statuses mapped to one board status is
  // not moved).
  const fork: TwinResource[] = [];
  const realSide: TwinResource[] = [];
  const base: TwinResource[] = [];
  for (const [ztrackId, key] of Object.entries(store.byZtrack)) {
    const row = byId.get(ztrackId);
    const ticket = realByKey.get(key);
    if (row) {
      const status = stateName(row.state);
      const jiraStatus = ticket && sameStatus(o.statuses, ticket.status, status) ? ticket.status : boardToJiraStatus(o.statuses, status) ?? ticket?.status;
      fork.push(res(key, { title: String(row.title ?? ''), body: stripConflictSection(String(row.body ?? '')), ...(jiraStatus ? { status: jiraStatus } : {}) }));
    }
    if (ticket) realSide.push(res(key, ticket));
    if (store.base[key]) base.push(res(key, store.base[key]!));
  }
  const plan = reconcile({ policy, base, fork, real: realSide });
  const pulled: string[] = [];
  const pushed: string[] = [];
  if (direction.pull) for (const item of plan.toPull) {
    const ztrackId = store.byKey[item.id];
    if (!ztrackId || !byId.has(ztrackId)) continue;
    const edit: Record<string, unknown> = {};
    if (item.fields.title !== undefined) edit.title = String(item.fields.title);
    if (item.fields.body !== undefined) edit.body = String(item.fields.body);
    if (item.fields.status !== undefined) edit.state = jiraToBoardStatus(o.statuses, String(item.fields.status), stateName(byId.get(ztrackId)!.state));
    if (Object.keys(edit).length) { await o.client.issue.edit(ztrackId, edit); pulled.push(ztrackId); }
  }
  let anyPush = false;
  if (direction.push) {
    for (const item of plan.toPush) {
      const fields: JiraFields = {};
      if (item.fields.title !== undefined) fields.title = String(item.fields.title);
      if (item.fields.body !== undefined) fields.body = String(item.fields.body);
      if (item.fields.status !== undefined) fields.status = String(item.fields.status);
      if (await recordChange(o, twin, item.id, fields)) { anyPush = true; const z = store.byKey[item.id]; if (z) pushed.push(z); }
    }
    if (anyPush) await deploy(o, twin);
  }

  // Tickets with no arc become arcs. A board card becomes a ticket only where the project says so (`create`).
  const created: Array<{ ztrack: string; key: string }> = [];
  if (direction.pull) for (const ticket of real) {
    if (store.byKey[ticket.key]) continue;
    const r = await o.client.issue.create({ title: ticket.title || `Jira ${ticket.key}`, body: ticket.body, state: jiraToBoardStatus(o.statuses, ticket.status) }) as Record<string, unknown>;
    const id = String(r.identifier ?? '');
    if (id) { bind(store, id, ticket.key); created.push({ ztrack: id, key: ticket.key }); store.base[ticket.key] = { title: ticket.title, body: ticket.body, status: ticket.status }; }
  }
  if (direction.push && o.create) {
    for (const row of rows) {
      const id = String(row.identifier ?? '');
      if (!id || store.byZtrack[id]) continue;
      const project = /project\s*=\s*"?([A-Z][A-Z0-9_]*)"?/i.exec(o.jql)?.[1];
      if (!project) throw new Error('ztrack sync jira: create needs the JQL to name its project (project = KEY)');
      const out = await twin.applyJiraWrite({ method: 'POST', path: '/rest/api/3/issue', body: JSON.stringify({ fields: { project: { key: project }, summary: String(row.title ?? ''), description: twin.textToAdf(stripConflictSection(String(row.body ?? ''))), issuetype: { name: 'Task' } } }), root: o.projectRoot, occurredAt: OBSERVED_AT });
      if (out.response.status >= 300) throw new Error(`jira: the twin refused ${id}'s ticket (${out.response.status})`);
      const report = await deploy(o, twin);
      const key = String(report.deployed.at(-1)?.externalId ?? (out.response.body as { key?: string } | undefined)?.key ?? '').split(/[#:]/).pop() ?? '';
      if (key) { bind(store, id, key); created.push({ ztrack: id, key }); }
    }
  }

  // Comments, for every bound ticket the JQL still finds.
  let comments = 0;
  if (direction.pull) for (const [key, ztrackId] of Object.entries(store.byKey)) if (realByKey.has(key) && byId.has(ztrackId)) comments += await pullComments(o, twin, store, key, ztrackId);

  // The base advances to what both sides now agree on; a conflicting field stays at its base so it stays a conflict.
  for (const s of plan.subjects) {
    const next: JiraFields = { ...(store.base[s.id] ?? {}) };
    for (const f of s.fields) if (f.resolution !== 'conflict') (next as Record<string, unknown>)[f.field] = f.value;
    store.base[s.id] = next;
  }
  saveStore(o.projectRoot, store);
  const conflicts = plan.subjects.filter((s) => s.conflicts.length).map((s) => ({ issue: store.byKey[s.id] ?? s.id, key: s.id, fields: s.conflicts.map((c) => c.field) }));
  return { pulled, pushed, created, comments, conflicts };
}
