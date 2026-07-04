// The legacy content-addressed blob store (`blobStore.ts`) and its only entry point,
// `evidence add --blob`, were removed once they proved write-only: no `ztrack check` rule in any
// shipped preset ever read a blob back (`hasBlob`/`getBlob` had no production caller), so a stored
// blob did nothing for verification. `evidence add` now has ONE honest form — copy the file in and
// cite its path (verified at the cited commit). This test pins the removal's migration contract:
// a stray `--blob` flag is inert (ignored), never crashes, and the command still stores by path.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('evidence add — blobStore removed, --blob is inert', () => {
  test('a stray `--blob` flag is ignored: the command still stores by path and never crashes', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-evid-blob-'));
    try {
      mkdirSync(join(root, '.volter'), { recursive: true });
      writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }));
      const file = join(root, 'shot.png');
      writeFileSync(file, Buffer.from('not-really-a-png'));
      const r = ztrackIn(root, ['evidence', 'add', file, '--blob', '--commit']);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/"path":/);     // commit-mode path output, not a blob ref
      expect(r.out).toMatch(/"sha256":\s*"sha256:[0-9a-f]{64}"/);
      expect(r.out).not.toMatch(/"blob":/); // the old content-addressed ref is gone
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
