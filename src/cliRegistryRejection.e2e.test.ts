// ZTB-24: the flag surface becomes a grammar — black-box e2e (real CLI, spawnSync) pinning the
// dispatch-time unknown-flag validator (cliRegistry.ts's rejectUnknownFlags), `--flag=value`
// support in the backend, `ztrack help <resource>` routing, and the ghost-verb truth fixes
// (`issue get`, `issue comment --body-file`, `issue close --comment-file`). Uses the
// freshRepo/mkdtemp pattern from src/cliCheckInput.e2e.test.ts; rm/rmSync ONLY on literal mkdtemp
// results.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  // FLIPPED by ZTB-42 (Part 3): before ZTB-42, `issue create --title --state --state draft` did
  // NOT create — the literal value "--state" (consumed as --title's value under the backend's own
  // guardless flagVal, hence also read back out as --state's value by the SEPARATE
  // flagVal(args,'state') lookup) was rejected by the PRE-EXISTING (ZTB-23) invalidStateError gate,
  // and this test pinned that the NEW (ZTB-24) registry validator didn't front-run that with ITS
  // OWN "--state: unknown flag" error. ZTB-42 changes what "front-run" means: `--state` now
  // genuinely occurs TWICE in this invocation (the ZTB-41 `--`-guard classifies both as flag
  // occurrences — the first's value is omitted because `--state` looks like a flag, not consumed;
  // the second consumes `draft`), which is exactly the repeat shape Part 3 targets. The registry
  // now catches it BEFORE the handler ever runs, with the repeat-count message — a NEW rejection,
  // but the one this spec commissions, not an "unknown flag" one and not silent first-wins.
  test('2a. FLIPPED (ZTB-42): `issue create --title --state --state draft` now rejects at the registry (repeat), not the old state-vocabulary error', () => {
    const r = ztrackIn(root, ['issue', 'create', '--title', '--state', '--state', 'draft']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toMatch(/--state given 2 times/);
    expect(all).not.toContain('is not a valid status for the active preset');
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

// ZTB-41: `walkArgs` (src/cliRegistry.ts, shared by `rejectUnknownFlags` and `positionalArgs`)
// unconditionally consumed the token after a known value-taking flag as its value — even one
// starting with `--` — while `optionValue` (the parser most handlers actually use) has always
// guarded against exactly this. So a genuinely-unknown flag right after an omitted-value flag was
// absorbed by the registry walk (never classified, never rejected) while the handler independently
// dropped it: a silent wrong result, not a loud error. The fix adds the same `--`-guard to
// `walkArgs`'s consume-next. PROOF these pins are new behavior (not already true on unmodified
// main): `git stash` (reverts src/cliRegistry.ts to the v0.50.0 walk), then
// `bun test -t 'ZTB-41' src/cliRegistryRejection.e2e.test.ts` — every swallowed-typo test below
// fails on main (wrong exit code and/or wrong error text); `git stash pop` restores the fix. See
// the build report for the actual transcript.
describe('cliRegistry: walkArgs `--`-guard on consume-next (ZTB-41)', () => {
  let root = '';
  beforeAll(() => { root = freshRepo('ztrk-reg-walkargs-'); }, 60_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('41a. THE FILED MONEY SHOT: `issue list --state --stat done` rejects loud and suggests --state (today/main: exit 0, prints `[]`) — flagVal-family command', () => {
    const r = ztrackIn(root, ['issue', 'list', '--state', '--stat', 'done']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain('--stat');
    expect(all).toMatch(/did you mean --state/i);
  });

  test('41b. `evidence add --name --typo <file> --commit` rejects loud naming --typo and stores NOTHING (today/main: exit 0, typo swallowed as the name, file stored) — optionValue-family command', () => {
    const file = join(root, 'shot-41b.png');
    writeFileSync(file, Buffer.from('ZTB-41b evidence bytes'));
    const evidenceDirPath = join(root, '.volter', 'evidence');
    const before = existsSync(evidenceDirPath) ? new Set(readdirSync(evidenceDirPath)) : new Set();
    const r = ztrackIn(root, ['evidence', 'add', '--name', '--typo', file, '--commit']);
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toContain('--typo');
    expect(r.err + r.out).toMatch(/unknown flag/i);
    const after = existsSync(evidenceDirPath) ? new Set(readdirSync(evidenceDirPath)) : new Set();
    expect(after).toEqual(before); // nothing new landed in the evidence dir — the handler never ran
  });

  test('41c. `waiver sign --code --typoflag <id>` gives an unknown-flag error naming --typoflag, not the misleading missing-id error (today/main: "needs an issue id") — optionValue-family command', () => {
    const id = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'For waiver typo']).out) as { identifier: string }).identifier;
    const r = ztrackIn(root, ['waiver', 'sign', '--code', '--typoflag', id]);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toMatch(/unknown flag/i);
    expect(all).toContain('--typoflag');
    expect(all).not.toMatch(/needs an issue id/i);
  });

  test('41d. frontier path: `issue list --actionable --state --typo` rejects loud (today/main: exit 0, unfiltered)', () => {
    const r = ztrackIn(root, ['issue', 'list', '--actionable', '--state', '--typo']);
    expect(r.code).not.toBe(0);
    expect(r.out + r.err).toContain('--typo');
    expect(r.out + r.err).toMatch(/unknown flag/i);
  });

  test('41e. a typo NOT preceded by an omitted-value flag rejects exactly as before (byte-identical to the ZTB-24 pin)', () => {
    const withGuard = ztrackIn(root, ['issue', 'list', '--stat', 'open']);
    expect(withGuard.code).not.toBe(0);
    expect(withGuard.out + withGuard.err).toMatch(/did you mean --state/i);
  });

  test('41f. genuine-value invocations stay byte-identical: `--state done`, `--state=done`, `--limit -5` (single-dash value, not a flag)', () => {
    const openId = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'ZTB-41f open', '--state', 'draft']).out) as { identifier: string }).identifier;
    const space = ztrackIn(root, ['issue', 'list', '--state', 'open', '--json', 'identifier']);
    expect(space.code).toBe(0);
    expect((JSON.parse(space.out) as Array<{ identifier: string }>).map((x) => x.identifier)).toContain(openId);
    const eq = ztrackIn(root, ['issue', 'list', '--state=open', '--json', 'identifier']);
    expect(eq.code).toBe(0);
    expect(JSON.parse(eq.out)).toEqual(JSON.parse(space.out));
    // `--limit -5` — a single-dash token is a genuine value, never a flag; must not be rejected.
    const limited = ztrackIn(root, ['issue', 'list', '--limit', '-5', '--json', 'identifier']);
    expect(limited.code).toBe(0);
    expect(() => JSON.parse(limited.out)).not.toThrow();
  });

  test('41g. `check`/`export`/`import` layer priority: `check --input --typo` is still an unknown-flag error naming --typo, exit != 0 (today/main: cliCheck.ts\'s own "Valid flags:" scan wins because the registry silently swallowed --typo as --input\'s value; after the fix the registry\'s dispatch-time validator fires FIRST — same shape of error, different wording layer — "Accepted flags:"/did-you-mean instead of "Valid flags:")', () => {
    const r = ztrackIn(root, ['check', '--input', '--typo']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain('--typo');
    expect(all).toMatch(/unknown flag/i);
    expect(all).toContain('Accepted flags:'); // the registry's wording now wins this shape (was "Valid flags:" pre-ZTB-41)
    expect(all).not.toContain('Valid flags:');
  });
});

// ZTB-42: pre-1.0 flag-surface cleanup — black-box e2e proof of the full behavior contract.
// (1) `--case` (the `--issues` alias) removed outright. (2) the inert hidden flags
// `--verify-commits` (check) and `--blob` (evidence add) removed outright. (3) a non-repeatable
// value-taking flag given more than once now rejects loud at the registry, BEFORE any handler
// runs (same layer-priority precedent as 41g above) — registry-declared repeatables (`--source`,
// `--label`, `--add-label`, `--remove-label`) are unaffected and keep their ZTB-40 union grammar.
describe('cliRegistry: ZTB-42 pre-1.0 flag-surface cleanup', () => {
  let root = '';
  beforeAll(() => { root = freshRepo('ztrk-reg-42-'); }, 60_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('42a. `--case` is REMOVED (not an alias of --issues any more): rejects loud naming --case', () => {
    const r = ztrackIn(root, ['check', '--case', 'ZT-1']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain('--case');
    expect(all).toMatch(/unknown flag/i);
  });

  test('42b. `--verify-commits` is REMOVED (was an accepted no-op): rejects loud, exit != 0', () => {
    const r = ztrackIn(root, ['check', '--verify-commits']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain('--verify-commits');
    expect(all).toMatch(/unknown flag/i);
  });

  test('42c. the action\'s old shape also rejects: `check --input root.json --verify-commits`', () => {
    expect(ztrackIn(root, ['export', '--out', 'root.json']).code).toBe(0);
    const r = ztrackIn(root, ['check', '--input', 'root.json', '--verify-commits']);
    expect(r.code).not.toBe(0);
    expect(r.out + r.err).toContain('--verify-commits');
  });

  test('42d. `--no-verify-commits` is UNCHANGED: still accepted (real escape hatch, not removed)', () => {
    const r = ztrackIn(root, ['check', '--no-verify-commits', '--json']);
    expect(r.out + r.err).not.toMatch(/unknown flag/i);
  });

  test('42e. `evidence add <file> --blob --commit` is REMOVED (was inert): rejects loud, stores nothing', () => {
    const file = join(root, 'shot-42e.png');
    writeFileSync(file, Buffer.from('ZTB-42e evidence bytes'));
    const evidenceDirPath = join(root, '.volter', 'evidence');
    const before = existsSync(evidenceDirPath) ? new Set(readdirSync(evidenceDirPath)) : new Set();
    const r = ztrackIn(root, ['evidence', 'add', file, '--blob', '--commit']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toContain('--blob');
    expect(all).toMatch(/unknown flag/i);
    const after = existsSync(evidenceDirPath) ? new Set(readdirSync(evidenceDirPath)) : new Set();
    expect(after).toEqual(before); // nothing new landed — the handler never ran
  });

  test('42f. `check --issues ZT-1 --issues ZT-2` rejects loud ("given 2 times"), not silent first-wins', () => {
    const r = ztrackIn(root, ['check', '--issues', 'ZT-1', '--issues', 'ZT-2']);
    expect(r.code).not.toBe(0);
    expect(r.out + r.err).toMatch(/--issues given 2 times/);
  });

  test('42g. `issue list --state open --state done` rejects loud (today/main: first-wins, silent)', () => {
    const r = ztrackIn(root, ['issue', 'list', '--state', 'open', '--state', 'done']);
    expect(r.code).not.toBe(0);
    expect(r.out + r.err).toMatch(/--state given 2 times/);
  });

  test('42h. `check --source a --source b` is UNCHANGED: still unions (ZTB-40 repeatable, no rejection)', () => {
    const r = ztrackIn(root, ['check', '--source', 'a', '--source', 'b', '--json']);
    expect(r.out + r.err).not.toMatch(/given \d+ times/);
  });

  test('42i. `issue edit <id> --add-label x --add-label y` is UNCHANGED: still unions', () => {
    const id = (JSON.parse(ztrackIn(root, ['issue', 'create', '--title', 'For 42i']).out) as { identifier: string }).identifier;
    const r = ztrackIn(root, ['issue', 'edit', id, '--add-label', 'x', '--add-label', 'y']);
    expect(r.code).toBe(0);
    expect(r.out + r.err).not.toMatch(/given \d+ times/);
  });

  test('42j. ZTB-41 x ZTB-42 compound shape: `check --issues --issues` rejects loud (2 occurrences, not a swallowed value)', () => {
    const r = ztrackIn(root, ['check', '--issues', '--issues']);
    expect(r.code).not.toBe(0);
    expect(r.out + r.err).toMatch(/--issues given 2 times/);
  });

  test('42k. layer priority (41g precedent): `check --categories a=1 --categories b=2` gets the REGISTRY\'s repeat message, not cliCheck.ts\'s own KNOWN_FLAGS/parseCategories path', () => {
    const r = ztrackIn(root, ['check', '--categories', 'visual=1', '--categories', 'visual=2']);
    expect(r.code).not.toBe(0);
    const all = r.out + r.err;
    expect(all).toMatch(/ztrack check: --categories given 2 times/);
    expect(all).not.toMatch(/invalid --categories entry/); // parseCategories never ran
  });

  test('42l. bool flag repeats are still accepted (out of scope, idempotent): `check --json --json`', () => {
    const r = ztrackIn(root, ['check', '--json', '--json']);
    expect(r.out + r.err).not.toMatch(/given \d+ times/);
  });
});
