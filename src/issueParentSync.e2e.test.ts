// Black-box e2e for ZTB-6's children-sync fix: through the REAL CLI (not the backend directly),
// `issue edit --parent`/`--remove-parent` must keep the old and new parents' `children` arrays
// honest (markdownBackend.ts's reparentChildren). Backend-level coverage lives in
// markdownBackend.test.ts; this is the one cheap through-the-CLI confirmation that flag parsing
// and JSON output actually wire up end to end.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const childIds = (view: string): string[] => (JSON.parse(view).children.nodes as Array<{ identifier: string }>).map((n) => n.identifier);

describe('issue edit --parent/--remove-parent syncs children through the CLI (markdown backend)', () => {
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-parent-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    expect(ztrackIn(root, ['init', '--team', 'ZT']).code).toBe(0);
    expect(ztrackIn(root, ['issue', 'create', '--title', 'Epic']).code).toBe(0);  // ZT-1
    expect(ztrackIn(root, ['issue', 'create', '--title', 'Task']).code).toBe(0);  // ZT-2
  }, 30_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('--parent adds to the new parent\'s children; --remove-parent drops it again', () => {
    expect(ztrackIn(root, ['issue', 'edit', 'ZT-2', '--parent', 'ZT-1']).code).toBe(0);
    expect(childIds(ztrackIn(root, ['issue', 'view', 'ZT-1', '--json']).out)).toEqual(['ZT-2']);

    expect(ztrackIn(root, ['issue', 'edit', 'ZT-2', '--remove-parent']).code).toBe(0);
    expect(childIds(ztrackIn(root, ['issue', 'view', 'ZT-1', '--json']).out)).toEqual([]);
  }, 30_000);
});
