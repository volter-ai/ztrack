// LINKED (real GitHub) development simulation — the linked twin of simulateProject.ts. Proves
// ztrack holds up when the tracker IS a real GitHub repo, at scale: seed N feature issues on a
// throwaway repo, `init --sync` to pull them, develop each (the same adversarial gate — a FAKE
// completion must be caught, the real one must pass) and PUSH the result back so GitHub reflects
// it, then drive a real reconcile CONFLICT (concurrent local + GitHub edit) that must gate `check`
// until resolved, and confirm a settled re-sync is idempotent. Tears the repo down.
//
// Needs gh auth (repo + delete_repo). Run: bun run src/testkit/simulateLinkedProject.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const N = Number(process.env.SIM_FEATURES ?? 12);
const VERIFY = '--verify-commits';

type Res = { code: number; out: string };
const sh = (cwd: string, cmd: string, args: string[]): Res => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const git = (cwd: string, ...a: string[]) => sh(cwd, 'git', a);
const zt = (cwd: string, ...a: string[]) => sh(cwd, 'bun', ['run', CLI, ...a]);
const gh = (...a: string[]) => sh(REPO, 'gh', a);
const log = (m: string) => process.stdout.write(`${m}\n`);
const sleep = (ms: number) => Bun.sleepSync(ms);

const AC = (box: string, lines: string) => `Summary: feature work.\n\n## Acceptance Criteria\n\n- ${box} dev/01 v1 the observable outcome\n${lines}`;
const realBody = (sha: string) => AC('[x]', `  - status: passed\n  - evidence ev1: image=ev.png commit=${sha} acv=1\n  - proof: "ev1 demonstrates the outcome" -> ev1\n`);
const CHEATS: Record<string, (sha: string) => string> = {
  fakeCommit: () => AC('[x]', '  - status: passed\n  - evidence ev1: image=ev.png commit=deadbeef99 acv=1\n  - proof: "ev1 shows it" -> ev1\n'),
  noEvidence: () => AC('[x]', '  - status: passed\n'),
  noProof: (sha) => AC('[x]', `  - status: passed\n  - evidence ev1: image=ev.png commit=${sha} acv=1\n`),
};
const CHEAT_NAMES = Object.keys(CHEATS);

function listIds(root: string): string[] {
  try { return (JSON.parse(zt(root, 'issue', 'list', '--state', 'all', '--json', 'identifier').out || '[]') as Array<{ identifier: string }>).map((i) => i.identifier); } catch { return []; }
}

async function main() {
  const start = Date.now();
  if (!gh('auth', 'status').out.match(/Logged in/i)) { log('SKIP: gh not authenticated'); process.exit(0); }
  const owner = gh('api', 'user', '--jq', '.login').out.trim();
  const repo = `${owner}/ztrack-linksim-${process.pid}${Date.now() % 100000}`;
  log(`# linked simulation: ${N} features on a real GitHub repo ${repo}`);
  if (gh('repo', 'create', repo, '--private').code !== 0) { log('FAILED: repo create'); process.exit(1); }
  let pass = true; const fail = (m: string) => { pass = false; log(`  ✗ ${m}`); };
  try {
    for (let i = 1; i <= N; i++) gh('issue', 'create', '--repo', repo, '--title', `Feature ${i}`, '--body', `Spec for feature ${i}.`);
    log(`seeded ${N} GitHub issues`);

    const root = mkdtempSync(join(tmpdir(), 'ztrk-linksim-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    git(root, 'init', '-q'); git(root, 'config', 'user.email', 's@s.co'); git(root, 'config', 'user.name', 's');
    writeFileSync(join(root, 'README.md'), '# proj\n'); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base');
    zt(root, 'init', '--team', 'PROJ', '--sync', 'github', '--repo', repo);

    // PULL AT SCALE — poll past GitHub's REST list lag until all N issues land
    let ids: string[] = [];
    for (let t = 0; t < 20 && ids.length < N; t++) { zt(root, 'sync', 'github', '--pull'); ids = listIds(root); if (ids.length < N) sleep(3000); }
    log(`pulled ${ids.length}/${N} issues from GitHub`);
    if (ids.length < N) fail(`pull incomplete (${ids.length}/${N})`);

    // DEVELOP + PUSH each: the gate (loop marker + --auto-scope) verifies LOCALLY without
    // auto-syncing (so an in-progress fake never reaches GitHub); the explicit sync pushes the
    // finished, real work. A FAKE must be caught; the real completion must pass.
    let caught = 0; let passed = 0; let reflected = 0;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k]!; const cheat = CHEAT_NAMES[k % CHEAT_NAMES.length]!;
      writeFileSync(join(root, `src-${id}.ts`), `export const f${k} = true;\n`);
      git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', `impl ${id}`);
      const sha = git(root, 'rev-parse', 'HEAD').out.trim();
      zt(root, 'loop', 'start', id); // pin the gate to this issue; --auto-scope does NOT auto-sync
      writeFileSync(join(root, 'e.md'), CHEATS[cheat]!(sha));
      zt(root, 'issue', 'edit', id, '--assignee', 'me', '--state', 'ready', '--body-file', 'e.md');
      if (zt(root, 'check', '--auto-scope', VERIFY).code !== 0) caught++; else fail(`FAKE on ${id} [${cheat}] slipped`);
      writeFileSync(join(root, 'e.md'), realBody(sha));
      zt(root, 'issue', 'edit', id, '--assignee', 'me', '--state', 'ready', '--body-file', 'e.md');
      if (zt(root, 'check', '--auto-scope', VERIFY).code === 0) passed++; else fail(`REAL ${id} falsely flagged`);
      zt(root, 'loop', 'stop');
      zt(root, 'sync', 'github'); // push the finished, real work to GitHub
      if (k % 4 === 0) log(`  …developed ${k + 1}/${ids.length}`);
    }
    // GitHub must actually reflect the pushed work (every issue body now carries the AC + evidence).
    // Poll past GitHub's eventual consistency on the list endpoint.
    for (let t = 0; t < 10 && reflected < ids.length; t++) {
      const list = JSON.parse(gh('issue', 'list', '--repo', repo, '--state', 'all', '--json', 'body', '--limit', '100').out || '[]') as Array<{ body: string }>;
      reflected = list.filter((i) => i.body?.includes('## Acceptance Criteria')).length;
      if (reflected < ids.length) sleep(3000);
    }
    log(`developed: fakes-caught ${caught}/${ids.length}, real-passed ${passed}/${ids.length}, GitHub bodies updated ${reflected}/${ids.length}`);
    if (caught < ids.length || passed < ids.length) fail(`gate: caught ${caught}, passed ${passed} of ${ids.length}`);
    if (reflected < ids.length) fail(`only ${reflected}/${ids.length} issues reflected on GitHub`);

    // IDEMPOTENT re-sync — the sync must CONVERGE to 0 pulled / 0 pushed. The first re-sync right
    // after a push can still report a push (GitHub's since-filtered list lags the just-pushed
    // change, so the connector momentarily sees stale state); the egress ledger makes the actual
    // PATCH idempotent, so it settles. Poll until it converges (real bug = never converges).
    let idempotent = false;
    for (let t = 0; t < 6 && !idempotent; t++) {
      const again = JSON.parse((zt(root, 'sync', 'github', '--json').out.match(/\{[\s\S]*\}/) ?? ['{}'])[0]) as { reconcile?: { pulled: unknown[]; pushed: unknown[] } };
      idempotent = (again.reconcile?.pulled?.length ?? 0) === 0 && (again.reconcile?.pushed?.length ?? 0) === 0;
      if (!idempotent) sleep(4000);
    }
    if (idempotent) log('  ✓ re-sync converges to idempotent (0 pulled, 0 pushed)'); else fail('re-sync never converged to idempotent');

    // RECONCILE CONFLICT over the real wire (BEST-EFFORT — depends on GitHub's REST list
    // reflecting the remote edit before the connector polls; the conflict logic itself is proven
    // deterministically in reconcile.e2e). Concurrent local + GitHub edit of the same title.
    const cid = ids[0]!; const cnum = cid.replace('PROJ-', '');
    zt(root, 'issue', 'edit', cid, '--title', 'Title FROM LOCAL');
    gh('issue', 'edit', cnum, '--repo', repo, '--title', 'Title FROM REMOTE');
    sleep(8000); // let GitHub's since-filtered list reflect the remote edit
    zt(root, 'sync', 'github'); // bidirectional reconcile (merge)
    const conflicted = zt(root, 'check', cid).out.includes('sync_conflict') || zt(root, 'check', cid).code !== 0;
    if (conflicted) {
      log(`  ✓ concurrent edit surfaced a conflict on ${cid} and gated check`);
      zt(root, 'sync', 'github', '--policy', 'hub-wins'); // resolve: take GitHub
      if (!zt(root, 'check', cid).out.includes('sync_conflict')) log(`  ✓ conflict resolved (hub-wins) → no longer gating`); else fail(`conflict not cleared after resolve`);
    } else {
      log(`  ~ concurrent edit did not surface a conflict this run (GitHub REST lag); reconcile is covered deterministically by reconcile.e2e`);
    }

    rmSync(root, { recursive: true, force: true });
  } finally {
    gh('repo', 'delete', repo, '--yes');
  }
  log(`\n# RESULT (${Math.round((Date.now() - start) / 1000)}s)`);
  log(`LINKED SIMULATION ${pass ? 'PASSED ✓ — real-GitHub sync + reconcile held up at scale' : 'FAILED ✗'}`);
  process.exit(pass ? 0 : 1);
}

if (import.meta.main) main();
