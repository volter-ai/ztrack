// The legacy content-addressed blob store (`blobStore.ts`) and its only entry point,
// `evidence add --blob`, were removed once they proved write-only: no `ztrack check` rule in any
// shipped preset ever read a blob back (`hasBlob`/`getBlob` had no production caller), so a stored
// blob did nothing for verification. `evidence add` now has ONE honest form — copy the file in and
// cite its path (verified at the cited commit). `--blob` itself was kept around for a while as an
// accepted no-op after that removal, but was dropped outright pre-1.0 (ZTB-42): this test now pins
// the TIGHTER contract — a stray `--blob` flag rejects loud (unknown flag) and stores nothing.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('evidence add — blobStore removed, --blob is REJECTED (ZTB-42)', () => {
  test('a stray `--blob` flag rejects loud (unknown flag) and stores nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-evid-blob-'));
    try {
      mkdirSync(join(root, '.volter'), { recursive: true });
      writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }));
      const file = join(root, 'shot.png');
      writeFileSync(file, Buffer.from('not-really-a-png'));
      const r = ztrackIn(root, ['evidence', 'add', file, '--blob', '--commit']);
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/unknown flag/);
      expect(r.out).toContain('--blob');
      // nothing stored: the default evidence dir (.volter/evidence) was never created/populated.
      const dir = join(root, '.volter', 'evidence');
      expect(!existsSync(dir) || readdirSync(dir).length === 0).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('`evidence add <file>` (commit mode) stores by path and prints the cite hint', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-evid-noblob-'));
    try {
      mkdirSync(join(root, '.volter'), { recursive: true });
      writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }));
      const file = join(root, 'shot.png');
      writeFileSync(file, Buffer.from('not-really-a-png'));
      const r = ztrackIn(root, ['evidence', 'add', file, '--commit']);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/"path":/);
      expect(r.out).toMatch(/cite: image=/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// ZTB-39: the positional fallback used to take the FIRST non-`--` token — which may be a
// value-taking flag's VALUE, not the file. `real.png` and `custom.png` below have DISTINCT
// contents, and `custom.png` is a real, pre-existing file on disk (a decoy) so that a regression
// would silently "succeed" by ingesting the wrong bytes rather than tripping an ENOENT.
describe('evidence add — positional fallback skips a value-taking flag\'s value (ZTB-39)', () => {
  function freshRepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-evid-pos-'));
    mkdirSync(join(root, '.volter'), { recursive: true });
    writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }));
    writeFileSync(join(root, 'real.png'), Buffer.from('REAL-PNG-CONTENT-should-be-the-one-stored'));
    writeFileSync(join(root, 'custom.png'), Buffer.from('DECOY-CONTENT-must-never-be-what-gets-stored'));
    return root;
  }
  const REAL_CONTENT = 'REAL-PNG-CONTENT-should-be-the-one-stored';

  function storedBytes(root: string, name: string): string {
    return readFileSync(join(root, '.volter', 'evidence', name), 'utf8');
  }

  const forms: { label: string; args: string[] }[] = [
    { label: '--name custom.png real.png (wrong order — today: broken)', args: ['--name', 'custom.png', 'real.png'] },
    { label: 'real.png --name custom.png (today: works — must not regress)', args: ['real.png', '--name', 'custom.png'] },
    { label: '--file real.png --name custom.png', args: ['--file', 'real.png', '--name', 'custom.png'] },
    { label: '--name=custom.png real.png (`=` form consumes nothing)', args: ['--name=custom.png', 'real.png'] },
  ];
  for (const { label, args } of forms) {
    test(`${label} ingests real.png's bytes, stored as custom.png`, () => {
      const root = freshRepo();
      try {
        const r = ztrackIn(root, ['evidence', 'add', ...args, '--commit']);
        expect(r.code).toBe(0);
        expect(r.out).toMatch(/"path":\s*".*custom\.png"/);
        expect(storedBytes(root, 'custom.png')).toBe(REAL_CONTENT);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, 30_000);
  }

  test('--name custom.png with NO file anywhere: the usage error, exit != 0, stores nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-evid-pos-nofile-'));
    try {
      mkdirSync(join(root, '.volter'), { recursive: true });
      writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }));
      writeFileSync(join(root, 'custom.png'), Buffer.from('DECOY-CONTENT-must-never-be-what-gets-stored'));
      const r = ztrackIn(root, ['evidence', 'add', '--name', 'custom.png', '--commit']);
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/usage: ztrack evidence add <file>/);
      const evidenceDir = join(root, '.volter', 'evidence');
      expect(!existsSync(evidenceDir) || readdirSync(evidenceDir).length === 0).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('real.png (no --name): unchanged — stored under basename real.png', () => {
    const root = freshRepo();
    try {
      const r = ztrackIn(root, ['evidence', 'add', 'real.png', '--commit']);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/"path":\s*".*real\.png"/);
      expect(storedBytes(root, 'real.png')).toBe(REAL_CONTENT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
