// ZTB-18 dev/38: `<verb> --help` must be a TOTAL function — usage + exit 0, no tracker config
// loaded, no tracker client created, no work performed — for EVERY verb, including `api` and
// `migrate-local`. Before this fix, cliHelp.ts's printResourceHelp had no branch for either, so
// the hoisted `--help` check at cli.ts fell through: `api --help` in an uninitialized repo hit
// `createTrackerClient()` and exited 1 with "No tracker config found", and `migrate-local --help`
// with a legacy tracker.sqlite present PERFORMED THE REAL MIGRATION. Regression coverage runs the
// real CLI (black-box) in a bare mktemp dir with no `ztrack init` — the strongest form of "no
// config needed" — and asserts the filesystem is untouched afterward.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('`<verb> --help` is side-effect-free and config-free (ZTB-18 dev/38)', () => {
  test('`api --help` in a bare, uninitialized dir: usage, exit 0, no config/client created', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-help-api-'));
    try {
      const r = ztrackIn(root, ['api', '--help']);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/Usage: ztrack api <query\|serve>/);
      expect(r.out).not.toMatch(/No tracker config found/); // the old failure: createTrackerClient() ran first
      expect(existsSync(join(root, '.volter'))).toBe(false); // no config, no client, nothing written
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('`api -h` and `api help` are equivalent aliases', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-help-api2-'));
    try {
      for (const flag of ['-h', 'help']) {
        const r = ztrackIn(root, ['api', flag]);
        expect(r.code).toBe(0);
        expect(r.out).toMatch(/Usage: ztrack api/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('`migrate-local --help` with a legacy tracker.sqlite present: usage, exit 0, sqlite untouched, no migration', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-help-migrate-'));
    try {
      const sqliteDir = join(root, '.volter', 'tracker');
      mkdirSync(sqliteDir, { recursive: true });
      const sqlitePath = join(sqliteDir, 'tracker.sqlite');
      // Content doesn't need to be a real SQLite file — `--help` must never even open it.
      const before = 'not-a-real-sqlite-file (marker for byte-identity check)';
      writeFileSync(sqlitePath, before);

      const r = ztrackIn(root, ['migrate-local', '--help']);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/Usage: ztrack migrate-local/);
      expect(r.out).not.toMatch(/Migrated to the markdown backend/); // the old failure: real migration ran

      // The sqlite "backup" is byte-identical — nothing read/migrated it.
      expect(readFileSync(sqlitePath, 'utf8')).toBe(before);
      // No markdown store was written, and no config was created/flipped to "markdown".
      expect(existsSync(join(root, '.volter', 'tracker', 'markdown'))).toBe(false);
      expect(existsSync(join(root, '.volter', 'tracker-config.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
