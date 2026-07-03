// ZTB-23 dev/01 + dev/02, and the folded-in ZTB-22 reviewer finding on `issue close --reason`.
// Black-box e2e (real CLI, spawnSync) — crib freshRepo/acBody from cliClose.e2e.test.ts.
//
// dev/01: `issue edit --state <v>` (and `issue create --state <v>`) must validate v against the
// ACTIVE preset's status enum at WRITE time. `--state in_progress` (the underscore typo) must
// fail with exit != 0 and a did-you-mean pointing at `in-progress`, instead of writing silently
// and only surfacing later as an unrelated `wellformed_shape` finding (the real 0.38.0 bug). When
// no validation entrypoint is configured, the check must NOT engage — today's permissive write
// behavior is preserved.
//
// dev/02: every state-writing command markdownBackend.ts's dispatch exposes (`issue create`,
// `issue create --state`, `issue edit --state`, `issue close`) must produce a preset-valid state
// by construction — enumerated here by walking the real lifecycle, asserting `ztrack check` is
// green (no `wellformed_shape`) after each one.
//
// Folded-in finding: `issue close --reason <unrecognized>` used to fall through to the completed
// path silently. It must now fail loud, naming the two accepted values, and write nothing.
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

// One dev AC, checked and marked passed with real-commit evidence — every rule this fixture can
// trip (assignee/AC/evidence/proof) is satisfied by construction, so `check` stays green through
// EVERY status in the vocabulary (ready_requires_dev_ac and review_requires_all_acs_passed are
// both already satisfied, whatever the issue's own `status` is).
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

function stateName(root: string, id: string): string {
  const view = JSON.parse(ztrackIn(root, ['issue', 'view', id, '--json', 'state']).out) as { state: { name: string } };
  return view.state.name;
}

describe('write-time --state validation against the active preset (ZTB-23 dev/01)', () => {
  test('`issue edit --state in_progress` (underscore typo) fails closed with a did-you-mean, state unchanged', () => {
    const { root, sha } = freshRepo('ztrk-state-edit-typo-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      const bodyFile = join(root, 'body.md');
      writeFileSync(bodyFile, acBody(sha));
      const created = ztrackIn(root, ['issue', 'create', '--title', 'Ship the health check', '--body-file', bodyFile]);
      const id = (JSON.parse(created.out) as { identifier: string }).identifier;
      const before = stateName(root, id);

      const edited = ztrackIn(root, ['issue', 'edit', id, '--state', 'in_progress']);
      expect(edited.code).not.toBe(0);
      const stderr = `${edited.out}${edited.err}`;
      expect(stderr).toContain('"in_progress" is not a valid status');
      expect(stderr).toMatch(/did you mean "in-progress"/);
      expect(stderr).toContain('Nothing was written');

      expect(stateName(root, id)).toBe(before); // nothing was written
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('`issue create --state in_progress` (same typo) also fails closed — no record is minted', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-state-create-typo-'));
    try {
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
      gitIn(root, 'init', '-q'); gitIn(root, 'config', 'user.email', 't@t.co'); gitIn(root, 'config', 'user.name', 't');
      ztrackIn(root, ['init', '--team', 'ZT']);

      const created = ztrackIn(root, ['issue', 'create', '--title', 'Bogus state', '--state', 'in_progress']);
      expect(created.code).not.toBe(0);
      const stderr = `${created.out}${created.err}`;
      expect(stderr).toContain('"in_progress" is not a valid status');
      expect(stderr).toMatch(/did you mean "in-progress"/);

      const list = JSON.parse(ztrackIn(root, ['issue', 'list', '--json', 'id']).out) as Array<{ id: string }>;
      expect(list.length).toBe(0); // nothing was minted
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('degrades gracefully: with no validation entrypoint configured, an unrecognized --state still writes (today\'s permissive behavior)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-state-no-entrypoint-'));
    try {
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
      gitIn(root, 'init', '-q'); gitIn(root, 'config', 'user.email', 't@t.co'); gitIn(root, 'config', 'user.name', 't');
      ztrackIn(root, ['init', '--team', 'ZT']);

      // Strip the installed validation entrypoint, simulating "no preset configured at all" —
      // the write-time gate must then step aside, exactly like a preset with no status enum.
      const configPath = join(root, '.volter', 'tracker-config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      delete config.validation;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const created = ztrackIn(root, ['issue', 'create', '--title', 'No preset here', '--state', 'totally_bogus']);
      expect(created.code).toBe(0);
      const id = (JSON.parse(created.out) as { identifier: string }).identifier;
      expect(stateName(root, id)).toBe('totally_bogus');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('every state-writing lifecycle command produces a preset-valid state, by construction (ZTB-23 dev/02)', () => {
  test('create (default state) -> edit --state ready/in-progress/in-review -> close: `ztrack check` stays green at every step', () => {
    const { root, sha } = freshRepo('ztrk-state-lifecycle-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      const bodyFile = join(root, 'body.md');
      writeFileSync(bodyFile, acBody(sha));

      const checkGreen = (id: string) => {
        const check = JSON.parse(ztrackIn(root, ['check', id, '--json']).out) as { ok: boolean; findings: Array<{ code: string }> };
        expect(check.findings.some((f) => f.code === 'wellformed_shape')).toBe(false);
        expect(check.ok).toBe(true);
      };

      // 1. `issue create` with NO --state: mints the omitted-flag default ('draft').
      const created = ztrackIn(root, ['issue', 'create', '--title', 'Ship the health check', '--body-file', bodyFile]);
      expect(created.code).toBe(0);
      const id = (JSON.parse(created.out) as { identifier: string }).identifier;
      expect(stateName(root, id)).toBe('draft');
      checkGreen(id);

      // 2-4. `issue edit --state <v>` through the rest of simple-sdlc's vocabulary.
      for (const state of ['ready', 'in-progress', 'in-review']) {
        const edited = ztrackIn(root, ['issue', 'edit', id, '--state', state]);
        expect(edited.code).toBe(0);
        expect(stateName(root, id)).toBe(state);
        checkGreen(id);
      }

      // 5. `issue close` (default --reason completed): the terminal state-writing command.
      const closed = ztrackIn(root, ['issue', 'close', id]);
      expect(closed.code).toBe(0);
      expect(stateName(root, id)).toBe('done');
      checkGreen(id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('`issue create --state <valid>` (explicit, not the omitted-flag default) also produces a preset-valid record', () => {
    const { root, sha } = freshRepo('ztrk-state-create-explicit-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      const bodyFile = join(root, 'body.md');
      writeFileSync(bodyFile, acBody(sha));
      const created = ztrackIn(root, ['issue', 'create', '--title', 'Ship the health check', '--state', 'ready', '--body-file', bodyFile]);
      expect(created.code).toBe(0);
      const id = (JSON.parse(created.out) as { identifier: string }).identifier;
      expect(stateName(root, id)).toBe('ready');
      const check = JSON.parse(ztrackIn(root, ['check', id, '--json']).out) as { ok: boolean; findings: Array<{ code: string }> };
      expect(check.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('`issue close --reason <unrecognized>` fails loud instead of silently completing (folded-in ZTB-22 reviewer finding)', () => {
  test('an unknown --reason is refused, names the two accepted values, and writes nothing', () => {
    const { root, sha } = freshRepo('ztrk-close-bad-reason-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      const bodyFile = join(root, 'body.md');
      writeFileSync(bodyFile, acBody(sha));
      const created = ztrackIn(root, ['issue', 'create', '--title', 'Ship the health check', '--body-file', bodyFile]);
      const id = (JSON.parse(created.out) as { identifier: string }).identifier;
      const before = stateName(root, id);

      const closed = ztrackIn(root, ['issue', 'close', id, '--reason', 'foo']);
      expect(closed.code).not.toBe(0);
      const stderr = `${closed.out}${closed.err}`;
      expect(stderr).toContain('not a recognized reason');
      expect(stderr).toContain("'completed'");
      expect(stderr).toContain("'canceled'");
      expect(stderr).toContain('Nothing was written');

      expect(stateName(root, id)).toBe(before);
      expect(stateName(root, id)).not.toBe('done'); // must NOT have silently fallen through to completed
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
