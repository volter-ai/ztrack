// ZTB-35 — black-box e2e (real CLI, spawnSync) pinning two "honest output" fixes:
//
// dev/66: `check --fail-on-warning` used to let the banner, the trailing exit-hint line, and
// `--json`'s `ok`/`summary.status` all say "pass" while the process still exited 1 — because the
// exit-code decision counted EVERY finding (including `acknowledged`/waived ones) toward
// `--fail-on-warning`, while the three render surfaces never even looked at the flag. The fix
// makes exactly one `failed` boolean (acknowledged findings never count; only real
// `severity === 'warning'` findings do) drive all four surfaces.
//
// dev/67: a scoped `check <id>` on an issue that EXISTS but fails preset schema validation
// (e.g. an acceptance-criterion `status:` value outside the enum) used to report
// "issue(s) not found in the tracker" instead of the real `wellformed_shape` finding, because the
// missing-detection derived "present" ids from `result.export`, which is unset whenever
// validation fails before the root parses. The fix threads `loadedIssueIds` (the ids the loader
// actually found, regardless of whether validation then passed) through to that check.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const FAKE_ACK = 'aaaaaaa1111111111111111111111111111111a1';
const FAKE_WARN = 'bbbbbbb2222222222222222222222222222222b2';

function ztrackIn(cwd: string, args: string[], env?: Record<string, string>): { code: number; out: string; err: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], {
    cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
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

function createIssue(root: string, title: string, bodyText: string, state = 'ready'): string {
  const bodyFile = join(root, `${title.replace(/\s+/g, '-')}.md`);
  writeFileSync(bodyFile, bodyText);
  const created = ztrackIn(root, ['issue', 'create', '--title', title, '--state', state, '--body-file', bodyFile]);
  expect(created.code).toBe(0);
  return (JSON.parse(created.out) as { identifier: string }).identifier;
}

// One AC citing a nonexistent commit, ref-pinned by a signed waiver (the exact
// `// eslint-disable-next-line` shape) — downgrades to ONE `acknowledged` finding, zero warnings,
// zero errors. Mirrors the sandbox's APP-2 repro (dev/66's original bug report).
const ackOnlyBody = [
  '# Ack only', '', 'Summary: one waived finding, nothing else.', '',
  '## Acceptance Criteria', '',
  '- [x] dev/01 v1 does the thing', '  - status: passed', `  - evidence ev1: commit=${FAKE_ACK} acv=1`, '  - proof: "ev1 shows it" -> ev1', '',
  '## Waivers', '',
  `- code: evidence_commit_not_found ref: ${FAKE_ACK} reason: destroyed in the incident by: Tess (t@t.co)`, '',
].join('\n');

// Two ACs cite the SAME nonexistent commit; one issue-level (unpinned-to-one-AC) `ref:` waiver
// downgrades BOTH occurrences but, because the ref matched more than one, also produces a real
// `waiver_overbroad` WARNING (see engine.ts's applyWaivers) — a genuine warning-severity finding,
// not an acknowledged one, to serve as the --fail-on-warning control.
const warningControlBody = [
  '# Warning control', '', 'Summary: a real warning-severity finding (waiver_overbroad).', '',
  '## Acceptance Criteria', '',
  '- [x] dev/01 v1 first thing', '  - status: passed', `  - evidence ev1: commit=${FAKE_WARN} acv=1`, '  - proof: "ev1 shows it" -> ev1',
  '- [x] dev/02 v1 second thing', '  - status: passed', `  - evidence ev1: commit=${FAKE_WARN} acv=1`, '  - proof: "ev1 shows it" -> ev1', '',
  '## Waivers', '',
  `- code: evidence_commit_not_found ref: ${FAKE_WARN} reason: one ref covers both by: Otto`, '',
].join('\n');

// An AC `status:` value outside the preset's enum ("descoped" is no longer valid post-ZTB-34) —
// `issue create` accepts it (only warns), so it lands in the tracker looking fine until `check`
// parses it against the schema. Mirrors the sandbox's APP-4 repro (dev/67's original bug report).
const schemaInvalidBody = [
  '# Bad shape', '', 'Summary: an AC status outside the preset enum.', '',
  '## Acceptance Criteria', '',
  '- [ ] dev/01 v1 out of scope thing', '  - status: descoped', '',
].join('\n');

describe('check --fail-on-warning: one verdict drives exit/banner/exit-hint/json (ZTB-35 dev/66)', () => {
  test('acknowledged-only: --fail-on-warning still passes on every surface', () => {
    const root = freshRepo('ztrk-honesty-ack-');
    try {
      const id = createIssue(root, 'Ack only', ackOnlyBody);
      const plain = ztrackIn(root, ['check', id, '--fail-on-warning']);
      expect(plain.code).toBe(0);
      expect(plain.out).toContain('ztrack check passed');
      expect(plain.out).toContain('exit 0');

      const json = ztrackIn(root, ['check', id, '--fail-on-warning', '--json']);
      expect(json.code).toBe(0);
      const payload = JSON.parse(json.out) as { ok: boolean; summary: { status: string; acknowledged: number } };
      expect(payload.ok).toBe(true);
      expect(payload.summary.status).toBe('pass');
      expect(payload.summary.acknowledged).toBe(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  test('control: a real warning-severity finding (waiver_overbroad) DOES fail every surface under --fail-on-warning', () => {
    const root = freshRepo('ztrk-honesty-warn-');
    try {
      const id = createIssue(root, 'Warning control', warningControlBody);
      const failing = ztrackIn(root, ['check', id, '--fail-on-warning']);
      expect(failing.code).toBe(1);
      expect(failing.out).toContain('ztrack check failed');
      expect(failing.out).toContain('exit 1');

      const failingJson = ztrackIn(root, ['check', id, '--fail-on-warning', '--json']);
      expect(failingJson.code).toBe(1);
      const failPayload = JSON.parse(failingJson.out) as { ok: boolean; summary: { status: string } };
      expect(failPayload.ok).toBe(false);
      expect(failPayload.summary.status).toBe('fail');

      // Same fixture, WITHOUT the flag: plain checks are unchanged — a warning alone still passes.
      const plain = ztrackIn(root, ['check', id, '--json']);
      expect(plain.code).toBe(0);
      const plainPayload = JSON.parse(plain.out) as { ok: boolean; summary: { status: string } };
      expect(plainPayload.ok).toBe(true);
      expect(plainPayload.summary.status).toBe('warn');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});

describe('scoped check <id> on a schema-invalid issue surfaces wellformed_shape, not "not found" (ZTB-35 dev/67)', () => {
  test('an existing but schema-invalid issue: no throw, real finding, exit 1', () => {
    const root = freshRepo('ztrk-honesty-shape-');
    try {
      const id = createIssue(root, 'Bad shape', schemaInvalidBody);
      const plain = ztrackIn(root, ['check', id]);
      expect(plain.code).toBe(1);
      expect(plain.out).toContain('wellformed_shape');
      expect(plain.out).not.toContain('not found in the tracker');

      const json = ztrackIn(root, ['check', id, '--json']);
      expect(json.code).toBe(1);
      const payload = JSON.parse(json.out) as { ok: boolean; findings: Array<{ code: string }> };
      expect(payload.ok).toBe(false);
      expect(payload.findings.some((f) => f.code === 'wellformed_shape')).toBe(true);

      // A genuinely-absent id is still the not-found error, unchanged.
      const missing = ztrackIn(root, ['check', 'TOTALLY-MISSING']);
      expect(missing.code).not.toBe(0);
      expect(missing.err + missing.out).toContain('not found in the tracker');

      // --issues with one bad-shape (real) id + one truly-missing id: only the missing one errors.
      const mixed = ztrackIn(root, ['check', '--issues', `${id},TOTALLY-MISSING`]);
      expect(mixed.code).not.toBe(0);
      expect(mixed.err + mixed.out).toContain('not found in the tracker');
      expect(mixed.err + mixed.out).toContain('TOTALLY-MISSING');
      expect(mixed.err + mixed.out).not.toContain(id); // the real (schema-invalid but present) id was not reported missing
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);

  // Review round 2: the --auto-scope path derived its known-id list from `result.export` too —
  // the same export-unset-on-shape-failure class. With a VALID active issue A and an UNRELATED
  // schema-invalid issue B anywhere in the tracker, the scoped report used to claim
  // "pinned issue 'A' is not in the tracker" (burying B's wellformed_shape). Now A resolves
  // honestly; the gate still fails CLOSED (B's shape finding carries no issueId, so
  // partitionFindings makes it blocking) but attributes the failure to the real cause.
  test('--auto-scope with a valid pinned issue resolves it even when another issue is schema-invalid', () => {
    const root = freshRepo('ztrk-honesty-scope-');
    try {
      const validId = createIssue(root, 'Clean draft', '# Clean draft\n\nSummary: ok\n', 'draft');
      createIssue(root, 'Bad shape', schemaInvalidBody);
      const r = ztrackIn(root, ['check', '--auto-scope', '--json'], { ZTRACK_ACTIVE_ISSUE: validId });
      expect(r.code).toBe(1); // fails closed: the workspace-level wellformed_shape blocks
      const payload = JSON.parse(r.out) as {
        ok: boolean; activeIssue: string | null;
        scope: { reason: string }; findings: Array<{ code: string }>;
      };
      expect(payload.activeIssue).toBe(validId);           // resolved, not misreported as missing
      expect(payload.scope.reason).not.toContain('not in the tracker');
      expect(payload.ok).toBe(false);
      expect(payload.findings.some((f) => f.code === 'wellformed_shape')).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});
