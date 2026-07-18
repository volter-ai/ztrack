import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { stateDirName } from './config.ts';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const HAS_DEPS = existsSync(join(REPO, 'visualizer', 'node_modules', 'react'));
const suite = HAS_DEPS ? describe : describe.skip;
const digest = (bytes: string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

suite('visualizer — verified artifact serving', () => {
  let root = '';
  let proc: ChildProcess | undefined;
  let commit = '';
  const port = 10_900 + (process.pid % 700);
  const liveBytes = 'current artifact bytes';
  const historicalBytes = 'historical artifact bytes';
  const replacedBytes = 'artifact bytes before replacement';

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-artifacts-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    const zt = (...args: string[]) => spawnSync('bun', ['run', CLI, ...args], { cwd: root, encoding: 'utf8' });
    const init = zt('init');
    if (init.status !== 0) throw new Error(init.stderr || init.stdout);

    const evidenceDir = join(root, stateDirName(), 'evidence');
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, 'live.txt'), liveBytes);
    writeFileSync(join(evidenceDir, 'historical.txt'), historicalBytes);
    writeFileSync(join(evidenceDir, 'replaced.txt'), replacedBytes);
    mkdirSync(join(root, stateDirName(), 'tracker', 'visualizer', 'source-previews', 'a'.repeat(64)), { recursive: true });
    writeFileSync(join(root, stateDirName(), 'tracker', 'visualizer', 'source-previews', 'a'.repeat(64), 'page-01.png'), 'png fixture');
    writeFileSync(join(root, 'README.md'), 'not a pinned artifact');

    for (const args of [
      ['init'],
      ['config', 'user.email', 'test@example.invalid'],
      ['config', 'user.name', 'ztrack test'],
      ['add', stateDirName(), 'README.md'],
      ['commit', '-m', 'fixture artifacts'],
    ]) {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    }
    commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    rmSync(join(evidenceDir, 'historical.txt'));
    writeFileSync(join(evidenceDir, 'replaced.txt'), 'new mutable bytes at the same path');

    proc = spawn('bun', ['run', join(REPO, 'visualizer', 'server.ts')], {
      cwd: join(REPO, 'visualizer'),
      env: { ...process.env, PORT: String(port), PROJECT_DIR: root },
      stdio: 'ignore',
    });
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        if ((await fetch(`http://localhost:${port}/`)).status === 200) return;
      } catch { /* server is still starting */ }
      await Bun.sleep(300);
    }
    throw new Error(`visualizer on ${port} never started`);
  }, 30_000);

  afterAll(() => {
    try { proc?.kill(); } catch { /* already stopped */ }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('serves one verified current byte snapshot with range and integrity headers', async () => {
    const pin = digest(liveBytes);
    const url = `http://localhost:${port}/project/${stateDirName()}/evidence/live.txt?sha256=${pin}`;
    const full = await fetch(url);
    expect(full.status).toBe(200);
    expect(full.headers.get('x-ztrack-artifact-sha256')).toBe(pin);
    expect(await full.text()).toBe(liveBytes);

    const range = await fetch(url, { headers: { range: 'bytes=0-6' } });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe(`bytes 0-6/${liveBytes.length}`);
    expect(await range.text()).toBe('current');
  });

  test('rejects a wrong digest without returning mutable bytes', async () => {
    const wrong = `sha256:${'0'.repeat(64)}`;
    const response = await fetch(`http://localhost:${port}/project/${stateDirName()}/evidence/live.txt?sha256=${wrong}`);
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('sha256 mismatch');
  });

  test('recovers deleted evidence from git by exact digest or explicit commit', async () => {
    const pin = digest(historicalBytes);
    const base = `http://localhost:${port}/project/${stateDirName()}/evidence/historical.txt`;

    const recovered = await fetch(`${base}?sha256=${pin}`);
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get('x-ztrack-artifact-commit')).toBe(commit);
    expect(await recovered.text()).toBe(historicalBytes);

    const pinnedCommit = await fetch(`${base}?sha256=${pin}&commit=${commit}`);
    expect(pinnedCommit.status).toBe(200);
    expect(await pinnedCommit.text()).toBe(historicalBytes);
  });

  test('recovers old pinned bytes when the working-tree path now contains different content', async () => {
    const pin = digest(replacedBytes);
    const response = await fetch(`http://localhost:${port}/project/${stateDirName()}/evidence/replaced.txt?sha256=${pin}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ztrack-artifact-commit')).toBe(commit);
    expect(await response.text()).toBe(replacedBytes);
  });

  test('limits integrity pins to canonical evidence/source paths and rejects malformed paths', async () => {
    const ordinary = await fetch(`http://localhost:${port}/project/README.md?sha256=${digest('not a pinned artifact')}`);
    expect(ordinary.status).toBe(404);
    const malformed = await fetch(`http://localhost:${port}/project/%E0%A4%A`);
    expect(malformed.status).toBe(400);
    const nestedDotfile = await fetch(`http://localhost:${port}/project/${stateDirName()}/evidence/.secret`);
    expect(nestedDotfile.status).toBe(404);
  });

  test('serves digest-addressed source previews from the fixed repository-owned directory', async () => {
    const response = await fetch(`http://localhost:${port}/assets/source-previews/${'a'.repeat(64)}/page-1.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ztrack-source-sha256')).toBe(`sha256:${'a'.repeat(64)}`);
    expect(response.headers.get('x-ztrack-source-page')).toBe('1');
    expect(await response.text()).toBe('png fixture');
  });

  test('rejects a source-preview file that resolves through a symlink outside the repository', async () => {
    const digestDir = join(root, stateDirName(), 'tracker', 'visualizer', 'source-previews', 'b'.repeat(64));
    const outside = join(tmpdir(), `ztrack-preview-outside-${process.pid}.png`);
    mkdirSync(digestDir, { recursive: true });
    writeFileSync(outside, 'outside bytes');
    symlinkSync(outside, join(digestDir, 'page-01.png'));
    try {
      const response = await fetch(`http://localhost:${port}/assets/source-previews/${'b'.repeat(64)}/page-1.png`);
      expect(response.status).toBe(404);
    } finally {
      unlinkSync(outside);
    }
  });
});
