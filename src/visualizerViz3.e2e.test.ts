// VIZ-3: /api/board ships the preset's `visualizer` block (VIZ-1), validated, with a live
// re-resolution loop (no restart needed after editing preset.mts). Boots the real
// `ztrack visualizer` against fixture repos whose INSTALLED preset.mts (post-`ztrack init`) is
// patched to carry a visualizer block — same fixture pattern as src/visualizer.e2e.test.ts
// (symlink node_modules/ztrack -> this checkout, run the real CLI, spawn the real server), and
// the same dep-gate (visualizer/node_modules/react present) so a clean checkout — where the
// visualizer's one-time `bun install` hasn't run yet — skips rather than flaking.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const HAS_DEPS = existsSync(join(REPO, 'visualizer', 'node_modules', 'react'));
const suite = HAS_DEPS ? describe : describe.skip;

// Plain-data VisualizerSpec literals (VIZ-1's hard boundary: field references + literal labels
// only) spliced directly into the installed preset's source text as JS object-literal syntax.
const VALID_VISUALIZER = "{ statusOrder: ['draft', 'ready', 'in-progress', 'in-review', 'done'], acUnitLabel: 'Dev ACs', assignee: 'assignee' }";
// statusOrder must be an array per VisualizerSpecSchema — a bare string fails validation.
const INVALID_VISUALIZER = "{ statusOrder: 'draft', acUnitLabel: 'Dev ACs' }";

function initFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-viz3-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the installed preset imports 'ztrack/preset-kit'
  const zt = (...a: string[]) => spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8' });
  const init = zt('init');
  if (init.status !== 0) throw new Error(`fixture: ztrack init failed: ${init.stderr || init.stdout}`);
  return root;
}

function presetPath(root: string): string {
  return join(root, '.volter', 'tracker', 'validation', 'preset.mts');
}

// Splice a `visualizer:` field into the installed preset object, right after its `name:` field,
// bracketed with markers so a later live-edit (dev/05) can replace just that block in place.
function injectVisualizer(root: string, literal: string): string {
  const p = presetPath(root);
  const src = readFileSync(p, 'utf8');
  const marker = "name: 'simple-sdlc',";
  if (!src.includes(marker)) throw new Error('fixture: preset.mts marker not found — installed boilerplate shape changed');
  writeFileSync(p, src.replace(marker, `${marker}\n  // VIZ3-FIXTURE-VISUALIZER-START\n  visualizer: ${literal},\n  // VIZ3-FIXTURE-VISUALIZER-END\n`));
  return p;
}

// dev/05's live edit: replace a previously-injected block's literal, and force the mtime forward
// so the edit is unambiguously observable regardless of filesystem timestamp resolution.
function editVisualizer(p: string, literal: string): void {
  const src = readFileSync(p, 'utf8');
  const next = src.replace(
    /\/\/ VIZ3-FIXTURE-VISUALIZER-START[\s\S]*?\/\/ VIZ3-FIXTURE-VISUALIZER-END\n/,
    `// VIZ3-FIXTURE-VISUALIZER-START\n  visualizer: ${literal},\n  // VIZ3-FIXTURE-VISUALIZER-END\n`,
  );
  writeFileSync(p, next);
  const future = new Date(Date.now() + 2000);
  utimesSync(p, future, future);
}

function startServer(root: string, port: number): ChildProcess {
  return spawn('bun', ['run', join(REPO, 'visualizer', 'server.ts')], {
    cwd: join(REPO, 'visualizer'),
    env: { ...process.env, PORT: String(port), PROJECT_DIR: root },
    stdio: 'ignore',
  });
}

async function waitUp(port: number): Promise<void> {
  for (let i = 0; i < 25; i++) {
    try { if ((await fetch(`http://localhost:${port}/`)).status === 200) return; } catch { /* not up yet */ }
    await Bun.sleep(800);
  }
  throw new Error(`server on port ${port} never came up`);
}

const BASE_PORT = 9500 + (process.pid % 400) * 3;

suite('VIZ-3 — /api/board ships the visualizer vocabulary, validated, live', () => {
  describe('a preset WITH a valid visualizer block', () => {
    const port = BASE_PORT;
    let root = '';
    let proc: ChildProcess | undefined;
    let preset = '';

    beforeAll(async () => {
      root = initFixture();
      preset = injectVisualizer(root, VALID_VISUALIZER);
      proc = startServer(root, port);
      await waitUp(port);
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('dev/01 — .visualizer.statusOrder returns the declared block', async () => {
      const board = await (await fetch(`http://localhost:${port}/api/board`)).json() as { visualizer?: { statusOrder?: string[]; acUnitLabel?: string } | null; visualizerError?: string };
      expect(board.visualizer?.statusOrder).toEqual(['draft', 'ready', 'in-progress', 'in-review', 'done']);
      expect(board.visualizer?.acUnitLabel).toBe('Dev ACs');
      expect(board.visualizerError).toBeUndefined();
    }, 15_000);

    test('dev/05 — editing preset.mts live-reloads on the SAME server process (no restart)', async () => {
      // Sanity: confirm the pre-edit value first, on the same running server.
      const before = await (await fetch(`http://localhost:${port}/api/board`)).json() as { visualizer?: { statusOrder?: string[] } | null };
      expect(before.visualizer?.statusOrder).not.toContain('archived');

      editVisualizer(preset, VALID_VISUALIZER.replace("'done']", "'done', 'archived']"));

      const after = await (await fetch(`http://localhost:${port}/api/board`)).json() as { visualizer?: { statusOrder?: string[] } | null };
      expect(after.visualizer?.statusOrder).toContain('archived'); // proves the mtime-keyed `delete require.cache[...]` bust — no restart
    }, 15_000);
  });

  describe('a preset WITHOUT a visualizer block', () => {
    const port = BASE_PORT + 1;
    let root = '';
    let proc: ChildProcess | undefined;

    beforeAll(async () => {
      root = initFixture(); // no injection — the shipped boilerplate has no `visualizer` field yet (VIZ-2 lands separately)
      proc = startServer(root, port);
      await waitUp(port);
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('dev/02 — .visualizer is null, endpoint still serves 200 with issues (no throw, no fallback lookup)', async () => {
      const res = await fetch(`http://localhost:${port}/api/board`);
      expect(res.status).toBe(200);
      const board = await res.json() as { visualizer: unknown; visualizerError?: string; issues?: unknown[] };
      expect(board.visualizer).toBeNull();
      expect(board.visualizerError).toBeUndefined();
      expect(Array.isArray(board.issues)).toBe(true);
    }, 15_000);
  });

  describe('a preset with an INVALID visualizer block', () => {
    const port = BASE_PORT + 2;
    let root = '';
    let proc: ChildProcess | undefined;

    beforeAll(async () => {
      root = initFixture();
      injectVisualizer(root, INVALID_VISUALIZER);
      proc = startServer(root, port);
      await waitUp(port);
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('dev/04 — invalid block ships null + visualizerError naming the offending path; raw invalid data never ships', async () => {
      const board = await (await fetch(`http://localhost:${port}/api/board`)).json() as { visualizer: unknown; visualizerError?: string };
      expect(board.visualizer).toBeNull();
      expect(board.visualizerError).toBeTruthy();
      expect(board.visualizerError).toContain('statusOrder'); // names the offending zod issue path
      expect(JSON.stringify(board)).not.toContain('"Dev ACs"'); // the invalid block's OTHER field never ships either — whole block is null, not partially passed through
    }, 15_000);
  });
});
