// ZTB-30: `ztrack issue list --actionable|--blocked` — the dispatch frontier. Black-box e2e (real
// CLI, spawnSync), cribbing the mktemp + freshRepo pattern from cliLoopUntil.e2e.test.ts.
//
// dev/01: --actionable = not-done AND not blocked (the frontier an orchestrator can dispatch onto
// right now). A diamond graph (A blocks B and C; B and C block D) starts with frontier {A}; once A
// is driven to done for real, the frontier becomes {B, C}.
// dev/02: --blocked complements it, naming the NEAREST unmet blocker(s) per issue — not the whole
// transitive closure `blockStatuses` would return (D's nearest is {B, C}, never the transitively
// unmet A). A cross-level case (an issue with no issue-level relations, blocked purely because one
// of its OWN ACs depends on another issue's specific AC) is covered too.
// Design guidance: --actionable/--blocked are mutually exclusive over one shared computation; the
// view degrades honestly with no relations at all (--actionable = everything not done, --blocked =
// nothing); --json field selection is respected, with --blocked always including "blockers".
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function freshRepo(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the installed preset imports 'ztrack/preset-kit'
  gitIn(root, 'init', '-q');
  gitIn(root, 'config', 'user.email', 't@t.co');
  gitIn(root, 'config', 'user.name', 't');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  gitIn(root, 'add', 'README.md');
  gitIn(root, 'commit', '-q', '-m', 'initial commit');
  return root;
}
function cleanup(...dirs: string[]): void { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }

function pendingAcBody(title: string, extraParagraph = ''): string {
  return `# ${title}\n\n${extraParagraph}Summary: do the thing\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 do the thing\n  - status: pending\n`;
}
function acWithBlockedByAc(title: string, ref: string): string {
  return `# ${title}\n\nSummary: cross-level dep\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 do the thing\n  - status: pending\n  - blocked-by: ${ref}\n`;
}
function passedAcBody(title: string, sha: string): string {
  return [
    `# ${title}`, '', 'Summary: do the thing', '', '## Acceptance Criteria', '',
    '- [x] dev/01 v1 do the thing', '  - status: passed', `  - evidence ev1: commit=${sha} acv=1`,
    '  - proof: "shows it" -> ev1', '',
  ].join('\n');
}
function create(root: string, id: string, title: string, body: string, state = 'ready'): void {
  const r = ztrackIn(root, ['issue', 'create', '--title', title, '--label', 'type:case', '--state', state, '--assignee', 'me', '--body', body]);
  expect(r.code).toBe(0);
  void id;
}

describe('--actionable/--blocked: a diamond dependency graph (ZTB-30 dev/01+dev/02)', () => {
  test('frontier starts at {A}; blocked view names A as the nearest blocker for B/C, and B+C (not the transitive A) for D', () => {
    const root = freshRepo('ztrk-frontier-diamond-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      const AC_SECTION = '## Acceptance Criteria\n\n- [ ] dev/01 v1 do the thing\n  - status: pending\n';
      create(root, 'ZT-1', 'A', pendingAcBody('A'));                                                                  // ZT-1
      create(root, 'ZT-2', 'B', `# B\n\nSummary: dep on A\n\nBlocked by: ZT-1\n\n${AC_SECTION}`);                     // ZT-2
      create(root, 'ZT-3', 'C', `# C\n\nSummary: dep on A\n\nBlocked by: ZT-1\n\n${AC_SECTION}`);                     // ZT-3
      create(root, 'ZT-4', 'D', `# D\n\nSummary: dep on B+C\n\nBlocked by: ZT-2, ZT-3\n\n${AC_SECTION}`);             // ZT-4

      const actionable = ztrackIn(root, ['issue', 'list', '--actionable']);
      expect(actionable.code).toBe(0);
      expect(JSON.parse(actionable.out)).toEqual([{ identifier: 'ZT-1', title: 'A', state: 'ready' }]);

      const blocked = ztrackIn(root, ['issue', 'list', '--blocked', '--json', 'identifier,blockers']);
      expect(blocked.code).toBe(0);
      const rows = JSON.parse(blocked.out) as Array<{ identifier: string; blockers: Array<{ ref: string; status: string }> }>;
      const byId = Object.fromEntries(rows.map((r) => [r.identifier, r.blockers.map((b) => b.ref).sort()]));
      expect(byId['ZT-2']).toEqual(['ZT-1']);
      expect(byId['ZT-3']).toEqual(['ZT-1']);
      // D's nearest blockers are B and C — NOT the transitively-unmet A (the full-closure dump
      // `blockStatuses` would give is {A, B, C}; the nearest-hop view must stop at B/C).
      expect(byId['ZT-4']).toEqual(['ZT-2', 'ZT-3']);

      // Drive A to done for real (passed AC + evidence), then re-query: frontier flips to {B, C}.
      const sha = gitIn(root, 'rev-parse', 'HEAD').stdout.trim();
      expect(ztrackIn(root, ['issue', 'edit', 'ZT-1', '--state', 'done', '--body', passedAcBody('A', sha)]).code).toBe(0);
      expect(ztrackIn(root, ['check']).code).toBe(0);

      const actionable2 = JSON.parse(ztrackIn(root, ['issue', 'list', '--actionable']).out) as Array<{ identifier: string }>;
      expect(actionable2.map((r) => r.identifier).sort()).toEqual(['ZT-2', 'ZT-3']);

      const blocked2 = JSON.parse(ztrackIn(root, ['issue', 'list', '--blocked', '--json', 'identifier']).out) as Array<{ identifier: string }>;
      expect(blocked2.map((r) => r.identifier)).toEqual(['ZT-4']);
    } finally { cleanup(root); }
  });
});

describe('cross-level: an AC-level blocked-by gates the whole issue (ZTB-30 dev/02)', () => {
  test('an issue with NO issue-level relations is still --blocked because one of its own ACs depends on another issue\'s specific AC', () => {
    const root = freshRepo('ztrk-frontier-crosslevel-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      create(root, 'ZT-1', 'A', pendingAcBody('A'));                       // ZT-1: A, ac dev/01 pending
      create(root, 'ZT-2', 'E', acWithBlockedByAc('E', 'ZT-1:dev/01'));    // ZT-2: E, ac blocked-by ZT-1:dev/01
      expect(ztrackIn(root, ['check']).code).toBe(0);

      const blocked = JSON.parse(ztrackIn(root, ['issue', 'list', '--blocked', '--json', 'identifier,blockers']).out) as
        Array<{ identifier: string; blockers: Array<{ ref: string; status: string }> }>;
      const e = blocked.find((r) => r.identifier === 'ZT-2');
      expect(e?.blockers).toEqual([{ ref: 'ZT-1:dev/01', status: 'pending' }]);

      const actionable = JSON.parse(ztrackIn(root, ['issue', 'list', '--actionable']).out) as Array<{ identifier: string }>;
      expect(actionable.map((r) => r.identifier)).toEqual(['ZT-1']); // E is not on the frontier yet
    } finally { cleanup(root); }
  });
});

describe('degrade honestly with no relations at all (ZTB-30 design guidance)', () => {
  test('every not-done issue is --actionable; --blocked names none', () => {
    const root = freshRepo('ztrk-frontier-norelations-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      create(root, 'ZT-1', 'X', '# X\n\nSummary: standalone\n', 'draft');
      create(root, 'ZT-2', 'Y', '# Y\n\nSummary: standalone\n', 'draft');
      const actionable = JSON.parse(ztrackIn(root, ['issue', 'list', '--actionable']).out) as Array<{ identifier: string }>;
      expect(actionable.map((r) => r.identifier).sort()).toEqual(['ZT-1', 'ZT-2']);
      const blocked = JSON.parse(ztrackIn(root, ['issue', 'list', '--blocked']).out);
      expect(blocked).toEqual([]);
    } finally { cleanup(root); }
  });
});

describe('flag validation + composability (ZTB-30 design guidance)', () => {
  test('--actionable and --blocked together refuse loudly, naming both flags; nothing crashes', () => {
    const root = freshRepo('ztrk-frontier-mutex-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      create(root, 'ZT-1', 'X', pendingAcBody('X'));
      const r = ztrackIn(root, ['issue', 'list', '--actionable', '--blocked']);
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/--actionable and --blocked are mutually exclusive/);
    } finally { cleanup(root); }
  });

  test('--parent is rejected on the frontier view (not modeled at this level) instead of silently ignored', () => {
    const root = freshRepo('ztrk-frontier-parent-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      create(root, 'ZT-1', 'X', pendingAcBody('X'));
      const r = ztrackIn(root, ['issue', 'list', '--actionable', '--parent', 'ZT-1']);
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/--parent is not supported/);
    } finally { cleanup(root); }
  });

  test('--json field selection is respected; default fields are identifier,title,state', () => {
    const root = freshRepo('ztrk-frontier-json-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      create(root, 'ZT-1', 'X', pendingAcBody('X'));
      const defaultRow = (JSON.parse(ztrackIn(root, ['issue', 'list', '--actionable']).out) as Array<Record<string, unknown>>)[0]!;
      expect(Object.keys(defaultRow)).toEqual(['identifier', 'title', 'state']);
      const customRow = (JSON.parse(ztrackIn(root, ['issue', 'list', '--actionable', '--json', 'identifier,labels']).out) as Array<Record<string, unknown>>)[0]!;
      expect(customRow).toEqual({ identifier: 'ZT-1', labels: ['type:case'] });
    } finally { cleanup(root); }
  });

  test('--state/--label/--search compose on top of the frontier', () => {
    const root = freshRepo('ztrk-frontier-filters-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      create(root, 'ZT-1', 'Alpha task', pendingAcBody('Alpha task'));
      create(root, 'ZT-2', 'Beta task', pendingAcBody('Beta task'));
      const bySearch = JSON.parse(ztrackIn(root, ['issue', 'list', '--actionable', '--search', 'alpha']).out) as Array<{ identifier: string }>;
      expect(bySearch.map((r) => r.identifier)).toEqual(['ZT-1']);
      const byLabel = JSON.parse(ztrackIn(root, ['issue', 'list', '--actionable', '--label', 'type:case']).out) as Array<{ identifier: string }>;
      expect(byLabel.map((r) => r.identifier).sort()).toEqual(['ZT-1', 'ZT-2']);
      const byState = JSON.parse(ztrackIn(root, ['issue', 'list', '--actionable', '--state', 'ready']).out) as Array<{ identifier: string }>;
      expect(byState.map((r) => r.identifier).sort()).toEqual(['ZT-1', 'ZT-2']);
    } finally { cleanup(root); }
  });
});

describe('a repo whose check is otherwise red must not crash the view (degrade honestly)', () => {
  test('a red check (failing evidence) still answers --actionable/--blocked, not a crash', () => {
    const root = freshRepo('ztrk-frontier-red-');
    try {
      ztrackIn(root, ['init', '--team', 'ZT']);
      const failing = `# T\n\nSummary: x\n\n## Acceptance Criteria\n\n- [x] dev/01 v1 do it\n  - status: passed\n  - evidence ev1: commit=deadbeef acv=1\n  - proof: "x" -> ev1\n`;
      create(root, 'ZT-1', 'T', failing);
      expect(ztrackIn(root, ['check']).code).not.toBe(0); // red: fabricated commit
      const r = ztrackIn(root, ['issue', 'list', '--actionable']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.out)).toEqual([]); // ZT-1 is "done" per its ACs (all passed) — not on the frontier
    } finally { cleanup(root); }
  });
});
