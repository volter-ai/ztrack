// Boot the real `ztrack visualizer` (a Bun web app) and confirm it serves. Gated on its client
// deps (react) already being installed, so a clean CI checkout — where the first run would do a
// one-time `bun install` — skips rather than flaking; dev runs (deps present) exercise it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const HAS_DEPS = existsSync(join(REPO, 'visualizer', 'node_modules', 'react'));
const suite = HAS_DEPS ? describe : describe.skip;

suite('visualizer — boots and serves', () => {
  let root = '';
  let proc: ChildProcess | undefined;
  const port = 7000 + (process.pid % 1500);

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-viz-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    const zt = (...a: string[]) => spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8' });
    zt('init');
    writeFileSync(join(root, 'b.md'), zt('issue', 'scaffold', '--title', 'V').stdout);
    zt('issue', 'create', '--title', 'V', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', 'b.md');
    proc = spawn('bun', ['run', CLI, 'visualizer', '--port', String(port), '--project', root], { cwd: root, stdio: 'ignore' });
  }, 30_000);

  afterAll(() => {
    try { proc?.kill(); } catch { /* */ }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('serves HTTP 200 on its port', async () => {
    let status = 0;
    for (let i = 0; i < 25 && status !== 200; i++) {
      try { status = (await fetch(`http://localhost:${port}/`)).status; } catch { /* not up yet */ }
      if (status !== 200) await Bun.sleep(800);
    }
    expect(status).toBe(200);
  }, 30_000);
});
