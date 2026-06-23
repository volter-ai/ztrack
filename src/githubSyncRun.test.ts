// End-to-end proof that `ztrack sync github` is INCREMENTAL + IDEMPOTENT on the twin's
// event-sourced engine — never a full read + full rewrite. These tests drive the REAL twin
// functions (syncGithubFromReal / applyGithubWrite / pushPendingGithubActions, invoked inside
// pullFromGithub/pushToGithub) and a REAL markdown tracker; only the GitHub HTTP boundary is a
// stateful in-memory fake, which also COUNTS write calls so we can assert "zero writes on a
// no-op re-sync" directly.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerClient } from './sdk.ts';
import { initTrackerProject } from './config.ts';
import { pullFromGithub, pushToGithub, type SyncOpts } from './githubSyncRun.ts';
import type { TrackerClient } from './types.ts';

type GhIssue = { number: number; title: string; body: string; state: string };

// A stateful fake GitHub: GET lists every issue, POST creates with the next number, PATCH
// updates. `writeCalls` records each POST/PATCH so a test can prove a re-sync makes none.
function fakeGithub(seed: GhIssue[] = []) {
  const issues = new Map<number, GhIssue>();
  let next = 1;
  for (const i of seed) { issues.set(i.number, i); next = Math.max(next, i.number + 1); }
  const writeCalls: string[] = [];
  const execute = {
    async request(route: string, params: Record<string, unknown> = {}) {
      if (route === 'GET /repos/{owner}/{repo}/issues') return { status: 200, data: [...issues.values()] };
      if (route.startsWith('GET ')) return { status: 200, data: [] }; // comments / labels / timeline
      if (route === 'POST /repos/{owner}/{repo}/issues') {
        writeCalls.push('POST');
        const n = next++;
        const iss: GhIssue = { number: n, title: String(params.title ?? ''), body: String(params.body ?? ''), state: 'open' };
        issues.set(n, iss);
        return { status: 201, data: iss };
      }
      if (route === 'PATCH /repos/{owner}/{repo}/issues/{issue_number}') {
        writeCalls.push('PATCH');
        const n = Number(params.issue_number);
        const cur = issues.get(n) ?? { number: n, title: '', body: '', state: 'open' };
        const iss: GhIssue = {
          ...cur,
          ...('title' in params ? { title: String(params.title) } : {}),
          ...('body' in params ? { body: String(params.body) } : {}),
          ...('state' in params ? { state: String(params.state) } : {}),
        };
        issues.set(n, iss);
        return { status: 200, data: iss };
      }
      throw new Error(`fakeGithub: unhandled route ${route}`);
    },
  };
  return { execute, issues, writeCalls };
}

describe('github sync e2e (twin engine, faked HTTP boundary)', () => {
  let root: string;
  let client: TrackerClient;
  let gh: ReturnType<typeof fakeGithub>;
  // a fresh, monotonic occurredAt per sync invocation (the value is only used for non-fold
  // bookkeeping; the fold itself uses the module's stable OBSERVED_AT sentinel).
  let clock = 0;
  const sync = (): SyncOpts => ({ projectRoot: root, owner: 'o', repo: 'r', execute: gh.execute, client, occurredAt: new Date(Date.UTC(2026, 1, 1, 0, 0, ++clock)).toISOString() });
  const writes = () => gh.writeCalls.length;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-sync-e2e-'));
    initTrackerProject(root, 'ZT');
    client = createTrackerClient({ projectRoot: root });
    clock = 0;
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('PULL is incremental: a new GitHub issue creates one local issue; re-pull is a no-op', async () => {
    gh = fakeGithub([{ number: 1, title: 'From GitHub', body: 'gh body', state: 'open' }]);

    const p1 = await pullFromGithub(sync());
    expect(p1.created).toHaveLength(1);
    expect(p1.updated).toHaveLength(0);

    // re-pull identical state -> the twin folds nothing -> the tracker is not rewritten
    const p2 = await pullFromGithub(sync());
    expect(p2.created).toHaveLength(0);
    expect(p2.updated).toHaveLength(0);
  });

  test('PUSH is idempotent: a new local issue is created once; an unchanged re-push fires ZERO GitHub writes', async () => {
    gh = fakeGithub();
    await client.issue.create({ title: 'Local one', body: 'local body', state: 'draft' });

    const before = writes();
    const push1 = await pushToGithub(sync());
    expect(push1.created).toHaveLength(1);
    expect(writes() - before).toBe(1); // exactly one POST

    // nothing changed -> no pending action -> the GitHub API is never called for a write
    const before2 = writes();
    const push2 = await pushToGithub(sync());
    expect(push2.created).toHaveLength(0);
    expect(push2.updated).toHaveLength(0);
    expect(writes() - before2).toBe(0);
  });

  test('PUSH writes ONLY the changed issue: editing one of two issues fires exactly one PATCH', async () => {
    gh = fakeGithub();
    await client.issue.create({ title: 'Alpha', body: 'a', state: 'draft' });
    await client.issue.create({ title: 'Beta', body: 'b', state: 'draft' });
    const created = (await pushToGithub(sync())).created;
    expect(created).toHaveLength(2);

    const alpha = created.find((c) => c)!; // first created — edit it, leave the other untouched
    await client.issue.edit(alpha.ztrack, { title: 'Alpha EDITED' });

    const before = writes();
    const push = await pushToGithub(sync());
    expect(push.updated).toHaveLength(1);
    expect(writes() - before).toBe(1); // one PATCH, not two
    expect([...gh.issues.values()].some((i) => i.title === 'Alpha EDITED')).toBe(true);
  });

  test('PULL applies an external GitHub edit back into the tracker, then re-pull is a no-op', async () => {
    gh = fakeGithub();
    await client.issue.create({ title: 'Local', body: 'orig', state: 'draft' });
    const num = (await pushToGithub(sync())).created[0]!.number; // binding now persisted

    // someone edits the issue on GitHub directly
    const ext = gh.issues.get(num)!;
    gh.issues.set(num, { ...ext, body: 'changed on github' });

    const before = writes();
    const p = await pullFromGithub(sync());
    expect(p.updated).toHaveLength(1);
    expect(p.created).toHaveLength(0);
    expect(writes() - before).toBe(0); // pull performs no GitHub writes

    const view = await client.issue.list({ state: 'all', json: 'identifier,body' }) as Array<Record<string, unknown>>;
    expect(view.some((i) => String(i.body ?? '').includes('changed on github'))).toBe(true);

    const p2 = await pullFromGithub(sync());
    expect(p2.updated).toHaveLength(0);
    expect(p2.created).toHaveLength(0);
  });

  test('done -> closed round trip: marking a tracker issue done closes the GitHub issue, idempotently', async () => {
    gh = fakeGithub();
    await client.issue.create({ title: 'Closable', body: 'x', state: 'draft' });
    const { number, ztrack } = (await pushToGithub(sync())).created[0]!;
    expect(gh.issues.get(number)!.state).toBe('open');

    await client.issue.edit(ztrack, { state: 'done' });
    const before = writes();
    const push = await pushToGithub(sync());
    expect(push.updated).toHaveLength(1);
    expect(writes() - before).toBe(1);
    expect(gh.issues.get(number)!.state).toBe('closed');

    // re-push after the close -> nothing pending -> zero further writes
    const before2 = writes();
    await pushToGithub(sync());
    expect(writes() - before2).toBe(0);
  });
});
