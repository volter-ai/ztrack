// ZTB-21 dev/02 scenarios — run in a SUBPROCESS by pullLag.e2e.test.ts for the same reason
// reconcileScenarios.ts is (another test's global `mock.module('@volter/world-core')` would
// otherwise leak a stub into this in-process twin user). Drives the REAL `pull()` (real twin
// cursor connector + a real markdown tracker); only GitHub's HTTP boundary is a stateful fake
// that can additionally simulate the issue-LIST endpoint lagging behind a just-created issue for
// a configurable number of calls — the exact "gh issue create; ztrack sync --pull" race from the
// bug report. Prints a JSON result the test asserts on.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerClient } from '../../sdk.ts';
import { initTrackerProject } from '../../presetCatalog.ts';
import { fakeGithub } from './fakeGithub.ts';
import { pull, type SyncOpts } from './sync.ts';

const REPO = join(import.meta.dir, '..', '..', '..'); // src/sync/github -> repo root



async function withProject<T>(fn: (ctx: { root: string; client: ReturnType<typeof createTrackerClient>; gh: ReturnType<typeof fakeGithub>; opts: () => SyncOpts }) => Promise<T>, lagCalls: number): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-pulllag-'));
  try {
    initTrackerProject(root, 'ZT');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    const client = createTrackerClient({ projectRoot: root });
    const gh = fakeGithub({ lagCalls });
    const opts = (): SyncOpts => ({ projectRoot: root, owner: 'o', repo: 'r', execute: gh.execute, client, occurredAt: '2026-01-01T00:00:00Z' });
    return await fn({ root, client, gh, opts });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export async function runPullLagScenarios() {
  const results: Record<string, unknown> = {};

  // 1) one round of list lag: the built-in bounded retry recovers it, no false "0/0".
  results.recovered = await withProject(async ({ gh, opts }) => {
    await gh.execute({ method: 'POST', path: '/repos/o/r/issues', body: JSON.stringify({ title: 'Filed on GitHub' }) });
    const r = await pull(opts(), { retryDelayMs: 5 });
    return { created: r.created.length, total: r.total, note: r.note ?? null, listCalls: gh.listCalls() };
  }, 1);

  // 2) lag outlives the one retry: still honest, not a silent "0 created, 0 updated" — a `note`
  //    explains the residual race instead.
  results.stillLagging = await withProject(async ({ gh, opts }) => {
    await gh.execute({ method: 'POST', path: '/repos/o/r/issues', body: JSON.stringify({ title: 'Filed on GitHub' }) });
    const r = await pull(opts(), { retryDelayMs: 5 });
    return { created: r.created.length, note: r.note ?? null };
  }, 5);

  // 3) a SECOND pull (bindings already exist -> not "first pull") that legitimately finds nothing
  //    new must NOT retry — no extra list call, no note, no added delay for a repo that's just
  //    settled.
  results.settledNoRetry = await withProject(async ({ gh, opts }) => {
    await gh.execute({ method: 'POST', path: '/repos/o/r/issues', body: JSON.stringify({ title: 'Filed on GitHub' }) });
    await pull(opts(), { retryDelayMs: 5 }); // first pull: binds the one issue
    const before = gh.listCalls();
    const r2 = await pull(opts(), { retryDelayMs: 5 }); // second pull: genuinely nothing new
    return { created: r2.created.length, note: r2.note ?? null, listCallsForSecondPull: gh.listCalls() - before };
  }, 0);

  return results;
}

if (import.meta.main) {
  runPullLagScenarios()
    .then((r) => process.stdout.write(JSON.stringify(r)))
    .catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
}
