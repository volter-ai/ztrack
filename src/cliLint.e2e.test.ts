// Black-box e2e for `ztrack lint`'s audible-success summary line and the weak_claim rule,
// against the real CLI (no network). ZTB-20: lint used to print NOTHING on a clean run (0
// findings, silent, exit 0 — indistinguishable from a broken command) and shipped only three
// mechanical rules despite its own help text promising weak/unverifiable-claim detection.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..'); // src/ -> repo root
const CLI = join(import.meta.dir, 'cli.ts');

// The project dir is an explicit parameter, NOT shared module state: bun 1.2.x runs every
// describe's beforeAll before the first test (1.3.x interleaves them per-describe), so a
// shared `let root` would point every test at whichever project the LAST beforeAll created.
function zt(root: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function gitInit(dir: string): void {
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'lint-e2e@test.local'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'lint-e2e'], { cwd: dir });
}

function freshProject(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(dir, 'node_modules', 'ztrack'));
  gitInit(dir);
  return dir;
}

describe('ztrack lint: audible summary line (plain text)', () => {
  let mine = '';
  beforeAll(() => {
    mine = freshProject('ztrk-lint-clean-');
    expect(zt(mine, ['init']).code).toBe(0);
    expect(zt(mine, ['issue', 'create', '--title', 'Clean case', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# x\n\nNothing suspicious here.\n']).code).toBe(0);
  }, 30_000);
  afterAll(() => { if (mine) rmSync(mine, { recursive: true, force: true }); });

  test('a 0-finding run prints a ✓ summary line naming the issue count, and exits 0', () => {
    const r = zt(mine, ['lint']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ ztrack lint: 0 findings across 1 issue\b/);
  });

  test('the summary line is always the LAST line of plain-text output', () => {
    const r = zt(mine, ['lint']);
    const lines = r.out.trim().split('\n');
    expect(lines[lines.length - 1]).toMatch(/^✓ ztrack lint:/);
  });
});

describe('ztrack lint: audible summary line (findings present)', () => {
  let mine = '';
  beforeAll(() => {
    mine = freshProject('ztrk-lint-dirty-');
    expect(zt(mine, ['init']).code).toBe(0);
    const body = '# x\n\n## Notes\n\nAll tests pass. Works perfectly. Fully verified.\n\nTODO: revisit this.\n';
    expect(zt(mine, ['issue', 'create', '--title', 'Suspicious case', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', body]).code).toBe(0);
  }, 30_000);
  afterAll(() => { if (mine) rmSync(mine, { recursive: true, force: true }); });

  test('a finding-bearing run prints a ✗ summary line with the finding + issue counts, exit code unchanged (warn-only stays 0)', () => {
    const r = zt(mine, ['lint']);
    expect(r.out).toMatch(/✗ ztrack lint: \d+ findings across 1 issue\b/);
    expect(r.code).toBe(0); // warn severity, no --fail-on-warn: exit code behavior is unchanged
  });

  test('--fail-on-warn still exits nonzero exactly as before (exit-code contract unchanged)', () => {
    expect(zt(mine, ['lint', '--fail-on-warn']).code).toBe(1);
  });

  test('the weak_claim rule actually fired (dogfooding: this is the exact repro from the work order)', () => {
    const r = zt(mine, ['lint']);
    expect(r.out).toMatch(/weak_claim/);
    expect(r.out).toMatch(/is not backed by cited evidence here/);
  });
});

describe('ztrack lint: --json stays backward compatible', () => {
  let mine = '';
  beforeAll(() => {
    mine = freshProject('ztrk-lint-json-');
    expect(zt(mine, ['init']).code).toBe(0);
    expect(zt(mine, ['issue', 'create', '--title', 'Clean case', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# x\n\nAll good.\n']).code).toBe(0);
  }, 30_000);
  afterAll(() => { if (mine) rmSync(mine, { recursive: true, force: true }); });

  test('--json shape is exactly `{"findings": [...]}` — no summary line, no additive top-level noise', () => {
    const r = zt(mine, ['lint', '--json']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out);
    expect(Object.keys(parsed)).toEqual(['findings']);
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(r.out).not.toMatch(/✓|✗/); // the audible summary is plain-text-only
  });
});
