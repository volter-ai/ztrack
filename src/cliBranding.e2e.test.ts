// ZTB-18 dev/39: two user-facing strings still said "tracker" instead of "ztrack" (a first-touch
// branding trap — the CLI is invoked as `ztrack`, so an error naming a different tool reads like a
// bug/typo). Regression coverage runs the real CLI to the exact conditions that print each string.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });

describe('branding: "tracker" error strings say "ztrack" (ZTB-18 dev/39)', () => {
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-branding-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    gitIn(root, 'init', '-q');
    gitIn(root, 'config', 'user.email', 't@t.co');
    gitIn(root, 'config', 'user.name', 't');
    ztrackIn(root, ['init', '--team', 'ZT']);
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('`fmt --check` on a non-canonical body says "run ztrack fmt --write" (cli.ts:183)', () => {
    const scaffold = ztrackIn(root, ['issue', 'scaffold', '--title', 'First']).out;
    // Two extra trailing blank lines round-trip differently through the preset's serializer —
    // a reliable, content-agnostic way to force a real NOT-canonical result.
    writeFileSync(join(root, 'body.md'), `${scaffold}\n\n`);
    const r = ztrackIn(root, ['fmt', '--input', 'body.md', '--check']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/NOT canonical \(run ztrack fmt --write\)/);
    expect(r.out).not.toMatch(/run tracker fmt/);
  }, 30_000);

  test('`sync github` with no repo/link says "ztrack sync github: no repo" (cli.ts:353)', () => {
    const r = ztrackIn(root, ['sync', 'github']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/ztrack sync github: no repo\./);
    expect(r.out).not.toMatch(/tracker sync github: no repo/);
  }, 30_000);
});
