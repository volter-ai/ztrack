// REAL end-to-end test: drives the actual `ztrack` CLI as a black box against a LIVE,
// throwaway GitHub repository. No fakes — the real gh-authenticated transport, the real twin,
// the real markdown tracker, real GitHub issues. It creates a private repo in beforeAll and
// deletes it in afterAll, so it MUST be opted into explicitly and needs a gh login with the
// `repo` + `delete_repo` scopes:
//
//     ZTRACK_GITHUB_E2E=1 bun test src/sync/github/e2e.test.ts
//
// Without the flag it skips (a hermetic CI cannot create real repos). It proves the user-facing
// command actually works AND is incremental + idempotent on live infrastructure: a re-push makes
// no second issue, a pull brings a GitHub-made issue into the tracker, edits/closes round-trip.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENABLED = process.env.ZTRACK_GITHUB_E2E === '1';
const suite = ENABLED ? describe : describe.skip;

const CLI = join(import.meta.dir, '..', '..', 'cli.ts'); // src/sync/github -> src/cli.ts

function gh(args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
// Run the real ztrack CLI inside the temp tracker project (projectRootFrom walks up from cwd).
function ztrack(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const ghIssues = (repo: string) => JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--json', 'number,title,state,body']).out || '[]') as Array<{ number: number; title: string; state: string; body: string }>;
const createId = (out: string) => (/\b([A-Z]+-\d+)\b/.exec(out)?.[1]) ?? '';

suite('ztrack sync github — live e2e', () => {
  let owner = '';
  let repo = '';
  let root = '';

  beforeAll(() => {
    owner = gh(['api', 'user', '--jq', '.login']).out;
    expect(owner).toBeTruthy();
    // a unique throwaway repo; Date.now is fine in a normal test (not a workflow script).
    repo = `${owner}/ztrack-e2e-${Date.now()}`;
    const made = gh(['repo', 'create', repo, '--private']);
    expect(made.ok).toBe(true);
    root = mkdtempSync(join(tmpdir(), 'ztrk-e2e-'));
    const init = ztrack(root, ['init', '--team', 'ZT']);
    expect(init.ok).toBe(true);
  });

  afterAll(() => {
    if (repo) gh(['repo', 'delete', repo, '--yes']);
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('push creates the tracker issue as a real GitHub issue', () => {
    const c = ztrack(root, ['issue', 'create', '--title', 'Pushed from ztrack', '--body', 'hello github', '--state', 'draft']);
    expect(c.ok).toBe(true);
    const push = ztrack(root, ['sync', 'github', '--repo', repo, '--push', '--json']);
    expect(push.ok).toBe(true);
    const live = ghIssues(repo);
    const found = live.find((i) => i.title === 'Pushed from ztrack');
    expect(found).toBeTruthy();
    expect(found!.state.toLowerCase()).toBe('open');
  });

  test('re-push is idempotent — no second GitHub issue is created', () => {
    const before = ghIssues(repo).length;
    const push = ztrack(root, ['sync', 'github', '--repo', repo, '--push', '--json']);
    expect(push.ok).toBe(true);
    const report = JSON.parse(push.out.slice(push.out.indexOf('{'))) as { push?: { created: unknown[]; updated: unknown[] } };
    expect(report.push?.created ?? []).toHaveLength(0); // nothing new pushed
    expect(ghIssues(repo).length).toBe(before);          // GitHub unchanged
  });

  test('pull brings a GitHub-created issue into the tracker', () => {
    const made = gh(['issue', 'create', '--repo', repo, '--title', 'Filed on GitHub', '--body', 'came from gh']);
    expect(made.ok).toBe(true);
    // GitHub's REST list endpoint (what the twin folds from) lags a just-created issue by a few
    // seconds — poll the real pull until it propagates. Idempotency means extra pulls are no-ops.
    let landed = false;
    let lastErr = '';
    for (let i = 0; i < 10 && !landed; i++) {
      const p = ztrack(root, ['sync', 'github', '--repo', repo, '--pull']);
      if (!p.ok) lastErr = p.err;
      const list = JSON.parse(ztrack(root, ['issue', 'list', '--state', 'all', '--json', 'identifier,title']).out || '[]') as Array<{ title: string }>;
      landed = list.some((it) => it.title === 'Filed on GitHub');
      if (!landed) Bun.sleepSync(2500);
    }
    expect(landed, `issue never propagated; last pull error: ${lastErr}`).toBe(true);
  }, 60_000);

  test('edit round-trips: editing the tracker issue updates the GitHub issue title', () => {
    const list = JSON.parse(ztrack(root, ['issue', 'list', '--state', 'all', '--json', 'identifier,title']).out || '[]') as Array<{ identifier: string; title: string }>;
    const target = list.find((i) => i.title === 'Pushed from ztrack')!;
    expect(ztrack(root, ['issue', 'edit', target.identifier, '--title', 'Pushed from ztrack (edited)']).ok).toBe(true);
    expect(ztrack(root, ['sync', 'github', '--repo', repo, '--push']).ok).toBe(true);
    expect(ghIssues(repo).some((i) => i.title === 'Pushed from ztrack (edited)')).toBe(true);
  });

  test('init --sync links the repo: config records it, initial pull runs, sync needs no --repo', () => {
    const linked = mkdtempSync(join(tmpdir(), 'ztrk-linked-'));
    try {
      const init = ztrack(linked, ['init', '--team', 'LK', '--sync', 'github', '--repo', repo]);
      expect(init.ok).toBe(true);
      const cfg = JSON.parse(readFileSync(join(linked, '.volter', 'tracker-config.json'), 'utf8')) as { sync?: unknown };
      expect(cfg.sync).toEqual({ provider: 'github', repo });
      // a bare `sync github` (no --repo) resolves the repo from the link
      expect(ztrack(linked, ['sync', 'github', '--pull']).ok).toBe(true);
    } finally {
      rmSync(linked, { recursive: true, force: true });
    }
  });

  test('done -> closed: marking the tracker issue done closes the GitHub issue', () => {
    const list = JSON.parse(ztrack(root, ['issue', 'list', '--state', 'all', '--json', 'identifier,title']).out || '[]') as Array<{ identifier: string; title: string }>;
    const target = list.find((i) => i.title === 'Pushed from ztrack (edited)')!;
    expect(ztrack(root, ['issue', 'edit', target.identifier, '--state', 'done']).ok).toBe(true);
    expect(ztrack(root, ['sync', 'github', '--repo', repo, '--push']).ok).toBe(true);
    const closed = ghIssues(repo).find((i) => i.title === 'Pushed from ztrack (edited)');
    expect(closed!.state.toLowerCase()).toBe('closed');
  });
});
