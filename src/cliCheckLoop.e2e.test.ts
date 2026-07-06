// Black-box e2e for the unified check/loop TARGET surface — runs the real `ztrack` CLI against
// a real markdown tracker (no network). Covers what the daily-driver "check or loop, several
// formats" vision promises: check an issue id / a file / the whole tracker, the not-found and
// missing-file errors (no more silent false-green), and a loop whose armed target drives the
// Stop-hook gate (`check --auto-scope`).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');        // src/ -> repo root
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';

function ztrack(args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const FAILING_AC = `## Acceptance Criteria

- [x] dev/01 v1 does the thing
  - status: passed
  - evidence ev1: commit=deadbeef acv=1
  - proof: "shows it" -> ev1
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ztrk-cl-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the preset imports 'ztrack/preset-kit'
  ztrack(['init', '--team', 'ZT']);
  ztrack(['issue', 'create', '--title', 'Clean', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# Clean\n\n## Summary\n\nok']); // ZT-1, green
  ztrack(['issue', 'create', '--title', 'Bad', '--label', 'type:case', '--state', 'ready', '--assignee', 'me', '--body', FAILING_AC]); // ZT-2, red (fake commit)
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('check targets', () => {
  test('an issue id checks just that issue', () => {
    expect(ztrack(['check', 'ZT-1']).code).toBe(0);
  });
  test('a non-existent issue id ERRORS (no silent false-green)', () => {
    const r = ztrack(['check', 'ZT-404']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/not found in the tracker/);
  });
  // Regression: an unknown backend verb used to print "unsupported command" but exit 0, so a
  // script or agent that fat-fingered a verb (e.g. `issue update` — the verb is `edit`) believed
  // it worked. A backend error (stderr, no stdout) must exit nonzero.
  test('an unknown verb ERRORS instead of a silent exit-0 no-op', () => {
    const r = ztrack(['issue', 'update', 'ZT-1', '--state', 'done']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/unsupported command/);
  });
  test('a markdown file is checked as one issue and catches a fabricated commit', () => {
    writeFileSync(join(root, 'loose.md'), `Status: ready\n\n${FAILING_AC}`);
    const r = ztrack(['check', './loose.md']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/deadbeef/);
  });
  // ZTB-2: findings carry `origin` (where they came from) — a store-backed issue's finding
  // cites the real committed .md file, and a loose-file check cites that file.
  test('a loose-file check finding carries origin.path pointing at that file', () => {
    const loosePath = join(root, 'loose-origin.md');
    writeFileSync(loosePath, `Status: ready\n\n${FAILING_AC}`);
    const r = ztrack(['check', './loose-origin.md', '--json']);
    expect(r.code).not.toBe(0);
    const payload = JSON.parse(r.out) as { findings: Array<{ code: string; origin?: { path: string; line?: number } }> };
    const finding = payload.findings.find((f) => f.origin);
    // realpathSync: macOS's tmpdir() is a symlink (/var/... -> /private/var/...); the CLI subprocess
    // resolves its cwd through it, so compare against the resolved path, not the raw mkdtemp() one.
    expect(finding?.origin?.path).toBe(realpathSync(loosePath));
  });
  test('a store-backed check finding carries origin.path pointing at the real .md file', () => {
    const r = ztrack(['check', 'ZT-2', '--json']); // ZT-2's fake commit fails under commit verification
    expect(r.code).not.toBe(0);
    const payload = JSON.parse(r.out) as { findings: Array<{ code: string; issueId?: string; origin?: { path: string; line?: number } }> };
    const finding = payload.findings.find((f) => f.issueId === 'ZT-2' && f.origin);
    expect(finding?.origin?.path).toBe(realpathSync(join(root, '.volter', 'tracker', 'markdown', 'ZT-2.md')));
  });
  test('a missing file ERRORS', () => {
    const r = ztrack(['check', './nope.md']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/file not found/);
  });
  // ZTB-1: a loose file's header scan fails LOUD (not open) on a bad line — the check still
  // runs and the warning is visible. ZTB-12: the abort is ATOMIC — none of the Title:/Status:/
  // Assignee: lines matched before the abort are honored (the diagnostic's own wording), so this
  // file is genuinely unassigned/draft, same as if it had no header block at all. The warning
  // itself never gates; `issue_missing_assignee` is what fails the check here, not the header scan.
  test('a loose file with an aborted header block yields loose_header_ignored, discards the whole block, and still checks', () => {
    writeFileSync(join(root, 'loose-header.md'),
      'Title: Loose header\nStatus: ready\nAssignee: otto\nthis line is not Title:/Status:/Assignee:-shaped\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 something\n  - status: pending\n');
    const r = ztrack(['check', './loose-header.md']);
    expect(r.code).not.toBe(0);                             // genuinely unassigned — Assignee: otto was discarded, not honored
    expect(r.out).toMatch(/loose_header_ignored/);           // the header-scan warning still fires
    expect(r.out).toMatch(/this line is not Title:\/Status:\/Assignee:-shaped/);
    expect(r.out).toMatch(/issue_missing_assignee/);         // the actual gate — not the (non-fatal) header warning
  });
  // ZTB-19 (ZL-E5 residual): the original repro — `Summary: x` (non-header-shaped) as the FIRST
  // line meant the header scan never even started, so `Assignee: me` on the very next line was
  // silently swallowed into the body with NO diagnostic at all (unlike the aborted-mid-block case
  // above, which at least warned). Both orderings of this repro must now warn, and — since a
  // dropped assignee is genuinely dropped either way — both must still fail on the real gate
  // (`issue_missing_assignee`), not just on the (non-fatal) header warning.
  test('loose_header_ignored fires for BOTH orderings of the Summary:/Assignee: repro; both still fail on missing assignee', () => {
    writeFileSync(join(root, 'loose-never-started.md'), 'Summary: x\nAssignee: me\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 something\n  - status: pending\n');
    const neverStarted = ztrack(['check', './loose-never-started.md']);
    expect(neverStarted.code).not.toBe(0);
    expect(neverStarted.out).toMatch(/loose_header_ignored/);
    expect(neverStarted.out).toMatch(/Assignee: me/);
    expect(neverStarted.out).toMatch(/issue_missing_assignee/);

    // the reordered case (a real header block started, then aborted) — already fixed; must not regress.
    writeFileSync(join(root, 'loose-reordered.md'), 'Assignee: me\nSummary: x\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 something\n  - status: pending\n');
    const reordered = ztrack(['check', './loose-reordered.md']);
    expect(reordered.code).not.toBe(0);
    expect(reordered.out).toMatch(/loose_header_ignored/);
    expect(reordered.out).toMatch(/issue_missing_assignee/);
  });
  test('a bare check validates the WHOLE tracker (the bad ZT-2 fails it, unlike `check ZT-1`)', () => {
    const all = ztrack(['check']);
    expect(all.code).not.toBe(0);            // whole tracker includes the bad issue
    expect(all.out).toMatch(/ZT-2/);
    expect(ztrack(['check', 'ZT-1']).code).toBe(0); // but the clean issue, alone, passes
  });
  // ZTB-19 (ZL-E4): `--categories` used to accept ANY name=N shape silently — a typo'd category
  // matched no rule and quietly filtered nothing. It's now validated against the engine's real
  // RuleCategory vocabulary; an unknown name is a hard error (exit 1) naming the valid options.
  test('--categories <unknown>=N exits 1 naming the valid categories; a real category name is still accepted', () => {
    const bad = ztrack(['check', 'ZT-1', '--categories', 'bogus=1']);
    expect(bad.code).not.toBe(0);
    expect(bad.out).toMatch(/unknown category 'bogus'/);
    expect(bad.out).toMatch(/wellformed/);
    expect(bad.out).toMatch(/sourced/);
    expect(bad.out).toMatch(/code/);
    expect(bad.out).toMatch(/visual/);
    expect(bad.out).toMatch(/behavioral/);

    const good = ztrack(['check', 'ZT-1', '--categories', 'visual=1']);
    expect(good.out).not.toMatch(/unknown category/);
    expect(good.out).not.toMatch(/unknown flag/);
    expect(good.code).toBe(0); // ZT-1 is the clean issue; a real category name changes nothing about that
  });
  // Commit existence is verified by DEFAULT (the core guarantee). `--no-verify-commits` is the
  // escape hatch for shallow/CI checkouts that lack the cited commits. `--verify-commits` (a
  // former no-op back-compat alias) was removed pre-1.0 (ZTB-42): a stray occurrence now rejects
  // loud as an unknown flag instead of being silently accepted.
  test('commit verification is default-on; --no-verify-commits opts out; --verify-commits is REJECTED (removed, ZTB-42)', () => {
    expect(ztrack(['check', 'ZT-2']).code).not.toBe(0);                     // fake commit caught with no flag
    expect(ztrack(['check', 'ZT-2', '--no-verify-commits']).code).toBe(0);  // escape hatch skips the commit check
    const removed = ztrack(['check', 'ZT-2', '--verify-commits']);
    expect(removed.code).not.toBe(0);
    expect(removed.out).toMatch(/unknown flag/);
    expect(removed.out).toMatch(/--verify-commits/);
  });
});

describe('loop target drives the Stop-hook gate', () => {
  // ZTB-11: arming a DIFFERENT target while one is already armed now REFUSES (arm-collision
  // guard), so each test below that arms a different target than its predecessor explicitly
  // disarms first — this suite's own tests exercise the same rule the collision test does.
  test('loop start <id> scopes the gate to that issue (other red issues are informational)', () => {
    ztrack(['loop', 'stop']); // isolate from whatever the previous test left armed
    expect(ztrack(['loop', 'start', 'ZT-1']).code).toBe(0);
    // ZT-2 is red under default commit verification, but the armed loop gates on ZT-1 → turn may end.
    expect(ztrack(['check', '--auto-scope']).code).toBe(0);
  });
  test('loop start on the red issue gates on it → the turn is held (nonzero)', () => {
    ztrack(['loop', 'stop']); // ZT-1 is still armed from the previous test; disarm before re-targeting
    expect(ztrack(['loop', 'start', 'ZT-2']).code).toBe(0);
    expect(ztrack(['check', '--auto-scope']).code).not.toBe(0);
  });
  test('loop start <file.md> gates on that file', () => {
    ztrack(['loop', 'stop']); // ZT-2 is still armed from the previous test; disarm before re-targeting
    writeFileSync(join(root, 'loop-target.md'), `Status: ready\n\n${FAILING_AC}`);
    expect(ztrack(['loop', 'start', './loop-target.md']).code).toBe(0);
    const r = ztrack(['check', '--auto-scope']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/deadbeef/);
    ztrack(['loop', 'stop']);
  });
  // Regression: `loop start --help` (and `init --help`) used to fall through and EXECUTE the
  // command (arm the loop / provision a tracker) because no resource-help case matched.
  test('`loop --help` and `loop start --help` print help, they do NOT arm the loop', () => {
    const h = ztrack(['loop', '--help']);
    expect(h.code).toBe(0);
    expect(h.out).toMatch(/Usage: ztrack loop/);
    ztrack(['loop', 'start', '--help']);
    expect(ztrack(['loop', 'status']).out).toMatch(/no loop armed/);
  });
  // ZTB-7: the backend mints/serves letter-suffixed ids too (e.g. `ZL-A9`), but the old
  // cliTarget grammar (`/^[A-Za-z][A-Za-z0-9]*-\d+$/`) demanded an all-numeric suffix, so
  // `loop start`/`check` rejected an id every other verb accepted. Fabricate one directly in the
  // store (a letter-suffixed id isn't one the backend itself mints, but is one it MUST serve —
  // this is the workspace-observed shape, e.g. ZL-A9) and prove both verbs now accept it.
  test('loop start/check accept a letter-suffixed issue id, as the backend mints/serves (e.g. ZL-A9)', () => {
    ztrack(['loop', 'stop']); // nothing should be armed here, but disarm defensively before re-targeting
    const storeDir = join(root, '.volter', 'tracker', 'markdown');
    const zt1 = readFileSync(join(storeDir, 'ZT-1.md'), 'utf8');
    writeFileSync(join(storeDir, 'ZT-A9.md'), zt1.replace('identifier: "ZT-1"', 'identifier: "ZT-A9"'));
    expect(ztrack(['check', 'ZT-A9']).code).toBe(0);
    expect(ztrack(['loop', 'start', 'ZT-A9']).code).toBe(0);
    expect(ztrack(['check', '--auto-scope']).code).toBe(0);
    ztrack(['loop', 'stop']);
  }, 30_000);
  // ZTB-11: the gate is root-scoped, not agent-scoped — there's no reliable agent identity at
  // arm time (see plugins/ztrack-gate/hooks/stop-loop.sh), so arming a DIFFERENT target while
  // one is already armed refuses rather than silently stealing the gate out from under whoever
  // armed it (including a subagent's own loop). Re-arming the SAME target (a refresh — new
  // --max, runtime sweep, cap-breadcrumb clear) still succeeds.
  test('loop start refuses a DIFFERENT target while armed; re-arming the SAME target still succeeds', () => {
    ztrack(['loop', 'stop']); // clean slate regardless of prior test order
    expect(ztrack(['loop', 'start', 'ZT-1']).code).toBe(0);
    const before = readFileSync(join(root, '.volter', '.ztrack-loop.json'), 'utf8');
    const collide = ztrack(['loop', 'start', 'ZT-2']);
    expect(collide.code).not.toBe(0);
    expect(collide.out).toMatch(/already armed/);
    const after = readFileSync(join(root, '.volter', '.ztrack-loop.json'), 'utf8');
    expect(after).toBe(before); // the refused arm left the marker byte-for-byte untouched
    expect(ztrack(['loop', 'start', 'ZT-1', '--max', '3']).code).toBe(0); // same target -> refresh, allowed
    ztrack(['loop', 'stop']);
  });
});

describe('CLI footguns: --help/--version never have side effects, and delete works', () => {
  let fresh = '';
  beforeAll(() => {
    fresh = mkdtempSync(join(tmpdir(), 'ztrk-footgun-'));
    mkdirSync(join(fresh, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(fresh, 'node_modules', 'ztrack'));
  });
  afterAll(() => { if (fresh) rmSync(fresh, { recursive: true, force: true }); });
  const zf = (args: string[]) => { const r = spawnSync('bun', ['run', CLI, ...args], { cwd: fresh, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };

  test('`init --help` prints usage and does NOT create a tracker', () => {
    const h = zf(['init', '--help']);
    expect(h.code).toBe(0);
    expect(h.out).toMatch(/Usage: ztrack init/);
    expect(existsSync(join(fresh, '.volter'))).toBe(false); // the footgun: --help must not provision
  });
  test('`--version` works standalone without a tracker config', () => {
    const v = zf(['--version']);
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/^ztrack \d+\.\d+\.\d+/);
    expect(zf(['-v']).out).toMatch(/^ztrack \d+\.\d+\.\d+/);
  });
  // Regression: `lint --help` used to silently RUN lint (exit 0, no output), and fmt/tx/mcp --help
  // errored instead of helping. Every resource's --help must print usage and exit 0 with no action.
  test('`--help` is consistent across resources (lint/fmt/tx/mcp print usage, never execute)', () => {
    for (const r of ['lint', 'fmt', 'tx', 'mcp', 'check', 'loop', 'sync', 'issue', 'ac', 'waiver', 'evidence']) {
      const h = zf([r, '--help']);
      expect(h.code, `\`ztrack ${r} --help\` should exit 0`).toBe(0);
      expect(h.out, `\`ztrack ${r} --help\` should print usage`).toMatch(/Usage: ztrack/);
    }
  }, 30_000);
  test('`issue delete` removes a fat-fingered issue', () => {
    expect(zf(['init', '--team', 'DEL']).code).toBe(0);
    expect(zf(['issue', 'create', '--title', 'Typo', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# x']).code).toBe(0);
    expect(zf(['issue', 'delete', 'DEL-1']).code).toBe(0);
    expect(zf(['issue', 'view', 'DEL-1']).out).toMatch(/not found/);
  }, 30_000);
});
