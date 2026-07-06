// ZTB-24: the flag surface becomes a grammar — black-box e2e (real CLI, spawnSync) pinning the
// dispatch-time unknown-flag validator (cliRegistry.ts's rejectUnknownFlags), `--flag=value`
// support in the backend, `ztrack help <resource>` routing, and the ghost-verb truth fixes
// (`issue get`, `issue comment --body-file`, `issue close --comment-file`). Uses the
// freshRepo/mkdtemp pattern from src/cliCheckInput.e2e.test.ts; rm/rmSync ONLY on literal mkdtemp
// results.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const gitIn = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function freshRepo(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
  gitIn(root, 'init', '-q');
  gitIn(root, 'config', 'user.email', 't@t.co');
  gitIn(root, 'config', 'user.name', 'Tess');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  gitIn(root, 'add', 'README.md');
  gitIn(root, 'commit', '-q', '-m', 'initial');
  expect(ztrackIn(root, ['init', '--team', 'ZT']).code).toBe(0);
  return root;
}

describe('cliRegistry: dispatch-time unknown-flag rejection (ZTB-24 dev/01)', () => {
  let root = '';
  beforeAll(() => { root = freshRepo('ztrk-reg-reject-'); }, 60_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('1a. THE FILED MONEY SHOT: `issue list --stat open` rejects loud and suggests --state (not a silent full unfiltered list)', () => {
    const r = ztrackIn(root, ['issue', 'list', '--stat', 'open']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain('--stat');
    expect(all).toMatch(/did you mean --state/i);
  });

  test('1b. `issue list --wat foo` rejects loud', () => {
    const r = ztrackIn(root, ['issue', 'list', '--wat', 'foo']);
    expect(r.code).not.toBe(0);
  });

  test('1c. `lint --definitely-not-a-real-flag` rejects loud (the parked-note repro)', () => {
    const r = ztrackIn(root, ['lint', '--definitely-not-a-real-flag']);
    expect(r.code).not.toBe(0);
  });

  // Re-verified against unmodified main (`git show main:src/backends/markdownBackend.ts`):
  // `issue create --title --state --state draft` does NOT create there either — the literal
  // value "--state" (consumed as --title's value, hence also read back out as --state's value by
  // the SEPARATE flagVal(args,'state') lookup) is rejected by the PRE-EXISTING (ZTB-23)
  // invalidStateError gate, unrelated to this fix. What matters here is that the NEW registry
  // validator doesn't front-run that with ITS OWN "--state: unknown flag" error — the value-in-
  // flag-position token must reach the SAME pre-existing gate as it did before this fix, byte for
  // byte, not a new one.
  test('2a. value-position preservation: `issue create --title --state --state draft` reaches the SAME pre-existing state-vocabulary error, not a new "unknown flag" one', () => {
    const r = ztrackIn(root, ['issue', 'create', '--title', '--state', '--state', 'draft']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain('is not a valid status for the active preset');
    expect(all).not.toMatch(/unknown flag/i);
  });

  test('2a\'. value-position preservation, a form that actually creates: `issue create --title --body value` mints title "--body"', () => {
    const r = ztrackIn(root, ['issue', 'create', '--title', '--body', 'value']);
    expect(r.code).toBe(0);
    const created = JSON.parse(r.out) as { title: string; body: string };
    expect(created.title).toBe('--body'); // garbage in — but it worked before and must keep working
    expect(created.body).toBe('value');
  });

  test('2b. `issue list --state open` and `--state=open` both actually filter (the = form is NEW)', () => {
    // Seed one open and one done issue so a filter has something to prove.
    const openId = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'Open one', '--state', 'draft']).out) as { identifier: string }).identifier;
    const doneId = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'Done one']).out) as { identifier: string }).identifier;
    expect(ztrackIn(root, ['issue', 'close', doneId]).code).toBe(0);

    const spaceForm = ztrackIn(root, ['issue', 'list', '--state', 'open', '--json', 'identifier']);
    expect(spaceForm.code).toBe(0);
    const spaceIds = (JSON.parse(spaceForm.out) as Array<{ identifier: string }>).map((r) => r.identifier);
    expect(spaceIds).toContain(openId);
    expect(spaceIds).not.toContain(doneId);

    const eqForm = ztrackIn(root, ['issue', 'list', '--state=open', '--json', 'identifier']);
    expect(eqForm.code).toBe(0);
    const eqIds = (JSON.parse(eqForm.out) as Array<{ identifier: string }>).map((r) => r.identifier);
    expect(eqIds).toEqual(spaceIds);
  });

  test('3a. did-you-mean quality: `check --no-verify-commit` (missing s) suggests --no-verify-commits', () => {
    const r = ztrackIn(root, ['check', '--no-verify-commit']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain('--no-verify-commit');
    expect(all).toMatch(/did you mean --no-verify-commits/i);
  });

  test('3b. unknown flag with no near match lists the command\'s accepted flags', () => {
    const r = ztrackIn(root, ['check', '--totally-unrelated-bogus-thing']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain('--totally-unrelated-bogus-thing');
    expect(all).toMatch(/accepted flags/i);
    expect(all).toContain('--issues'); // one of check's real flags, named in the hint
  });

  test('7. `check <id> --help` prints usage, exit 0 (fix 8 — --help anywhere, not just first token)', () => {
    const id = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'For check help']).out) as { identifier: string }).identifier;
    const r = ztrackIn(root, ['check', id, '--help']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Usage: \S+ check/);
  });

  test('8a. no-regression canary: `issue list --state open --json identifier,state`', () => {
    const r = ztrackIn(root, ['issue', 'list', '--state', 'open', '--json', 'identifier,state']);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.out)).not.toThrow();
  });

  test('8b. no-regression canary: `check --json`', () => {
    const r = ztrackIn(root, ['check', '--json']);
    expect(() => JSON.parse(r.out)).not.toThrow();
  });

  test('8c. no-regression canary: `export --out root.json`', () => {
    const r = ztrackIn(root, ['export', '--out', 'root.json']);
    expect(r.code).toBe(0);
  });

  test('8d. no-regression canary: `issue edit <id> --state <valid>` still works', () => {
    const id = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'For edit canary']).out) as { identifier: string }).identifier;
    const r = ztrackIn(root, ['issue', 'edit', id, '--state', 'ready']);
    expect(r.code).toBe(0);
  });
});

describe('cliRegistry: `ztrack help <resource>` routing (ZTB-24 dev/02)', () => {
  let root = '';
  beforeAll(() => { root = freshRepo('ztrk-reg-help-'); }, 60_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('4a. `help issue` -> the issue RESOURCE help, not the generic top-level help', () => {
    const r = ztrackIn(root, ['help', 'issue']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Usage: \S+ issue <action>/);
    expect(r.out).not.toMatch(/Start here — pick your situation/); // distinctive top-level-help text
  });

  test('4b. `help issue patch` -> patch\'s own focused usage', () => {
    const r = ztrackIn(root, ['help', 'issue', 'patch']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Usage: \S+ issue patch/);
    expect(r.out).toContain('--json');
    expect(r.out).toContain('--dry-run');
  });

  test('4c. `help check` -> check\'s own usage', () => {
    const r = ztrackIn(root, ['help', 'check']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Usage: \S+ check/);
  });

  test('4d. `help wat` -> exit != 0 with guidance, never the generic top-level help', () => {
    const r = ztrackIn(root, ['help', 'wat']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain("no help for 'wat'");
    expect(all).not.toMatch(/Start here — pick your situation/);
  });

  test("4e. `help wat` is CONFIG-FREE: same friendly error in a directory with no tracker at all", () => {
    // help must be a total function — asking "what is 'wat'?" never needs a tracker config. Pinned
    // in a bare mkdtemp dir (no init, no git) so a regression to "No tracker config found" trips.
    const bare = mkdtempSync(join(tmpdir(), 'ztrk-reg-nohelp-'));
    try {
      const r = ztrackIn(bare, ['help', 'wat']);
      expect(r.code).not.toBe(0);
      const all = r.out + r.err;
      expect(all).toContain("no help for 'wat'");
      expect(all).not.toMatch(/No tracker config found/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test('5a. `issue patch --help` -> focused usage naming --json and --dry-run', () => {
    const r = ztrackIn(root, ['issue', 'patch', '--help']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Usage: \S+ issue patch/);
    expect(r.out).toContain('--json');
    expect(r.out).toContain('--dry-run');
  });

  test('5b. `issue delete --help` -> its own usage line', () => {
    const r = ztrackIn(root, ['issue', 'delete', '--help']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Usage: \S+ issue delete/);
  });
});

describe('cliRegistry: ghost-verb truth (ZTB-24 dev/05)', () => {
  let root = '';
  beforeAll(() => { root = freshRepo('ztrk-reg-ghosts-'); }, 60_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('6a. `issue get <id>` now works, same output as `issue view <id>`', () => {
    const id = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'Ghost get', '--body', '# Ghost get\n\nx']).out) as { identifier: string }).identifier;
    const get = ztrackIn(root, ['issue', 'get', id, '--json']);
    const view = ztrackIn(root, ['issue', 'view', id, '--json']);
    expect(get.code).toBe(0);
    expect(get.out).toBe(view.out);
  });

  test('6b. `issue comment <id> --body-file f.md` writes the file\'s content', () => {
    const id = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'Ghost comment']).out) as { identifier: string }).identifier;
    const bodyFile = join(root, 'comment-body.md');
    writeFileSync(bodyFile, 'comment from a file');
    expect(ztrackIn(root, ['issue', 'comment', id, '--body-file', bodyFile]).code).toBe(0);
    const view = JSON.parse(ztrackIn(root, ['issue', 'view', id, '--json']).out) as { comments: { nodes: Array<{ body: string }> } };
    expect(view.comments.nodes.some((c) => c.body === 'comment from a file')).toBe(true);
  });

  test('6c. `issue close <id> --comment-file f.md` records it', () => {
    const id = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'Ghost close']).out) as { identifier: string }).identifier;
    const commentFile = join(root, 'close-comment.md');
    writeFileSync(commentFile, 'closed via file content');
    expect(ztrackIn(root, ['issue', 'close', id, '--comment-file', commentFile]).code).toBe(0);
    const view = JSON.parse(ztrackIn(root, ['issue', 'view', id, '--json']).out) as { state: { name: string }; comments: { nodes: Array<{ body: string }> } };
    expect(view.state.name).toBe('done');
    expect(view.comments.nodes.some((c) => c.body === 'closed via file content')).toBe(true);
  });
});
