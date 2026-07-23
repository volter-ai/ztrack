// ZTB-21 dev/02 scenarios — run in a SUBPROCESS by pullLag.e2e.test.ts for the same reason
// reconcileScenarios.ts is (another test's global `mock.module('@volter/twin')` would
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
import { pull, type SyncOpts } from './sync.ts';

const REPO = join(import.meta.dir, '..', '..', '..'); // src/sync/github -> repo root

type GhIssue = { number: number; title: string; body: string; state: string; updated_at: string };

/** A stateful fake GitHub whose issue-LIST endpoint returns EMPTY for the first `lagCalls` calls
 *  — modeling GitHub's real eventual-consistency lag right after `gh issue create` — then the
 *  real data thereafter. */
function lagGithub(lagCalls: number) {
  const issues = new Map<number, GhIssue>();
  let next = 1;
  let clock = 0;
  let listCalls = 0;
  const ts = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString();
  const execute = {
    async request(route: string, params: Record<string, unknown> = {}) {
      if (route === 'GET /repos/{owner}/{repo}/issues') {
        listCalls += 1;
        if (listCalls <= lagCalls) return { status: 200, data: [] }; // simulate list-read lag
        return { status: 200, data: [...issues.values()] };
      }
      if (route.startsWith('GET ')) return { status: 200, data: [] };
      if (route === 'POST /repos/{owner}/{repo}/issues') {
        const num = next++;
        issues.set(num, { number: num, title: String(params.title ?? ''), body: String(params.body ?? ''), state: 'open', updated_at: ts() });
        return { status: 201, data: issues.get(num) };
      }
      throw new Error(`lagGithub: unhandled ${route}`);
    },
  };
  return { execute, issues, listCalls: () => listCalls };
}

async function withProject<T>(fn: (ctx: { root: string; client: ReturnType<typeof createTrackerClient>; gh: ReturnType<typeof lagGithub>; opts: () => SyncOpts }) => Promise<T>, lagCalls: number): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-pulllag-'));
  try {
    initTrackerProject(root, 'ZT');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    const client = createTrackerClient({ projectRoot: root });
    const gh = lagGithub(lagCalls);
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
    await gh.execute.request('POST /repos/{owner}/{repo}/issues', { title: 'Filed on GitHub' });
    const r = await pull(opts(), { retryDelayMs: 5 });
    return { created: r.created.length, total: r.total, note: r.note ?? null, listCalls: gh.listCalls() };
  }, 1);

  // 2) lag outlives the one retry: still honest, not a silent "0 created, 0 updated" — a `note`
  //    explains the residual race instead.
  results.stillLagging = await withProject(async ({ gh, opts }) => {
    await gh.execute.request('POST /repos/{owner}/{repo}/issues', { title: 'Filed on GitHub' });
    const r = await pull(opts(), { retryDelayMs: 5 });
    return { created: r.created.length, note: r.note ?? null };
  }, 5);

  // 3) a SECOND pull (bindings already exist -> not "first pull") that legitimately finds nothing
  //    new must NOT retry — no extra list call, no note, no added delay for a repo that's just
  //    settled.
  results.settledNoRetry = await withProject(async ({ gh, opts }) => {
    await gh.execute.request('POST /repos/{owner}/{repo}/issues', { title: 'Filed on GitHub' });
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
