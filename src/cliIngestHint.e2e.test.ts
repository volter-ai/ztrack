// ZTB-21 dev/03: `ztrack ingest <file>` (the removed verb, `import` is its replacement) used to
// fall all the way through to the markdown backend, which died with a generic
// `markdown backend: unsupported command "ingest backlog.md"` — no hint at all. This must now be
// caught at the CLI DISPATCH layer, before any backend/config is touched, with a message that
// names `ztrack import` as the fix. Regression coverage runs the real CLI (black-box, spawnSync)
// in a bare mktemp dir with no `ztrack init` — proving the hint fires even with no tracker config.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('`ztrack ingest` names `import` as the fix, before any backend is reached (ZTB-21 dev/03)', () => {
  test('`ztrack ingest <file>` exits 1 with a `did you mean import` hint — not a generic backend error', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-ingest-hint-'));
    try {
      writeFileSync(join(root, 'backlog.md'), '# some backlog\n');
      const r = ztrackIn(root, ['ingest', 'backlog.md']);
      expect(r.code).toBe(1);
      expect(r.out).toContain("did you mean 'ztrack import backlog.md'");
      expect(r.out).toContain('evidence add');
      // the old failure mode must be gone
      expect(r.out).not.toMatch(/unsupported command/);
      // never touched a config or backend — no tracker state written
      expect(existsSync(join(root, '.volter'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('bare `ztrack ingest` (no path) still hints at `import`, with the generic <path-or-glob> placeholder', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-ingest-hint-bare-'));
    try {
      const r = ztrackIn(root, ['ingest']);
      expect(r.code).toBe(1);
      expect(r.out).toContain("did you mean 'ztrack import <path-or-glob>'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
