// Runnable reconcile scenarios — executed in a SUBPROCESS by reconcile.e2e.test.ts so the real
// twin loads with clean module state (another test's global `mock.module('@volter-ai-dev/twin')`
// would otherwise leak a stub into this in-process twin user). Drives the REAL twin (cursor
// connector + egress) + a REAL markdown tracker; only GitHub's HTTP boundary is a stateful fake
// (with `updated_at`, which the cursor needs). Prints a JSON result the test asserts on.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerClient } from '../../sdk.ts';
import { initTrackerProject } from '../../config.ts';
import { reconcileSync, type SyncOpts } from './sync.ts';

type GhIssue = { number: number; title: string; body: string; state: string; updated_at: string };

function fakeGithub() {
  const issues = new Map<number, GhIssue>();
  let next = 1;
  let clock = 0;
  const ts = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString();
  const execute = {
    async request(route: string, params: Record<string, unknown> = {}) {
      if (route === 'GET /repos/{owner}/{repo}/issues') return { status: 200, data: [...issues.values()] };
      if (route.startsWith('GET ')) return { status: 200, data: [] };
      if (route === 'POST /repos/{owner}/{repo}/issues') {
        const n = next++;
        issues.set(n, { number: n, title: String(params.title ?? ''), body: String(params.body ?? ''), state: 'open', updated_at: ts() });
        return { status: 201, data: issues.get(n) };
      }
      if (route === 'PATCH /repos/{owner}/{repo}/issues/{issue_number}') {
        const n = Number(params.issue_number);
        const cur = issues.get(n) ?? { number: n, title: '', body: '', state: 'open', updated_at: ts() };
        issues.set(n, { ...cur, ...('title' in params ? { title: String(params.title) } : {}), ...('body' in params ? { body: String(params.body) } : {}), ...('state' in params ? { state: String(params.state) } : {}), updated_at: ts() });
        return { status: 200, data: issues.get(n) };
      }
      throw new Error(`fakeGithub: unhandled ${route}`);
    },
  };
  const ghEdit = (n: number, patch: Partial<GhIssue>) => issues.set(n, { ...issues.get(n)!, ...patch, updated_at: ts() });
  return { execute, issues, ghEdit };
}

async function withProject<T>(fn: (ctx: { root: string; client: ReturnType<typeof createTrackerClient>; gh: ReturnType<typeof fakeGithub>; opts: () => SyncOpts }) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-rec-'));
  try {
    initTrackerProject(root, 'ZT');
    const client = createTrackerClient({ projectRoot: root });
    const gh = fakeGithub();
    const opts = (): SyncOpts => ({ root, projectRoot: root, owner: 'o', repo: 'r', execute: gh.execute, client, occurredAt: '2026-01-01T00:00:00Z' } as unknown as SyncOpts);
    return await fn({ root, client, gh, opts });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export async function runReconcileScenarios() {
  const results: Record<string, unknown> = {};

  // 1) non-overlapping concurrent edits MERGE
  results.merge = await withProject(async ({ client, gh, opts }) => {
    await gh.execute.request('POST /repos/{owner}/{repo}/issues', { title: 'Title', body: 'Body' });
    await reconcileSync(opts());
    const id = String((await client.issue.list({ state: 'all', json: 'identifier,title' }) as Array<Record<string, unknown>>).find((r) => r.title === 'Title')!.identifier);
    await client.issue.edit(id, { title: 'Title LOCAL' });   // local title
    gh.ghEdit(1, { body: 'Body REMOTE' });                   // remote body
    const r = await reconcileSync(opts());
    const view = await client.issue.view(id, { json: 'title,body' }) as Record<string, unknown>;
    return { conflicts: r.conflicts.length, ghTitle: gh.issues.get(1)!.title, ghBody: gh.issues.get(1)!.body, trackerTitle: view.title, trackerBody: view.body };
  });

  // 2) same-field collision is a SURFACED conflict
  results.conflict = await withProject(async ({ client, gh, opts }) => {
    await gh.execute.request('POST /repos/{owner}/{repo}/issues', { title: 'Title', body: 'Body' });
    await reconcileSync(opts());
    const id = String((await client.issue.list({ state: 'all', json: 'identifier,title' }) as Array<Record<string, unknown>>).find((r) => r.title === 'Title')!.identifier);
    await client.issue.edit(id, { title: 'Title FROM LOCAL' });
    gh.ghEdit(1, { title: 'Title FROM REMOTE' });
    const r = await reconcileSync(opts());
    const view = await client.issue.view(id, { json: 'title' }) as Record<string, unknown>;
    return { conflicts: r.conflicts.length, fields: r.conflicts[0]?.fields ?? [], ghTitle: gh.issues.get(1)!.title, trackerTitle: view.title };
  });

  // 3) a settled sync is idempotent
  results.idempotent = await withProject(async ({ gh, opts }) => {
    await gh.execute.request('POST /repos/{owner}/{repo}/issues', { title: 'Title', body: 'Body' });
    await reconcileSync(opts());
    const r = await reconcileSync(opts());
    return { pulled: r.pulled.length, pushed: r.pushed.length, conflicts: r.conflicts.length };
  });

  return results;
}

if (import.meta.main) {
  runReconcileScenarios()
    .then((r) => process.stdout.write(JSON.stringify(r)))
    .catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
}
