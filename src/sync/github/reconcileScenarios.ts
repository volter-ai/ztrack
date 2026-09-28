// Runnable reconcile scenarios — executed in a SUBPROCESS by reconcile.e2e.test.ts so the real
// twin loads with clean module state (another test's global `mock.module('@volter/world-core')`
// would otherwise leak a stub into this in-process twin user). Drives the REAL twin (its pull and
// the kernel's push) + a REAL markdown tracker; only GitHub's HTTP boundary is a stateful fake.
// Prints a JSON result the test asserts on.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerClient } from '../../sdk.ts';
import { initTrackerProject } from '../../presetCatalog.ts';
import { checkTracker } from '../../check.ts';
import { reconcileSync, type SyncOpts } from './sync.ts';
import { fakeGithub } from './fakeGithub.ts';

const REPO = join(import.meta.dir, '..', '..', '..'); // src/sync/github -> repo root



async function withProject<T>(fn: (ctx: { root: string; client: ReturnType<typeof createTrackerClient>; gh: ReturnType<typeof fakeGithub>; opts: () => SyncOpts }) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-rec-'));
  try {
    initTrackerProject(root, 'ZT');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // so checkTracker's preset resolves 'ztrack/preset-kit'
    const client = createTrackerClient({ projectRoot: root });
    const gh = fakeGithub();
    const opts = (): SyncOpts => ({ projectRoot: root, owner: 'o', repo: 'r', execute: gh.execute, client, occurredAt: '2026-01-01T00:00:00Z' });
    return await fn({ root, client, gh, opts });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export async function runReconcileScenarios() {
  const results: Record<string, unknown> = {};

  // 1) non-overlapping concurrent edits MERGE
  results.merge = await withProject(async ({ client, gh, opts }) => {
    await gh.execute({ method: 'POST', path: '/repos/o/r/issues', body: JSON.stringify({ title: 'Title', body: 'Body' }) });
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
    await gh.execute({ method: 'POST', path: '/repos/o/r/issues', body: JSON.stringify({ title: 'Title', body: 'Body' }) });
    await reconcileSync(opts());
    const id = String((await client.issue.list({ state: 'all', json: 'identifier,title' }) as Array<Record<string, unknown>>).find((r) => r.title === 'Title')!.identifier);
    await client.issue.edit(id, { title: 'Title FROM LOCAL' });
    gh.ghEdit(1, { title: 'Title FROM REMOTE' });
    const r = await reconcileSync(opts());
    const view = await client.issue.view(id, { json: 'title' }) as Record<string, unknown>;
    return { conflicts: r.conflicts.length, fields: r.conflicts[0]?.fields ?? [], ghTitle: gh.issues.get(1)!.title, trackerTitle: view.title };
  });

  // 3) hub-wins: a same-field collision auto-resolves to GitHub (no conflict surfaced)
  results.hubWins = await withProject(async ({ client, gh, opts }) => {
    await gh.execute({ method: 'POST', path: '/repos/o/r/issues', body: JSON.stringify({ title: 'Title', body: 'Body' }) });
    await reconcileSync(opts(), 'hub-wins');
    const id = String((await client.issue.list({ state: 'all', json: 'identifier,title' }) as Array<Record<string, unknown>>).find((r) => r.title === 'Title')!.identifier);
    await client.issue.edit(id, { title: 'Title FROM LOCAL' });
    gh.ghEdit(1, { title: 'Title FROM REMOTE' });
    const r = await reconcileSync(opts(), 'hub-wins');
    const view = await client.issue.view(id, { json: 'title' }) as Record<string, unknown>;
    return { conflicts: r.conflicts.length, ghTitle: gh.issues.get(1)!.title, trackerTitle: view.title };
  });

  // 4) GATING: an unresolved conflict makes `ztrack check` emit sync_conflict; resolving
  //    (a policy re-sync) converges and clears it, so the very next check goes clean.
  results.gating = await withProject(async ({ root, client, gh, opts }) => {
    await gh.execute({ method: 'POST', path: '/repos/o/r/issues', body: JSON.stringify({ title: 'Title', body: 'Body' }) });
    await reconcileSync(opts());
    const id = String((await client.issue.list({ state: 'all', json: 'identifier,title' }) as Array<Record<string, unknown>>).find((r) => r.title === 'Title')!.identifier);
    await client.issue.edit(id, { title: 'Title FROM LOCAL' });
    gh.ghEdit(1, { title: 'Title FROM REMOTE' });
    await reconcileSync(opts()); // merge → conflict recorded, neither applied
    const withConflict = (await checkTracker({ projectRoot: root })).findings.some((f) => f.code === 'sync_conflict');
    const bodyHasMarker = String((await client.issue.view(id, { json: 'body' }) as Record<string, unknown>).body ?? '').includes('## Conflicts');
    const ghBodyClean = !gh.issues.get(1)!.body.includes('## Conflicts'); // marker never leaked to GitHub
    await reconcileSync(opts(), 'hub-wins'); // resolve: take GitHub → converges, clears the record
    const afterResolve = (await checkTracker({ projectRoot: root })).findings.some((f) => f.code === 'sync_conflict');
    const markerGone = !String((await client.issue.view(id, { json: 'body' }) as Record<string, unknown>).body ?? '').includes('## Conflicts');
    return { withConflict, afterResolve, bodyHasMarker, ghBodyClean, markerGone };
  });

  // 5) a settled sync is idempotent
  results.idempotent = await withProject(async ({ gh, opts }) => {
    await gh.execute({ method: 'POST', path: '/repos/o/r/issues', body: JSON.stringify({ title: 'Title', body: 'Body' }) });
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
