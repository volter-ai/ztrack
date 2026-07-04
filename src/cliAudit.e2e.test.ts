// ztrack #19 — the audit log is now wired into CLI writes. Black-box e2e (real CLI, spawnSync):
// prove that CLI-only usage (no visualizer) populates `.volter/tracker/.audit.jsonl`, that the
// log + baseline are gitignored (no untracked-file spray), and that the first create is logged
// (init seeds an empty baseline so observeChanges doesn't swallow it as a silent first-run seed).
// Fixture cribbed from cliStateWrites.e2e.test.ts.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function acBody(sha: string): string {
  return [
    '# Ship the health check', '', 'Summary: one verifiable outcome.', '',
    '## Acceptance Criteria', '',
    '- [x] dev/01 v1 do it', '  - status: passed', `  - evidence ev1: commit=${sha} acv=1`,
    '  - proof: "ev1 demonstrates it" -> ev1', '',
  ].join('\n');
}

function freshRepo(prefix: string): { root: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
  gitIn(root, 'init', '-q');
  gitIn(root, 'config', 'user.email', 't@t.co');
  gitIn(root, 'config', 'user.name', 't');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  gitIn(root, 'add', 'README.md');
  gitIn(root, 'commit', '-q', '-m', 'initial commit');
  return { root, sha: gitIn(root, 'rev-parse', 'HEAD').stdout.trim() };
}

const auditLog = (root: string) => join(root, '.volter', 'tracker', '.audit.jsonl');
function readAuditEntries(root: string): Array<Record<string, string>> {
  if (!existsSync(auditLog(root))) return [];
  return readFileSync(auditLog(root), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('audit log is wired into CLI writes (ztrack #19)', () => {
  test('init seeds the baseline + gitignores it; the first create and a later state change are logged', () => {
    const { root, sha } = freshRepo('ztrk-audit-e2e-');
    try {
      expect(ztrackIn(root, ['init', '--team', 'ZT']).code).toBe(0);

      // init seeds an empty baseline and drops a .gitignore covering both audit files
      const trackerDir = join(root, '.volter', 'tracker');
      expect(existsSync(join(trackerDir, '.audit-state.json'))).toBe(true);
      const gi = readFileSync(join(trackerDir, '.gitignore'), 'utf8');
      expect(gi).toContain('.audit.jsonl');
      expect(gi).toContain('.audit-state.json');

      // first create → logged (not swallowed as a silent seed, because init seeded the baseline)
      const bodyFile = join(root, 'body.md');
      writeFileSync(bodyFile, acBody(sha));
      const created = ztrackIn(root, ['issue', 'create', '--title', 'Ship the health check', '--state', 'ready', '--body-file', bodyFile]);
      expect(created.code).toBe(0);
      const id = (JSON.parse(created.out) as { identifier: string }).identifier;

      const afterCreate = readAuditEntries(root);
      expect(afterCreate.some((e) => e.issueId === id && e.op === 'observed.create')).toBe(true);

      // a state change → a `status` entry from ready → in-progress
      expect(ztrackIn(root, ['issue', 'edit', id, '--state', 'in-progress']).code).toBe(0);
      const afterEdit = readAuditEntries(root);
      const statusEntry = afterEdit.find((e) => e.issueId === id && e.op === 'status');
      expect(statusEntry).toBeDefined();
      expect(statusEntry).toMatchObject({ from: 'ready', to: 'in-progress', actor: 'cli' });

      // the audit files never show up as untracked — they're ignored
      const untracked = gitIn(root, 'status', '--porcelain', '--ignored=no').stdout;
      expect(untracked).not.toContain('.audit.jsonl');
      expect(untracked).not.toContain('.audit-state.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);

  test('a read-only command writes no audit entries', () => {
    const { root, sha } = freshRepo('ztrk-audit-readonly-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      const bodyFile = join(root, 'body.md');
      writeFileSync(bodyFile, acBody(sha));
      ztrackIn(root, ['issue', 'create', '--title', 'Ship the health check', '--state', 'ready', '--body-file', bodyFile]);
      const before = readAuditEntries(root).length;
      // read-only commands: must not append
      ztrackIn(root, ['issue', 'list', '--json', 'id']);
      ztrackIn(root, ['check']);
      expect(readAuditEntries(root).length).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);
});
