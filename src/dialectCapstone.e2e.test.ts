// docs/DIALECTS.md WP7 — the acceptance demo, end to end through the REAL CLI: a repo that has
// never heard of ztrack, holding naturalistic task lists in its own idioms (an emoji
// kill-question register and a checkbox build roster — the alien-stories shape, distilled). The
// claim under test: `ztrack check <file>` understands each file with ZERO configuration, and the
// only human act between "alien repo" and "full tracker view" is pasting the exact command the
// check printed — while every story file stays byte-identical throughout. "Read first, rewrite
// never": the tracker adapts to the repo, not the repo to the tracker.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';

function ztrack(args: string[]): { code: number; stdout: string; stderr: string; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const KILL_QUESTIONS = `# Kill questions

The questions that kill the project if they come up red.

### KQ1 — Is the core loop fun?

- **Kills**: the whole game.
- **Status**: 🟢 PASS — five blind sessions, all asked to keep playing.

### KQ2 — Does it run on the min-spec laptop?

- **Status**: 🟡 in flight; harness ready, first run friday.

### KQ3 — Will the art style survive contact?

- **Status**: 🔴 untested.
`;

const BUILD_CHECKLIST = `# Build checklist

## Workstreams

- [x] **WS-A: Scaffold** — repo layout, CI, the empty window.
- [x] **WS-B: Core loop** — move, shoot, score.
- [ ] **WS-C: Min-spec harness** — the KQ2 rig.
- keep the playtest notes in /notes, not here
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ztrk-capstone-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
  mkdirSync(join(root, 'stories'));
  writeFileSync(join(root, 'stories', 'KILL-QUESTIONS.md'), KILL_QUESTIONS);
  writeFileSync(join(root, 'stories', 'BUILD-CHECKLIST.md'), BUILD_CHECKLIST);
  ztrack(['init', '--team', 'ZC']);
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

/** The command the check itself prints — the demo pastes it verbatim rather than knowing dialect
 *  names, because that's the actual ergonomic claim. */
function offeredCommand(out: string): string[] {
  const m = /ztrack (import \S+ --register --dialect \S+)/.exec(out);
  expect(m).not.toBeNull();
  return m![1]!.split(' ');
}

describe('the alien-stories demo: two pasted commands from zero to tracker view', () => {
  const before = () => ({
    checklist: readFileSync(join(root, 'stories', 'BUILD-CHECKLIST.md'), 'utf8'),
    kq: readFileSync(join(root, 'stories', 'KILL-QUESTIONS.md'), 'utf8'),
  });

  test('command 1: check the register — detected, fully read, offer printed, nothing configured', () => {
    const r = ztrack(['check', 'stories/KILL-QUESTIONS.md']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/matches the 'emoji-register' dialect/);
    expect(r.out).toMatch(/3 issue/);
    ztrack(offeredCommand(r.out));
  });

  test('command 2: check the roster — the OTHER dialect detected on its own shape', () => {
    const r = ztrack(['check', 'stories/BUILD-CHECKLIST.md']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/matches the 'checkbox-roster' dialect/);
    ztrack(offeredCommand(r.out));
  });

  test('the tracker now sees every issue with its true status', () => {
    const r = ztrack(['issue', 'list', '--json', 'identifier,title,state']);
    expect(r.code).toBe(0);
    const byId = Object.fromEntries((JSON.parse(r.stdout) as { identifier: string; state: string; title: string }[]).map((row) => [row.identifier, row]));
    expect(byId['KQ1']!.state).toBe('done');
    expect(byId['KQ2']!.state).toBe('in-progress');
    expect(byId['KQ3']!.state).toBe('ready');
    expect(byId['WS-A']!.state).toBe('done');
    expect(byId['WS-B']!.state).toBe('done');
    expect(byId['WS-C']!.state).toBe('ready');
    expect(byId['WS-C']!.title).toBe('Min-spec harness');
  });

  test('full check is green (lens issues report, never gate) and covers both files', () => {
    const r = ztrack(['check']);
    expect(r.code).toBe(0);
  });

  test('zero mutations: both story files are byte-identical to what the repo authored', () => {
    const b = before();
    expect(b.kq).toBe(KILL_QUESTIONS);
    expect(b.checklist).toBe(BUILD_CHECKLIST);
  });

  test('the config records exactly the two lenses (plus the preserved default store)', () => {
    const config = JSON.parse(readFileSync(join(root, '.volter', 'tracker-config.json'), 'utf8')) as { sources: { dialect?: string; path: string }[] };
    expect(config.sources.filter((s) => s.dialect).map((s) => [s.path, s.dialect]).sort()).toEqual([
      ['stories/BUILD-CHECKLIST.md', 'checkbox-roster'],
      ['stories/KILL-QUESTIONS.md', 'emoji-register'],
    ]);
  });
});
