// ztrack issue #19 (blobStore's only consumer is legacy `evidence add --blob`; no check path
// reads blobs back — hasBlob/getBlob in blobStore.ts have no production caller, only
// blobStore.test.ts exercises them). `evidence add --blob` still stores the blob (real,
// content-addressed, deduped), but nothing in `ztrack check` ever consults it, so the CLI now
// prints a deprecation-style warning naming the honest path (`evidence add <file>`, no --blob)
// instead of silently implying the stored blob does something for verification.
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

describe('evidence add --blob warns it is write-only (ztrack issue #19)', () => {
  test('`evidence add <file> --blob` prints a deprecation warning naming the non---blob alternative', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-evid-blob-'));
    try {
      mkdirSync(join(root, '.volter'), { recursive: true });
      writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }));
      const file = join(root, 'shot.png');
      writeFileSync(file, Buffer.from('not-really-a-png'));
      const r = ztrackIn(root, ['evidence', 'add', file, '--blob']);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/"blob":\s*"sha256:[0-9a-f]{64}"/); // still stores + prints the ref
      expect(r.out).toMatch(/deprecated/i);
      expect(r.out).toMatch(/no `ztrack check` rule consults blobStore/);
      expect(r.out).toMatch(/evidence add.*\(no --blob\)|evidence add <file>/); // names the fix
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('`evidence add <file>` (no --blob, commit mode) does NOT print the deprecation warning', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-evid-noblob-'));
    try {
      mkdirSync(join(root, '.volter'), { recursive: true });
      writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }));
      const file = join(root, 'shot.png');
      writeFileSync(file, Buffer.from('not-really-a-png'));
      const r = ztrackIn(root, ['evidence', 'add', file, '--commit']);
      expect(r.code).toBe(0);
      expect(r.out).not.toMatch(/deprecated/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
