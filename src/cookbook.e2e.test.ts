// Cookbook: run the DOCUMENTED quick-start recipes verbatim as a black-box CLI sequence, so the
// onboarding can't silently drift red. Hermetic (no network); the linked (`--sync`) recipe is
// covered by the live GitHub e2e. Subprocess-isolated like the other CLI e2es. The recipes here
// must match README "Two ways to start (A)" + the target-grammar block + the fabricated-commit
// demo, and the in-product `ztrack init` next-steps.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-cookbook-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the preset imports 'ztrack/preset-kit'
    // README "Two ways to start (A)" + init next-steps, verbatim:
    expect(zt(['init']).code).toBe(0);
    const scaffold = zt(['issue', 'scaffold', '--title', 'Add /health']);
    expect(scaffold.code).toBe(0);
    writeFileSync(join(root, 'issue.md'), scaffold.out);
    expect(zt(['issue', 'create', '--title', 'Add /health', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', 'issue.md']).code).toBe(0);
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

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
  });

  test('the fabricated-commit DEMO is caught (the README hook)', () => {
    writeFileSync(join(root, 'fake.md'), `Assignee: me\nStatus: ready\n\n## Acceptance Criteria\n\n- [x] dev/01 v1 GET /health returns 200\n  - status: passed\n  - evidence ev1: image=health.png commit=deadbeef acv=1\n  - proof: "screenshot shows a 200 response" -> ev1\n`);
    const r = zt(['check', './fake.md', '--verify-commits']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/deadbeef/);
  });
});
