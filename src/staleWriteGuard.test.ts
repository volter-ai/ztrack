// ztrack#20 — "issue edit silently reverts existing Sources/Evidence/RepoCoverage rows; ac check
// can revert recent edits mid-sequence" (filed against the 0.3.0-era write path).
//
// The two bug classes, as they exist at 1.x:
//
//   Bug 1 (edit treating existing structured rows as immutable) is structurally gone: `issue
//   edit --body` stores the submitted body VERBATIM (backends/markdown.ts serializes frontmatter
//   + body byte-for-byte; no structured merge happens on the way down). The "verbatim body edit"
//   test below PINS that so it can never regress silently.
//
//   Bug 2 (a mutation re-serializing the whole issue from a stale snapshot, clobbering whatever
//   landed in between) was still LIVE: `ac patch`/`issue patch`/`fmt --write`/the MCP tools all
//   read-modify-write (view → compute → wholesale body replacement) with no concurrency guard,
//   and the `--expect-body-sha` precondition was enforced only as a separate CLI pre-check read
//   (itself a race). The fix enforces the precondition INSIDE the backend, against a fresh
//   re-read at the moment of the write, and threads it through the SDK (`expectedBodySha`) from
//   every read-modify-write caller. The "stale snapshot" tests below FAIL on the pre-fix code
//   (the backend used to ignore the flags entirely and clobber).
//
//   A third member of the same failure family fixed here: the SDK's mutation methods discarded
//   the backend's stderr, so a refused edit RESOLVED AS SUCCESS and `edit()` returned the
//   unchanged view — the exact false-positive-success shape reported in the issue (PH-65). The
//   SDK now throws on a backend refusal.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownBackend } from './backends/markdownBackend.ts';
import { markdownStoreDir } from './config.ts';
import { createTrackerClient } from './sdk.ts';

const J = (r: { stdout: string }) => JSON.parse(r.stdout);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const SOURCED_BODY = [
  '# A case',
  '',
  '## Sources',
  '',
  '[1] the ORIGINAL source row',
  '',
  '## Evidence',
  '',
  '[E1] type: screenshot path: a.png',
  '',
].join('\n');

describe('ztrack#20 bug 1 (pin): `issue edit --body` stores the submitted body verbatim', () => {
  test('an edit to an EXISTING Sources/Evidence row persists byte-for-byte — never reverts to the stored row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztrk-20-verbatim-'));
    try {
      const be = createMarkdownBackend(dir, 'PH');
      await be.command(['issue', 'create', '--title', 'A case', '--body', SOURCED_BODY]);
      const edited = SOURCED_BODY
        .replace('[1] the ORIGINAL source row', '[1] the EDITED source row')
        .replace('[E1] type: screenshot path: a.png', '[E1] type: screenshot path: b.png');
      await be.command(['issue', 'edit', 'PH-1', '--body', edited]);
      const view = J(await be.command(['issue', 'view', 'PH-1', '--json']));
      expect(view.body).toBe(edited);
      expect(view.body).toContain('[1] the EDITED source row');
      expect(view.body).not.toContain('ORIGINAL');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ztrack#20 bug 2: --expect-body-sha is enforced by the backend at the write (stale-snapshot clobber guard)', () => {
  test('a write computed from a stale snapshot REFUSES and the concurrent edit survives', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztrk-20-stale-'));
    try {
      const be = createMarkdownBackend(dir, 'PH');
      await be.command(['issue', 'create', '--title', 'A case', '--body', 'the body a patch was computed from']);
      // the "reader" captures the body it will compute its mutation against
      const snapshotSha = sha256((J(await be.command(['issue', 'view', 'PH-1', '--json'])) as { body: string }).body);
      // ...another writer lands in between (the PH-163 incident shape)...
      await be.command(['issue', 'edit', 'PH-1', '--body', 'a CONCURRENT edit that must survive']);
      // ...and the reader's wholesale body replacement must now refuse, not clobber.
      const result = await be.command(['issue', 'edit', 'PH-1', '--body', 'STALE patch result', '--expect-body-sha', snapshotSha]);
      expect(result.stdout).toBe('');
      const payload = JSON.parse(result.stderr) as { ok: boolean; error: string; conflicts: string[]; currentBodySha: string };
      expect(payload.ok).toBe(false);
      expect(payload.error).toBe('precondition-failed');
      expect(payload.conflicts.join(' ')).toContain('body sha256');
      expect(payload.currentBodySha).toBe(sha256('a CONCURRENT edit that must survive'));
      const after = J(await be.command(['issue', 'view', 'PH-1', '--json']));
      expect(after.body).toBe('a CONCURRENT edit that must survive');
      // the store file itself is untouched by the refused write
      expect(readFileSync(join(markdownStoreDir(dir), 'PH-1.md'), 'utf8')).toContain('a CONCURRENT edit that must survive');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a write whose precondition matches the current body proceeds normally', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztrk-20-fresh-'));
    try {
      const be = createMarkdownBackend(dir, 'PH');
      await be.command(['issue', 'create', '--title', 'A case', '--body', 'current body']);
      const result = await be.command(['issue', 'edit', 'PH-1', '--body', 'new body', '--expect-body-sha', sha256('current body')]);
      expect(result.stderr).toBe('');
      expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).body).toBe('new body');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--expect-state mismatch refuses with the same payload shape; a match proceeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztrk-20-state-'));
    try {
      const be = createMarkdownBackend(dir, 'PH');
      await be.command(['issue', 'create', '--title', 'A case', '--state', 'draft']);
      const refused = await be.command(['issue', 'edit', 'PH-1', '--title', 'Renamed', '--expect-state', 'ready']);
      expect(refused.stdout).toBe('');
      expect((JSON.parse(refused.stderr) as { error: string; currentState: string }).error).toBe('precondition-failed');
      expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).title).toBe('A case');
      const accepted = await be.command(['issue', 'edit', 'PH-1', '--title', 'Renamed', '--expect-state', 'draft']);
      expect(accepted.stderr).toBe('');
      expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).title).toBe('Renamed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a refused reparent leaves the new parent\'s `children` view untouched (no half-applied edge)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztrk-20-reparent-'));
    try {
      const be = createMarkdownBackend(dir, 'PH');
      await be.command(['issue', 'create', '--title', 'Parent']);   // PH-1
      await be.command(['issue', 'create', '--title', 'Child']);    // PH-2
      const refused = await be.command(['issue', 'edit', 'PH-2', '--parent', 'PH-1', '--expect-body-sha', sha256('not the current body')]);
      expect((JSON.parse(refused.stderr) as { error: string }).error).toBe('precondition-failed');
      const parent = J(await be.command(['issue', 'view', 'PH-1', '--json']));
      expect(parent.children.nodes).toEqual([]);
      expect(J(await be.command(['issue', 'view', 'PH-2', '--json'])).parent).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ztrack#20: SDK mutations fail loud on a backend refusal (no false-positive success)', () => {
  function clientIn(root: string) {
    mkdirSync(join(root, '.volter'), { recursive: true });
    writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }));
    return createTrackerClient({ projectRoot: root });
  }

  test('edit() with a failed expectedBodySha precondition REJECTS instead of returning the unchanged view', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-20-sdk-'));
    try {
      const client = clientIn(root);
      await client.issue.create({ title: 'A case', body: 'current body' });
      await expect(
        client.issue.edit('PH-1', { body: 'stale wholesale replacement', expectedBodySha: sha256('a body that is no longer current') }),
      ).rejects.toThrow(/precondition-failed/);
      const view = await client.issue.view('PH-1');
      expect((view as { body: string }).body).toBe('current body');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('edit() on a missing issue rejects instead of silently no-opping', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-20-sdk-missing-'));
    try {
      const client = clientIn(root);
      await expect(client.issue.edit('PH-99', { title: 'ghost' })).rejects.toThrow(/not found/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
