// Z1 regression scenarios — run in a SUBPROCESS by pushClobber.e2e.test.ts (same isolation
// reason as reconcileScenarios.ts/pushTotalScenarios.ts: another test globally mocks the twin
// module). Drives the REAL `push()` against a real markdown tracker; only GitHub's HTTP boundary
// is a stateful fake. Prints a JSON result the test asserts on.
//
// THE BUG: `sync github --push` used alone dispatched a naive push() that diffed the tracker
// against a FRESH re-pull baseline with no base-state (3-way) check. If GitHub had independently
// changed a field (e.g. a maintainer closed the issue on GitHub) after that fresh baseline was
// captured — impossible to avoid, since the baseline IS that same fresh pull — any local edit to
// the SAME issue caused push to PATCH GitHub back to the stale local state, silently reopening a
// closed issue. The fix routes push through the same three-way (base/fork/real) reconcile the
// bidirectional sync already uses, with pull-application suppressed: a same-field collision
// (closed remotely + edited locally) is now a surfaced conflict, never a clobber.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerClient } from '../../sdk.ts';
import { initTrackerProject } from '../../presetCatalog.ts';
import { push, reconcileSync, type SyncOpts } from './sync.ts';

const REPO = join(import.meta.dir, '..', '..', '..'); // src/sync/github -> repo root

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
  const root = mkdtempSync(join(tmpdir(), 'ztrk-pushclobber-'));
  try {
    initTrackerProject(root, 'ZT');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    const client = createTrackerClient({ projectRoot: root });
    const gh = fakeGithub();
    const opts = (): SyncOpts => ({ projectRoot: root, owner: 'o', repo: 'r', execute: gh.execute, client, occurredAt: '2026-01-01T00:00:00Z' });
    return await fn({ root, client, gh, opts });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export async function runPushClobberScenarios() {
  const results: Record<string, unknown> = {};

  // THE REPRO: an issue exists on both sides (synced once). GitHub closes it (maintainer
  // decision). Independently, the SAME issue is edited locally (e.g. its title, unrelated to the
  // close) before the next `--push`. A naive push (diffing tracker-vs-fresh-pull with no base
  // check) would see "local state != current GitHub state" on this issue and PATCH GitHub back to
  // {title: LOCAL, state: open} — resurrecting a closed issue as a side effect of an unrelated
  // title edit. The fixed push must NOT reopen it: `state` is a same-field-ish cross conflict
  // (closed remotely, never touched locally... but see next scenario for the real same-field
  // case) — here state didn't change locally at all, so push should cleanly take the local title
  // and leave GitHub's closed state alone (non-overlapping fields: title changed locally only,
  // state changed remotely only — MERGE, not conflict).
  results.closeSurvivesUnrelatedLocalEdit = await withProject(async ({ client, gh, opts }) => {
    await gh.execute.request('POST /repos/{owner}/{repo}/issues', { title: 'Title', body: 'Body' });
    await reconcileSync(opts()); // seed: both sides agree, base recorded
    const id = String((await client.issue.list({ state: 'all', json: 'identifier,title' }) as Array<Record<string, unknown>>).find((r) => r.title === 'Title')!.identifier);
    gh.ghEdit(1, { state: 'closed' });                    // GitHub side: maintainer closes it
    await client.issue.edit(id, { title: 'Title EDITED LOCALLY' }); // local side: unrelated title edit
    const r = await push(opts());                          // the CLI's `sync github --push`
    return {
      ghState: gh.issues.get(1)!.state,                    // must STAY closed — not clobbered back to open
      ghTitle: gh.issues.get(1)!.title,                     // the non-conflicting local title change DOES land
      conflicts: r.conflicts.length,
      pushedCount: r.updated.length,
    };
  });

  // THE HARDER CASE: a genuine same-field (title) collision happening ALONGSIDE an independent
  // GitHub close — the shape that most resembles the real regression (a maintainer closes AND
  // renames/retitles an issue while, unaware, a local edit also changes its title). Pre-fix, a
  // naive push diffing tracker-vs-fresh-pull would see "local title != current remote title,
  // tracker wins" and PATCH GitHub with {title: LOCAL, state: open} — reopening the closed issue
  // as a side effect of the title clobber. With the fix: `title` changed on BOTH sides since the
  // last agreed base -> a SURFACED conflict (neither title is touched); `state` changed on
  // GitHub's side only -> cleanly stays closed (not part of the conflict, not reverted).
  results.sameFieldCollisionSurfacedNotClobbered = await withProject(async ({ client, gh, opts }) => {
    await gh.execute.request('POST /repos/{owner}/{repo}/issues', { title: 'Title', body: 'Body' });
    await reconcileSync(opts()); // seed base: both sides agree (open, "Title")
    const id = String((await client.issue.list({ state: 'all', json: 'identifier,title' }) as Array<Record<string, unknown>>).find((r) => r.title === 'Title')!.identifier);
    gh.ghEdit(1, { state: 'closed', title: 'Title FROM REMOTE' }); // GitHub: closes AND retitles
    await client.issue.edit(id, { title: 'Title FROM LOCAL' });    // local: independently retitled
    const r = await push(opts());
    return {
      ghState: gh.issues.get(1)!.state,        // must remain 'closed' — never reverted to open
      ghTitle: gh.issues.get(1)!.title,         // must remain GitHub's own title — never clobbered to LOCAL
      conflicts: r.conflicts.length,            // the title collision is surfaced
      conflictFields: r.conflicts[0]?.fields ?? [],
    };
  });

  return results;
}

if (import.meta.main) {
  runPushClobberScenarios()
    .then((r) => process.stdout.write(JSON.stringify(r)))
    .catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
}
