// FULL-SCALE development simulation — the real test of ztrack's job (you can't claim done
// falsely). Builds a real git project, creates N feature issues, and develops them across K
// PARALLEL worktrees. Each feature goes through the lifecycle an agent actually runs:
//   loop start → implement (a real commit) → ATTEMPT A FAKE completion → the gate MUST catch it
//   → fix with real evidence → the gate MUST pass → done.
// The fake cycles an adversarial cheat corpus (fake commit / no evidence / no proof / checkbox
// mismatch), so every feature stresses a different way to game the check. Any fake that slips
// through (gate green on a fake) or any real work falsely flagged is a ztrack FAILURE.
//
// Run: SIM_FEATURES=25 SIM_STREAMS=4 bun run src/testkit/simulateProject.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const FEATURES = Number(process.env.SIM_FEATURES ?? 25);
const STREAMS = Number(process.env.SIM_STREAMS ?? 4);

type Res = { code: number; out: string };
const sh = (cwd: string, cmd: string, args: string[]): Res => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const git = (cwd: string, ...a: string[]) => sh(cwd, 'git', a);
const zt = (cwd: string, ...a: string[]) => sh(cwd, 'bun', ['run', CLI, ...a]);

// serialize git ref writes across worktrees (the shared object/ref store); ztrack ops stay concurrent.
let gitGate: Promise<unknown> = Promise.resolve();
const withGit = <T>(fn: () => T): Promise<T> => { const run = gitGate.then(fn); gitGate = run.catch(() => {}); return run; };

const AC = (box: string, lines: string) => `Summary: feature work.\n\n## Acceptance Criteria\n\n- ${box} dev/01 v1 the observable outcome\n${lines}`;
const pendingBody = AC('[ ]', '  - status: pending\n');
const realBody = (sha: string) => AC('[x]', `  - status: passed\n  - evidence ev1: commit=${sha} acv=1\n  - proof: "ev1 demonstrates the outcome" -> ev1\n`);
// the adversarial cheat corpus — each MUST be caught by `check --auto-scope` (commit verification
// is on by default).
const CHEATS: Record<string, (sha: string) => string> = {
  fakeCommit: () => AC('[x]', '  - status: passed\n  - evidence ev1: commit=deadbeef99 acv=1\n  - proof: "ev1 shows it" -> ev1\n'),
  noEvidence: () => AC('[x]', '  - status: passed\n'),
  noProof: (sha) => AC('[x]', `  - status: passed\n  - evidence ev1: commit=${sha} acv=1\n`),
  checkboxMismatch: (sha) => AC('[ ]', `  - status: passed\n  - evidence ev1: commit=${sha} acv=1\n  - proof: "ev1 shows it" -> ev1\n`),
};
const CHEAT_NAMES = Object.keys(CHEATS);

type FeatureResult = { id: string; cheat: string; caughtFake: boolean; realPassed: boolean; ms: number };
const log = (m: string) => process.stdout.write(`${m}\n`);

async function develop(wt: string, id: string, cheat: string): Promise<FeatureResult> {
  const t0 = Date.now();
  await withGit(() => git(wt, 'checkout', '-q', '-B', `feat/${id}`));
  zt(wt, 'loop', 'start', id);
  // implement: a real code change → a real commit (its SHA is the legitimate evidence)
  writeFileSync(join(wt, `src-${id}.ts`), `// implementation of ${id}\nexport const ${id.replace('-', '_')} = true;\n`);
  const sha = (await withGit(() => { git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', `impl ${id}`); return git(wt, 'rev-parse', 'HEAD'); })).out.trim();

  // 1) attempt a FAKE completion — the gate must REJECT it
  writeFileSync(join(wt, 'edit.md'), CHEATS[cheat]!(sha));
  zt(wt, 'issue', 'edit', id, '--body-file', 'edit.md');
  const fake = zt(wt, 'check', '--auto-scope');
  const caughtFake = fake.code !== 0;

  // 2) fix with real evidence — the gate must ACCEPT it
  writeFileSync(join(wt, 'edit.md'), realBody(sha));
  zt(wt, 'issue', 'edit', id, '--body-file', 'edit.md');
  const real = zt(wt, 'check', '--auto-scope');
  const realPassed = real.code === 0;

  zt(wt, 'loop', 'stop');
  await withGit(() => { git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', `done ${id}`); });
  const r = { id, cheat, caughtFake, realPassed, ms: Date.now() - t0 };
  log(`  ${id} [${cheat}] fake-caught=${caughtFake ? '✓' : '✗ SLIPPED'} real-passed=${realPassed ? '✓' : '✗ FALSE-FLAG'} (${r.ms}ms)`);
  return r;
}

async function main() {
  const start = Date.now();
  log(`# simulating ${FEATURES} features across ${STREAMS} parallel worktrees`);
  const root = mkdtempSync(join(tmpdir(), 'ztrk-sim-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 's@s.co'); git(root, 'config', 'user.name', 's');
  writeFileSync(join(root, 'README.md'), '# project\n'); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base');
  zt(root, 'init', '--team', 'PROJ');

  // backlog: N draft feature issues (pending AC = nothing claimed yet → green), committed
  const ids: string[] = [];
  for (let i = 0; i < FEATURES; i++) {
    writeFileSync(join(root, 'seed.md'), pendingBody);
    const out = zt(root, 'issue', 'create', '--title', `Feature ${i + 1}`, '--label', 'type:case', '--state', 'ready', '--assignee', 'dev', '--body-file', 'seed.md').out;
    ids.push((/\bPROJ-\d+\b/.exec(out)?.[0]) ?? '');
  }
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'backlog');
  log(`backlog created: ${ids.length} issues`);

  // K worktrees, each a parallel developer pulling from a shared feature queue
  const queue = ids.map((id, i) => ({ id, cheat: CHEAT_NAMES[i % CHEAT_NAMES.length]! }));
  let next = 0;
  const results: FeatureResult[] = [];
  const developer = async (k: number) => {
    const wt = join(root, `..`, `wt-${k}-${process.pid}`);
    await withGit(() => git(root, 'worktree', 'add', '-q', '-b', `stream-${k}`, wt, 'HEAD'));
    mkdirSync(join(wt, 'node_modules'), { recursive: true });
    try { symlinkSync(REPO, join(wt, 'node_modules', 'ztrack')); } catch { /* */ }
    for (;;) {
      const item = queue[next++];
      if (!item) break;
      results.push(await develop(wt, item.id, item.cheat));
    }
    await withGit(() => git(wt, 'checkout', '-q', `stream-${k}`));
  };
  await Promise.all(Array.from({ length: STREAMS }, (_, k) => developer(k)));

  // integrate every stream into main, then verify the whole project
  for (let k = 0; k < STREAMS; k++) await withGit(() => git(root, 'merge', '-q', '--no-edit', `stream-${k}`));
  const finalAll = zt(root, 'check');

  const slipped = results.filter((r) => !r.caughtFake);
  const falseFlags = results.filter((r) => !r.realPassed);
  log(`\n# RESULT (${Math.round((Date.now() - start) / 1000)}s)`);
  log(`features:        ${results.length}/${FEATURES}`);
  log(`fakes caught:    ${results.length - slipped.length}/${results.length}`);
  log(`real passed:     ${results.length - falseFlags.length}/${results.length}`);
  log(`fakes SLIPPED:   ${slipped.length}  ${slipped.map((s) => `${s.id}[${s.cheat}]`).join(', ')}`);
  log(`false flags:     ${falseFlags.length}  ${falseFlags.map((s) => s.id).join(', ')}`);
  log(`final whole-tracker check (all verified): ${finalAll.code === 0 ? 'GREEN ✓' : 'RED ✗'}`);
  const passed = slipped.length === 0 && falseFlags.length === 0 && finalAll.code === 0 && results.length === FEATURES;
  log(`\nSIMULATION ${passed ? 'PASSED ✓ — ztrack correctly gated every feature at scale' : 'FAILED ✗'}`);
  try { for (let k = 0; k < STREAMS; k++) git(root, 'worktree', 'remove', '--force', join(root, '..', `wt-${k}-${process.pid}`)); } catch { /* */ }
  rmSync(root, { recursive: true, force: true });
  process.exit(passed ? 0 : 1);
}

if (import.meta.main) main();
