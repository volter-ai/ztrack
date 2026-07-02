// ZTB-4 dev/08 e2e: a `format: "document"` source declared alongside the default issue-per-file
// store — a real black-box CLI drive (spawns `bun run cli.ts`, same style as
// sourcesConfig.e2e.test.ts). Covers the read path only (write-back is dev/09, and MUST fail
// closed here): `issue list` unions both populations with correct parents, `issue view` on a
// document-sourced issue works and its JSON origin points at the file (with a line span), a write
// routed at a document-sourced issue is rejected naming the file, `issue create` still mints into
// the issue-per-file source, and an id colliding between the document and the store surfaces as
// `issue_id_conflict`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const runIn = (cwd: string, cmd: string, args: string[]) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const gitIn = (cwd: string, ...a: string[]) => runIn(cwd, 'git', a);
const ztIn = (cwd: string, ...a: string[]) => { const r = runIn(cwd, 'bun', ['run', CLI, ...a]); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const configPath = (root: string) => join(root, '.volter', 'tracker-config.json');
const idOf = (out: string): string => /\b([A-Z]+-\d+)\b/.exec(out)?.[1] ?? `NO_ID: ${out}`;
const setSources = (root: string, sources: Array<{ path: string; format?: 'document' | 'issue-per-file'; readonly?: boolean }>) => {
  const cfg = JSON.parse(readFileSync(configPath(root), 'utf8')) as Record<string, unknown>;
  cfg.sources = sources;
  writeFileSync(configPath(root), `${JSON.stringify(cfg, null, 2)}\n`);
};

const DOC = [
  '# Docs (no Title: header — no umbrella issue)',
  '',
  '## DOC-1 — Alpha item',
  '',
  'Alpha body text.',
  '',
  '### DOC-1A — Alpha child',
  '',
  'Alpha child body text.',
  '',
  '## DOC-2 — Beta item',
  '',
  'Beta body text.',
  '',
].join('\n');

let root = '';
let rootReal = ''; // realpathSync(root): macOS's tmpdir() is a symlink (/var/... -> /private/var/...);
// the CLI subprocess resolves its cwd through it, so origin.path (read back from the CLI's own
// process) is the resolved path, not the raw mkdtemp() one (see cliCheckLoop.e2e.test.ts's note).
const docPath = () => join(rootReal, 'doc.md');

describe('document source (ZTB-4 dev/08): read path alongside the default issue-per-file store', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-docsrc-'));
    rootReal = realpathSync(root);
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    gitIn(root, 'init', '-q'); gitIn(root, 'config', 'user.email', 't@t.co'); gitIn(root, 'config', 'user.name', 't');
    expect(ztIn(root, 'init', '--team', 'APP').code).toBe(0);
    writeFileSync(docPath(), DOC);
    // The default store declared explicitly (same relative path markdownStoreDir() resolves to)
    // alongside the document source — "a document source declared alongside the default store".
    setSources(root, [{ path: '.volter/tracker/markdown' }, { path: 'doc.md', format: 'document' }]);
  }, 60_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('1. `issue list` unions both populations, with the document issues\' parent links intact', () => {
    const list = ztIn(root, 'issue', 'list', '--json', 'identifier,parent');
    const rows = JSON.parse(list.out) as Array<{ identifier: string; parent: string }>;
    const byId = new Map(rows.map((r) => [r.identifier, r.parent]));
    expect(byId.has('DOC-1')).toBe(true);
    expect(byId.has('DOC-1A')).toBe(true);
    expect(byId.has('DOC-2')).toBe(true);
    expect(byId.get('DOC-1A')).toBe('DOC-1'); // nesting -> parent link, for free through the same list path
    expect(byId.get('DOC-1')).toBe('');       // no umbrella (no Title: header) -> no parent
  });

  test('1b. `issue list --parent` filtering works on document-sourced issues too', () => {
    const list = ztIn(root, 'issue', 'list', '--parent', 'DOC-1', '--json', 'identifier');
    const ids = (JSON.parse(list.out) as Array<{ identifier: string }>).map((r) => r.identifier);
    expect(ids).toEqual(['DOC-1A']);
  });

  test('2. `issue view` on a document-sourced issue works; its JSON origin points at the doc file with a line span', () => {
    const view = ztIn(root, 'issue', 'view', 'DOC-1', '--json');
    expect(view.code).toBe(0);
    const v = JSON.parse(view.out) as { identifier: string; title: string; path: string; lineStart: number; lineEnd: number; children: { nodes: Array<{ identifier: string }> } };
    expect(v.identifier).toBe('DOC-1');
    expect(v.title).toBe('Alpha item');
    expect(v.path).toBe(docPath());
    expect(typeof v.lineStart).toBe('number');
    expect(typeof v.lineEnd).toBe('number');
    expect(v.children.nodes.map((n) => n.identifier)).toEqual(['DOC-1A']);
  });

  test('3. a write routed at a document-sourced issue fails closed, naming the file and dev/09', () => {
    const result = ztIn(root, 'issue', 'edit', 'DOC-1', '--title', 'Renamed');
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('document');
    expect(result.out).toContain('dev/09');
    expect(result.out).toContain(docPath());
  });

  let mintedId = '';
  test('4. `issue create` mints into the issue-per-file source, never the document source', () => {
    const created = ztIn(root, 'issue', 'create', '--title', 'Gamma', '--label', 'type:case', '--state', 'draft', '--assignee', 'me');
    expect(created.code).toBe(0);
    // The new id's numeric suffix is the max across EVERY source's ids (not just APP-prefixed
    // ones — a pre-existing quirk, unrelated to ZTB-4: DOC-1/DOC-1A/DOC-2 already inflate the
    // counter), so don't assume APP-1 — just confirm it's an APP id, minted issue-per-file.
    mintedId = idOf(created.out);
    expect(mintedId.startsWith('APP-')).toBe(true);
    expect(() => readFileSync(join(root, '.volter', 'tracker', 'markdown', `${mintedId}.md`), 'utf8')).not.toThrow();
  });

  test('5. an id colliding between the document and the store yields issue_id_conflict from `ztrack check`, naming both paths', () => {
    // Plant the collision: the store already has `mintedId` (from test 4); add a same-id heading
    // to the doc.
    writeFileSync(docPath(), `${DOC}\n## ${mintedId} — Colliding id\n\nThis id also exists in the issue-per-file store.\n`);
    const result = ztIn(root, 'check', '--json');
    expect(result.code).not.toBe(0);
    const payload = JSON.parse(result.out) as { findings: Array<{ code: string; issueId?: string; message: string }> };
    const conflict = payload.findings.find((f) => f.code === 'issue_id_conflict' && f.issueId === mintedId);
    expect(conflict).toBeDefined();
    expect(conflict!.message).toContain(docPath());
    // The default source is shared-board (this repo IS a git worktree), so the store-side path
    // cited may be the board-index symlink rather than `.volter/tracker/markdown/` directly —
    // assert the general shape (two distinct paths, the second one an `<mintedId>.md`) rather
    // than one exact directory.
    expect(conflict!.message).toContain(`${mintedId}.md`);
    expect(conflict!.message.match(/\.md\b/g)?.length).toBe(2);
  });
});
