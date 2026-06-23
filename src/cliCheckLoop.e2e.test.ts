// Black-box e2e for the unified check/loop TARGET surface — runs the real `ztrack` CLI against
// a real markdown tracker (no network). Covers what the daily-driver "check or loop, several
// formats" vision promises: check an issue id / a file / the whole tracker, the not-found and
// missing-file errors (no more silent false-green), and a loop whose armed target drives the
// Stop-hook gate (`check --auto-scope`).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');        // src/ -> repo root
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';

function ztrack(args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const FAILING_AC = `## Acceptance Criteria

- [x] dev/01 v1 does the thing
  - status: passed
  - evidence ev1: image=x.png commit=deadbeef acv=1
  - proof: "shows it" -> ev1
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ztrk-cl-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the preset imports 'ztrack/preset-kit'
  ztrack(['init', '--team', 'ZT']);
  ztrack(['issue', 'create', '--title', 'Clean', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# Clean\n\n## Summary\n\nok']); // ZT-1, green
  ztrack(['issue', 'create', '--title', 'Bad', '--label', 'type:case', '--state', 'ready', '--assignee', 'me', '--body', FAILING_AC]); // ZT-2, red (fake commit)
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('check targets', () => {
  test('an issue id checks just that issue', () => {
    expect(ztrack(['check', 'ZT-1']).code).toBe(0);
  });
  test('a non-existent issue id ERRORS (no silent false-green)', () => {
    const r = ztrack(['check', 'ZT-404']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/not found in the tracker/);
  });
  test('a markdown file is checked as one issue and catches a fabricated commit', () => {
    writeFileSync(join(root, 'loose.md'), `Status: ready\n\n${FAILING_AC}`);
    const r = ztrack(['check', './loose.md', '--verify-commits']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/deadbeef/);
  });
  test('a missing file ERRORS', () => {
    const r = ztrack(['check', './nope.md']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/file not found/);
  });
  test('a bare check validates the WHOLE tracker (the bad ZT-2 fails it, unlike `check ZT-1`)', () => {
    const all = ztrack(['check']);
    expect(all.code).not.toBe(0);            // whole tracker includes the bad issue
    expect(all.out).toMatch(/ZT-2/);
    expect(ztrack(['check', 'ZT-1']).code).toBe(0); // but the clean issue, alone, passes
  });
});

describe('loop target drives the Stop-hook gate', () => {
  test('loop start <id> scopes the gate to that issue (other red issues are informational)', () => {
    expect(ztrack(['loop', 'start', 'ZT-1']).code).toBe(0);
    // ZT-2 is red under --verify-commits, but the armed loop gates on ZT-1 → turn may end.
    expect(ztrack(['check', '--auto-scope', '--verify-commits']).code).toBe(0);
  });
  test('loop start on the red issue gates on it → the turn is held (nonzero)', () => {
    expect(ztrack(['loop', 'start', 'ZT-2']).code).toBe(0);
    expect(ztrack(['check', '--auto-scope', '--verify-commits']).code).not.toBe(0);
  });
  test('loop start <file.md> gates on that file', () => {
    writeFileSync(join(root, 'loop-target.md'), `Status: ready\n\n${FAILING_AC}`);
    expect(ztrack(['loop', 'start', './loop-target.md']).code).toBe(0);
    const r = ztrack(['check', '--auto-scope', '--verify-commits']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/deadbeef/);
    ztrack(['loop', 'stop']);
  });
});
