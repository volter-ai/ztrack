// Cookbook: run the DOCUMENTED quick-start recipes verbatim as a black-box CLI sequence, so the
// onboarding can't silently drift red. Hermetic (no network); the linked (`--sync`) recipe is
// covered by the live GitHub e2e. Subprocess-isolated like the other CLI e2es. The recipes here
// must match README "Two ways to start (A)" + the target-grammar block + the fabricated-commit
// demo, and the in-product `ztrack init` next-steps.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');         // src/ -> repo root
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';

function zt(args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('cookbook: the documented local getting-started recipe', () => {
  // Each describe owns an isolated root; `beforeEach` restores the shared `root` (used by zt) to
  // it before every test, so the other describe's beforeAll reassigning `root` can't make a test
  // run against the wrong/cleaned-up cwd (a non-deterministic cross-describe race in CI).
  let mine = '';
  beforeAll(() => {
    mine = mkdtempSync(join(tmpdir(), 'ztrk-cookbook-')); root = mine;
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the preset imports 'ztrack/preset-kit'
    // README "Two ways to start (A)" + init next-steps, verbatim:
    expect(zt(['init']).code).toBe(0);
    const scaffold = zt(['issue', 'scaffold', '--title', 'Add /health']);
    expect(scaffold.code).toBe(0);
    writeFileSync(join(root, 'issue.md'), scaffold.out);
    expect(zt(['issue', 'create', '--title', 'Add /health', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', 'issue.md']).code).toBe(0);
  }, 30_000); // init+scaffold+create = 3 cold `bun run` spawns; exceeds bun's 5s hook default under load
  beforeEach(() => { root = mine; });
  afterAll(() => { if (mine) rmSync(mine, { recursive: true, force: true }); });

  test('`ztrack check` on the scaffolded issue is GREEN (a getting-started recipe must not end red)', () => {
    expect(zt(['check']).code).toBe(0);
  });

  test('`ztrack check <id>` is green (default init ids are LOCAL-N)', () => {
    expect(zt(['check', 'LOCAL-1']).code).toBe(0);
  });

  test('`ztrack check ./file.md` is green when the file carries its metadata', () => {
    writeFileSync(join(root, 'withmeta.md'), `Assignee: me\nStatus: draft\n\n${readFileSync(join(root, 'issue.md'), 'utf8')}`);
    expect(zt(['check', './withmeta.md']).code).toBe(0);
  });

  test('`ztrack loop start <id>` then the gate is green for a passing issue', () => {
    expect(zt(['loop', 'start', 'LOCAL-1']).code).toBe(0);
    expect(zt(['check', '--auto-scope']).code).toBe(0);
    zt(['loop', 'stop']);
  }, 30_000); // 3 cold `bun run` spawns exceed bun's 5s default under load (like the sibling tests)

  test('the fabricated-commit DEMO is caught (the README hook)', () => {
    writeFileSync(join(root, 'fake.md'), `Assignee: me\nStatus: ready\n\n## Acceptance Criteria\n\n- [x] dev/01 v1 GET /health returns 200\n  - status: passed\n  - evidence ev1: image=health.png commit=deadbeef acv=1\n  - proof: "screenshot shows a 200 response" -> ev1\n`);
    const r = zt(['check', './fake.md', '--verify-commits']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/deadbeef/);
  });
});

// Every command line we TEACH (README + help + docs) must actually run and the help must match
// reality — caught `ac --help` teaching the removed check/uncheck/set-status DSL and `check --help`
// shadowing the real target-grammar usage with a stale copy.
describe('cookbook: the full taught command surface', () => {
  let mine = '';
  beforeAll(() => {
    mine = mkdtempSync(join(tmpdir(), 'ztrk-cookbook-surface-')); root = mine;
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    expect(zt(['init']).code).toBe(0);
    writeFileSync(join(root, 'body.md'), zt(['issue', 'scaffold', '--title', 'First case']).out);
    expect(zt(['issue', 'create', '--title', 'First case', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', 'body.md']).code).toBe(0);
  }, 30_000); // init+scaffold+create = 3 cold `bun run` spawns; exceeds bun's 5s hook default under load
  beforeEach(() => { root = mine; });
  afterAll(() => { if (mine) rmSync(mine, { recursive: true, force: true }); });

  test('help matches reality (no stale/shadowed usage)', () => {
    const ac = zt(['ac', '--help']).out;
    expect(ac).toMatch(/ac patch/);
    expect(ac).not.toMatch(/check\|uncheck\|set-status/);   // the removed DSL
    const check = zt(['check', '--help']).out;
    expect(check).toMatch(/<issue-id> \| <file\.md>/);       // the real target grammar, not the stale short copy
    expect(check).toMatch(/--auto-scope/);
    expect(zt(['issue', '--help']).out).toMatch(/patch/);
  }, 30_000);

  test('read commands run', () => {
    for (const args of [['issue', 'list'], ['issue', 'view', 'LOCAL-1'], ['export'], ['export', '--out', 'root.json'], ['lint'], ['completions', 'bash']]) {
      expect(zt(args).code, `\`ztrack ${args.join(' ')}\` should run`).toBe(0);
    }
    expect(zt(['completions', 'bash']).out.length).toBeGreaterThan(0);
  }, 30_000);

  test('loop lifecycle runs', () => {
    expect(zt(['loop', 'start', 'LOCAL-1']).code).toBe(0);
    expect(zt(['loop', 'status']).code).toBe(0);
    expect(zt(['loop', 'stop']).code).toBe(0);
  }, 30_000); // 3 cold `bun run` spawns exceed bun's 5s default under load (like the sibling tests)

  test('sync with no link errors helpfully (not a crash)', () => {
    const r = zt(['sync', 'github']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/--repo|init --sync/);
  });

  test('server commands are recognized (not "unknown command") — help is testable; the servers aren\'t', () => {
    // mcp serve / visualizer are long-running; assert they are KNOWN commands via their help.
    expect(zt(['visualizer', '--help']).code).toBe(0);
    expect(zt(['visualizer', '--help']).out).toMatch(/visualizer/);
    expect(zt(['mcp', '--help']).out).not.toMatch(/unknown/i);
  }, 30_000);

  test('mutation commands run (last — they dirty the issue): patch, ac patch, fmt, waiver', () => {
    expect(zt(['issue', 'patch', 'LOCAL-1', '--json', '{"status":"ready"}']).code).toBe(0);
    expect(zt(['ac', 'patch', 'LOCAL-1', 'dev/01', '--json', '{"checked":true,"status":"passed"}']).code).toBe(0);
    expect(zt(['fmt', '--issue', 'LOCAL-1']).code).toBe(0);
    // a checked AC with no evidence now fails check; `waiver sign` (taught in the README) records
    // an acknowledgement for one finding code, then `waiver status` lists it.
    expect(zt(['waiver', 'sign', 'LOCAL-1', '--code', 'checked_ac_no_evidence', '--reason', 'demo']).code).toBe(0);
    expect(zt(['waiver', 'status', 'LOCAL-1']).code).toBe(0);
  }, 30_000);
});
