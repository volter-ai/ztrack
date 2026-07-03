// ZTB-22 dev/01: `issue close` used to write Title-case `state`s ('Done'/'Canceled') that no
// shipped preset's (lowercase) status enum accepts — so the documented happy path
// (create -> close -> check) failed `wellformed_shape` on every project. Black-box e2e (real
// CLI, spawnSync) pinning the fix:
//   1. `issue close <id>` (no --reason, or --reason completed) writes lowercase 'done', and the
//      resulting record passes `ztrack check` with no `wellformed_shape` finding.
//   2. `issue close <id> --reason canceled` fails CLOSED: no shipped preset has a "canceled"
//      status, so nothing is written and the CLI names `issue delete`/`issue edit` instead.
//   3. Legacy healing: a `state:` value of 'Done'/'Canceled' (written by close on ztrack <=0.38.0)
//      is normalized to lowercase on READ, so issues closed before this fix stay green forever.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// Crib the body format from demos/fresh-project-dry-run.sh's `body()` helper: one dev AC, checked
// and marked passed, with evidence citing a real commit sha the check's `--verify-commits`-style
// commit-existence gate can resolve against the fixture's own git history.
function acBody(sha: string): string {
  return [
    '# Ship the health check',
    '',
    'Summary: one verifiable outcome.',
    '',
    '## Acceptance Criteria',
    '',
    '- [x] dev/01 v1 do it',
    '  - status: passed',
    `  - evidence ev1: commit=${sha} acv=1`,
    '  - proof: "ev1 demonstrates it" -> ev1',
    '',
  ].join('\n');
}

function freshRepo(prefix: string): { root: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the installed preset imports 'ztrack/preset-kit'
  gitIn(root, 'init', '-q');
  gitIn(root, 'config', 'user.email', 't@t.co');
  gitIn(root, 'config', 'user.name', 't');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  gitIn(root, 'add', 'README.md');
  gitIn(root, 'commit', '-q', '-m', 'initial commit');
  const sha = gitIn(root, 'rev-parse', 'HEAD').stdout.trim();
  return { root, sha };
}

function storeFile(root: string, id: string): string {
  return join(root, '.volter', 'tracker', 'markdown', `${id}.md`);
}

describe('issue close writes preset-valid state, and fails closed on --reason canceled (ZTB-22 dev/01)', () => {
  test('1. happy path: create (AC passed w/ real-commit evidence) -> close -> view/check are green, no wellformed_shape', () => {
    const { root, sha } = freshRepo('ztrk-close-happy-');
    try {
      expect(ztrackIn(root, ['init', '--team', 'ZT']).code).toBe(0);
      const bodyFile = join(root, 'body.md');
      writeFileSync(bodyFile, acBody(sha));
      const created = ztrackIn(root, ['issue', 'create', '--title', 'Ship the health check', '--body-file', bodyFile]);
      expect(created.code).toBe(0);
      const id = (JSON.parse(created.out) as { identifier: string }).identifier; // ZT-1

      const closed = ztrackIn(root, ['issue', 'close', id]);
      expect(closed.code).toBe(0);

      const view = JSON.parse(ztrackIn(root, ['issue', 'view', id, '--json', 'state,stateType']).out) as {
        state: { name: string; type: string };
        stateType: string;
      };
      expect(view.state.name).toBe('done');
      expect(view.stateType).toBe('completed');
      expect(view.state.type).toBe('completed');

      const check = JSON.parse(ztrackIn(root, ['check', id, '--json']).out) as { ok: boolean; findings: Array<{ code: string }> };
      expect(check.findings.some((f) => f.code === 'wellformed_shape')).toBe(false);
      // Every rule this fixture can trip (assignee/AC/evidence) is satisfied by construction —
      // the documented happy path should be fully green, not merely "not wellformed_shape".
      expect(check.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('2. `--reason canceled` fails closed: nonzero exit, names delete/edit alternatives, state unchanged', () => {
    const { root, sha } = freshRepo('ztrk-close-canceled-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      const bodyFile = join(root, 'body.md');
      writeFileSync(bodyFile, acBody(sha));
      const created = ztrackIn(root, ['issue', 'create', '--title', 'Ship the health check', '--body-file', bodyFile]);
      const id = (JSON.parse(created.out) as { identifier: string }).identifier; // ZT-1
      const before = JSON.parse(ztrackIn(root, ['issue', 'view', id, '--json', 'state']).out) as { state: { name: string } };

      const closed = ztrackIn(root, ['issue', 'close', id, '--reason', 'canceled']);
      expect(closed.code).not.toBe(0);
      const stderr = `${closed.out}${closed.err}`;
      expect(stderr).toMatch(/no.*"canceled" state/);
      expect(stderr).toContain(`issue delete ${id}`);
      expect(stderr).toContain(`issue edit ${id}`);

      const after = JSON.parse(ztrackIn(root, ['issue', 'view', id, '--json', 'state']).out) as { state: { name: string } };
      expect(after.state.name).toBe(before.state.name); // nothing was written
      expect(after.state.name).not.toBe('done');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('3. legacy healing: a Title-case `state: "Done"` written to disk (ztrack <=0.38.0) reads as lowercase \'done\', no wellformed_shape', () => {
    const { root, sha } = freshRepo('ztrk-close-legacy-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      const bodyFile = join(root, 'body.md');
      writeFileSync(bodyFile, acBody(sha));
      const created = ztrackIn(root, ['issue', 'create', '--title', 'Ship the health check', '--body-file', bodyFile]);
      const id = (JSON.parse(created.out) as { identifier: string }).identifier; // ZT-1

      // Directly rewrite the on-disk frontmatter, simulating a record `issue close` wrote under
      // the OLD (pre-fix) code — never through the CLI, exactly what a legacy repo has on disk.
      const file = storeFile(root, id);
      const raw = readFileSync(file, 'utf8');
      expect(raw).toMatch(/^state: "[^"]*"$/m);
      const rewritten = raw.replace(/^state: "[^"]*"$/m, 'state: "Done"');
      expect(rewritten).not.toBe(raw);
      writeFileSync(file, rewritten);

      const view = JSON.parse(ztrackIn(root, ['issue', 'view', id, '--json', 'state']).out) as { state: { name: string } };
      expect(view.state.name).toBe('done');

      const check = JSON.parse(ztrackIn(root, ['check', id, '--json']).out) as { findings: Array<{ code: string }> };
      expect(check.findings.some((f) => f.code === 'wellformed_shape')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
