// ZTB-21 dev/04 scenarios — run in a SUBPROCESS by pushTotal.e2e.test.ts for the same reason
// reconcileScenarios.ts is (another test's global `mock.module('@volter/world-core')` would
// otherwise leak a stub into this in-process twin user). Drives the REAL `push()` against a real
// markdown tracker; only GitHub's HTTP boundary is a stateful fake. Prints a JSON result the test
// asserts on.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerClient } from '../../sdk.ts';
import { initTrackerProject } from '../../presetCatalog.ts';
import { push, type PushResult, type SyncOpts } from './sync.ts';
import { fakeGithub } from './fakeGithub.ts';

const REPO = join(import.meta.dir, '..', '..', '..'); // src/sync/github -> repo root



async function withProject<T>(fn: (ctx: { root: string; client: ReturnType<typeof createTrackerClient>; gh: ReturnType<typeof fakeGithub>; opts: () => SyncOpts }) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-pushtotal-'));
  try {
    initTrackerProject(root, 'ZT');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    mkdirSync(join(root, 'node_modules', '@volter'), { recursive: true }); symlinkSync(REPO, join(root, 'node_modules', '@volter', 'ztrack'));
    const client = createTrackerClient({ projectRoot: root });
    const gh = fakeGithub();
    const opts = (): SyncOpts => ({ projectRoot: root, owner: 'o', repo: 'r', execute: gh.execute, client, occurredAt: '2026-01-01T00:00:00Z' });
    return await fn({ root, client, gh, opts });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function invariantHolds(r: PushResult): boolean {
  return r.total === r.created.length + r.updated.length + r.skipped;
}

export async function runPushTotalScenarios() {
  const results: Record<string, unknown> = {};

  // 1) both issues brand-new: total attributes cleanly to `created`.
  results.bothCreated = await withProject(async ({ client, opts }) => {
    await client.issue.create({ title: 'Issue A', body: 'a', state: 'draft' });
    await client.issue.create({ title: 'Issue B', body: 'b', state: 'draft' });
    const r = await push(opts());
    return { created: r.created.length, updated: r.updated.length, skipped: r.skipped, total: r.total, invariantHolds: invariantHolds(r) };
  });

  // 2) THE REPORTED BUG SHAPE: one issue edited (-> updated), the other left alone (-> skipped),
  // after both were already pushed once. Before the fix: total was `list.length` (2) while
  // `created` was empty and `updated` held only the one changed issue — a silent contradiction.
  results.oneUpdatedOneSkipped = await withProject(async ({ client, opts }) => {
    await client.issue.create({ title: 'Issue A', body: 'a', state: 'draft' });
    await client.issue.create({ title: 'Issue B', body: 'b', state: 'draft' });
    await push(opts()); // first push: both created, nothing left to update/skip yet
    const rows = await client.issue.list({ state: 'all', json: 'identifier,title' }) as Array<Record<string, unknown>>;
    const a = rows.find((r) => r.title === 'Issue A')!;
    await client.issue.edit(String(a.identifier), { title: 'Issue A EDITED' });
    const r = await push(opts()); // second push: A updated, B unchanged (skipped), nothing created
    return { created: r.created.length, updated: r.updated.length, skipped: r.skipped, total: r.total, invariantHolds: invariantHolds(r) };
  });

  // 3) a fully settled push (nothing changed anywhere): total attributes entirely to `skipped`.
  results.allSkipped = await withProject(async ({ client, opts }) => {
    await client.issue.create({ title: 'Issue A', body: 'a', state: 'draft' });
    await push(opts());
    const r = await push(opts()); // nothing changed since
    return { created: r.created.length, updated: r.updated.length, skipped: r.skipped, total: r.total, invariantHolds: invariantHolds(r) };
  });

  return results;
}

if (import.meta.main) {
  runPushTotalScenarios()
    .then((r) => process.stdout.write(JSON.stringify(r)))
    .catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
}
