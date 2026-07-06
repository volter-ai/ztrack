// ZTB-29: `ztrack loop start <issue> --until <stage>` — drive-to-stage, plus arm-time honesty.
// Black-box e2e (real CLI, spawnSync), crib freshRepo/acBody from cliStateWrites.e2e.test.ts.
//
// dev/01: --until records the target stage in the marker; bare `loop start` keeps today's
// current-stage semantics byte-identical; `loop status` shows the target stage.
// dev/02: the stage vocabulary is the active preset's status-enum declaration order (reused from
// ZTB-23's activeStatusEnum); an unknown --until value fails loud at ARM TIME with a did-you-mean;
// no loadable preset/enum fails the arm honestly; --until is rejected for a file/multi-issue target.
// dev/03: `loop start` warns (never refuses) when it can't detect the ztrack plugin's gate is wired —
// isolate every test from the real developer $HOME so this is deterministic.
// dev/04: a bare arm on an already-green target warns (still arms); --until on a green-at-
// current-stage issue does NOT warn (that's the intended use).
// The oracle (Option B — see cliCheck.ts): armed --until done + issue in-progress + green at the
// CURRENT stage -> `check --auto-scope` HELD; driven to done for real -> RELEASED; an early flip
// to done without passing ACs -> STILL HELD (the stage's own lifecycle gates fire on their own).
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[], env?: Record<string, string>): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });

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

// Isolate every test from the real developer $HOME (which may or may not have the ztrack plugin
// installed for real) so the dev/03 gate-wiring warning is deterministic — see gateWiring.ts's
// doc comment: a fresh subprocess reads $HOME at startup via os.homedir(), so this works even
// though an in-process mutation of process.env.HOME would not (gateWiring.test.ts covers that).
function isolatedHome(): { home: string; env: Record<string, string> } {
  const home = mkdtempSync(join(tmpdir(), 'ztrk-loop-until-home-'));
  return { home, env: { HOME: home } };
}

function pendingAcBody(title: string): string {
  return `# ${title}\n\nSummary: do the thing\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 do the thing\n  - status: pending\n`;
}
function passedAcBody(title: string, sha: string): string {
  return [
    `# ${title}`, '', 'Summary: do the thing', '', '## Acceptance Criteria', '',
    '- [x] dev/01 v1 do the thing', '  - status: passed', `  - evidence ev1: commit=${sha} acv=1`,
    '  - proof: "shows it" -> ev1', '',
  ].join('\n');
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

describe('--until vocabulary + target validation (ZTB-29 dev/02)', () => {
  test('an unknown --until value fails loud at ARM TIME, naming the vocabulary with a did-you-mean; nothing is armed', () => {
    const { root } = freshRepo('ztrk-until-badvalue-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env);
      const r = ztrackIn(root, ['loop', 'start', 'ZT-1', '--until', 'donee'], env);
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/is not a valid --until stage/);
      expect(r.out).toMatch(/\[draft, ready, in-progress, in-review, done\]/);
      expect(r.out).toMatch(/did you mean "done"/);
      const status = ztrackIn(root, ['loop', 'status'], env);
      expect(status.out).toMatch(/no loop armed/);
    } finally { cleanup(root, home); }
  });

  test('--until on a FILE target fails loud (a file has no single status to drive)', () => {
    const { root } = freshRepo('ztrk-until-file-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      writeFileSync(join(root, 'loose.md'), pendingAcBody('Loose'));
      const r = ztrackIn(root, ['loop', 'start', './loose.md', '--until', 'done'], env);
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/--until needs a single-issue target/);
    } finally { cleanup(root, home); }
  });

  test('--until on a MULTI-issue target fails loud', () => {
    const { root } = freshRepo('ztrk-until-multi-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'One', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# One'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'Two', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# Two'], env);
      const r = ztrackIn(root, ['loop', 'start', 'ZT-1', 'ZT-2', '--until', 'done'], env);
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/--until needs a single-issue target/);
    } finally { cleanup(root, home); }
  });

  test('--until with no loadable validation entrypoint fails the arm honestly (not a silent degrade)', () => {
    const { root } = freshRepo('ztrk-until-noentry-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env);
      // Break the entrypoint so activeStatusEnum resolves to null (no vocabulary loadable).
      const cfgPath = join(root, '.volter', 'tracker-config.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as { validation?: { entrypoint?: string } };
      cfg.validation = { entrypoint: 'does/not/exist.mts' };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      const r = ztrackIn(root, ['loop', 'start', 'ZT-1', '--until', 'done'], env);
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/needs a loadable status vocabulary/);
      const status = ztrackIn(root, ['loop', 'status'], env);
      expect(status.out).toMatch(/no loop armed/);
    } finally { cleanup(root, home); }
  });

  test('--until with a bare/auto target is accepted (single-issue resolution), a real stage value arms cleanly', () => {
    const { root } = freshRepo('ztrk-until-bare-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env);
      const r = ztrackIn(root, ['loop', 'start', 'ZT-1', '--until', 'ready'], env);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/loop armed/);
    } finally { cleanup(root, home); }
  });
});

describe('marker + status: --until is recorded, and bare arm stays byte-identical (ZTB-29 dev/01)', () => {
  test('the marker gets an `until` field only when --until is passed; loop status shows it', () => {
    const { root } = freshRepo('ztrk-until-marker-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env);
      expect(ztrackIn(root, ['loop', 'start', 'ZT-1', '--until', 'done'], env).code).toBe(0);
      const marker = JSON.parse(readFileSync(join(root, '.volter', '.ztrack-loop.json'), 'utf8')) as { until?: string; target: unknown };
      expect(marker.until).toBe('done');
      expect(ztrackIn(root, ['loop', 'status'], env).out).toMatch(/loop armed → ZT-1 until done/);
      ztrackIn(root, ['loop', 'stop'], env);
    } finally { cleanup(root, home); }
  });

  test('bare `loop start` (no --until) writes NO `until` key at all — byte-identical to pre-ZTB-29', () => {
    const { root } = freshRepo('ztrk-until-bareonly-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env);
      expect(ztrackIn(root, ['loop', 'start', 'ZT-1'], env).code).toBe(0);
      const raw = readFileSync(join(root, '.volter', '.ztrack-loop.json'), 'utf8');
      expect(raw).not.toMatch(/"until"/);
      const status = ztrackIn(root, ['loop', 'status'], env);
      expect(status.out).toMatch(/loop armed → ZT-1/);
      expect(status.out).not.toMatch(/until/);
    } finally { cleanup(root, home); }
  });

  test('a LEGACY marker (no `until`, or the old flat `issue` field) still works everywhere — no crash, no phantom until', () => {
    const { root } = freshRepo('ztrk-until-legacy-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env);
      mkdirSync(join(root, '.volter'), { recursive: true });
      // The oldest marker shape this codebase ever wrote: a bare `issue` field, no `target`.
      writeFileSync(join(root, '.volter', '.ztrack-loop.json'), JSON.stringify({ issue: 'ZT-1', maxIterations: 8, startedAt: new Date().toISOString() }));
      const status = ztrackIn(root, ['loop', 'status'], env);
      expect(status.code).toBe(0);
      expect(status.out).toMatch(/loop armed → ZT-1/);
      expect(status.out).not.toMatch(/until/);
      const check = ztrackIn(root, ['check', '--auto-scope'], env);
      expect(check.code).toBe(0); // ZT-1 is draft, clean — current-stage semantics, no until gate
    } finally { cleanup(root, home); }
  });
});

describe('gate-wiring detection warns, never refuses (ZTB-29 dev/03)', () => {
  test('an isolated $HOME with nothing installed -> `loop start` WARNS "ztrack plugin not detected" but still arms', () => {
    const { root } = freshRepo('ztrk-until-nowiring-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env);
      const r = ztrackIn(root, ['loop', 'start', 'ZT-1'], env);
      expect(r.code).toBe(0); // WARN, not refuse
      expect(r.out).toMatch(/ztrack plugin not detected/);
      expect(r.out).toMatch(/loop armed/);
    } finally { cleanup(root, home); }
  });

  test('a $HOME with the ztrack plugin recorded enabled (under its legacy ztrack-gate key) -> `loop start` prints NO gate-wiring warning', () => {
    const { root } = freshRepo('ztrk-until-wired-');
    const { home, env } = isolatedHome();
    try {
      mkdirSync(join(home, '.claude'), { recursive: true });
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ztrack-gate@ztrack': true } }));
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env);
      const r = ztrackIn(root, ['loop', 'start', 'ZT-1'], env);
      expect(r.code).toBe(0);
      expect(r.out).not.toMatch(/ztrack plugin not detected/);
    } finally { cleanup(root, home); }
  });
});

describe('already-green arm-time warning (ZTB-29 dev/04)', () => {
  test('a bare arm on an already-green target WARNS (still arms)', () => {
    const { root } = freshRepo('ztrk-until-green-warn-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env); // draft, no ACs -> trivially green
      const r = ztrackIn(root, ['loop', 'start', 'ZT-1'], env);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/already green/);
    } finally { cleanup(root, home); }
  });

  test('a bare arm on a RED target does NOT print the already-green warning', () => {
    const { root, sha } = freshRepo('ztrk-until-red-nowarn-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      const failing = `# T\n\nSummary: x\n\n## Acceptance Criteria\n\n- [x] dev/01 v1 do it\n  - status: passed\n  - evidence ev1: commit=deadbeef acv=1\n  - proof: "x" -> ev1\n`;
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'ready', '--assignee', 'me', '--body', failing], env);
      const r = ztrackIn(root, ['loop', 'start', 'ZT-1'], env);
      expect(r.code).toBe(0);
      expect(r.out).not.toMatch(/already green/);
      void sha;
    } finally { cleanup(root, home); }
  });

  test('arming with --until on a green-at-current-stage issue is the INTENDED use — no already-green warning', () => {
    const { root } = freshRepo('ztrk-until-green-nowarn-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# T'], env);
      const r = ztrackIn(root, ['loop', 'start', 'ZT-1', '--until', 'done'], env);
      expect(r.code).toBe(0);
      expect(r.out).not.toMatch(/already green/);
    } finally { cleanup(root, home); }
  });
});

describe('the --until oracle itself (ZTB-29 dev/01 quality bar — Option B, check --auto-scope)', () => {
  test('armed --until done + issue in-progress, green at its CURRENT stage -> the turn is HELD', () => {
    const { root, sha } = freshRepo('ztrk-until-oracle-held-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      // in-progress requires >=1 dev AC (ready_requires_dev_ac) but NOT that it's passed
      // (review_requires_all_acs_passed only bites at in-review+) -- so this is green right now.
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'in-progress', '--assignee', 'me', '--body', pendingAcBody('T')], env);
      expect(ztrackIn(root, ['check', 'ZT-1'], env).code).toBe(0); // sanity: green at current stage
      expect(ztrackIn(root, ['loop', 'start', 'ZT-1', '--until', 'done'], env).code).toBe(0);
      const held = ztrackIn(root, ['check', '--auto-scope'], env);
      expect(held.code).not.toBe(0);
      expect(held.out).toMatch(/loop_until_not_reached/);
      expect(held.out).toMatch(/loop-armed until "done"/);
      expect(held.out).toMatch(/currently "in-progress"/);
      void sha;
    } finally { cleanup(root, home); }
  });

  test('genuinely driven to done with real evidence -> the turn is RELEASED', () => {
    const { root, sha } = freshRepo('ztrk-until-oracle-released-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'in-progress', '--assignee', 'me', '--body', pendingAcBody('T')], env);
      expect(ztrackIn(root, ['loop', 'start', 'ZT-1', '--until', 'done'], env).code).toBe(0);
      expect(ztrackIn(root, ['check', '--auto-scope'], env).code).not.toBe(0); // held first

      ztrackIn(root, ['issue', 'edit', 'ZT-1', '--body', passedAcBody('T', sha), '--state', 'done'], env);
      const released = ztrackIn(root, ['check', '--auto-scope'], env);
      expect(released.code).toBe(0);
      expect(released.out).not.toMatch(/loop_until_not_reached/);
    } finally { cleanup(root, home); }
  });

  test('early flip to "done" WITHOUT passing ACs -> STILL HELD (the stage\'s own gates fire — the cheat stays dead)', () => {
    const { root } = freshRepo('ztrk-until-oracle-cheat-');
    const { home, env } = isolatedHome();
    try {
      ztrackIn(root, ['init', '--team', 'ZT'], env);
      ztrackIn(root, ['issue', 'create', '--title', 'T', '--label', 'type:case', '--state', 'in-progress', '--assignee', 'me', '--body', pendingAcBody('T')], env);
      expect(ztrackIn(root, ['loop', 'start', 'ZT-1', '--until', 'done'], env).code).toBe(0);
      // Flip the STATUS to the target early, without ever passing the AC.
      ztrackIn(root, ['issue', 'edit', 'ZT-1', '--state', 'done'], env);
      const stillHeld = ztrackIn(root, ['check', '--auto-scope'], env);
      expect(stillHeld.code).not.toBe(0);
      // curRank(done) >= untilRank(done), so our synthetic finding does NOT fire — the existing
      // preset lifecycle gate is what catches this, proving the two mechanisms are independent.
      expect(stillHeld.out).not.toMatch(/loop_until_not_reached/);
      expect(stillHeld.out).toMatch(/review_requires_all_acs_passed/);
    } finally { cleanup(root, home); }
  });
});
