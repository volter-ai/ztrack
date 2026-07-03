// ZTB-18 dev/40: a one-off `npx ztrack init` (the bare-npx case) never adds `ztrack` as a project
// dependency, so init/scaffold/create all succeed and only later does `ztrack check` fail with
// "the 'ztrack' package isn't resolvable from this project" (presetRegistry.ts) — a failure init
// itself never warned about. Regression coverage runs the real CLI's `init` in (a) a bare dir with
// no node_modules at all, and (b) a project with `node_modules/ztrack` present, and asserts the
// warning fires only in (a). Also guards against a `require.resolve`/`createRequire`-style check,
// which would falsely say "resolvable" on any machine with a global npm-linked `ztrack` (Node's
// legacy CJS global-folder fallback) even though the real failure is an ESM `import()` that never
// consults those folders.
import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const WARNING = /'ztrack' isn't resolvable as a project dependency here/;

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('init: warns when \'ztrack\' is not resolvable from the project (ZTB-18 dev/40)', () => {
  let root = '';
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });

  test('bare dir, no node_modules at all (the one-off `npx` case) → warning, naming the fix command', () => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-init-bare-'));
    const r = ztrackIn(root, ['init', '--team', 'ZT']);
    expect(r.code).toBe(0); // warning only — exit 0 unchanged
    expect(r.out).toMatch(WARNING);
    expect(r.out).toMatch(/npm install -D ztrack/); // names the exact fix command
  }, 30_000);

  test('project with `node_modules/ztrack` present → no warning', () => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-init-good-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    const r = ztrackIn(root, ['init', '--team', 'ZT']);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(WARNING);
  }, 30_000);

  test('re-running `init` on an already-initialized bare dir still warns (the "Already initialized" path)', () => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-init-again-'));
    ztrackIn(root, ['init', '--team', 'ZT']); // first run
    const r = ztrackIn(root, ['init', '--team', 'ZT']); // second run: alreadyInitialized branch
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Already initialized/);
    expect(r.out).toMatch(WARNING);
  }, 30_000);
});
