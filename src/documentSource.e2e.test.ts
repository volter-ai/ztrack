// ZTB-4 dev/08 + dev/09 e2e: a `format: "document"` source declared alongside the default
// issue-per-file store — a real black-box CLI drive (spawns `bun run cli.ts`, same style as
// sourcesConfig.e2e.test.ts). This file covers: `issue list` unions both populations with correct
// parents, `issue view` on a document-sourced issue works and its JSON origin points at the file
// (with a line span), `issue create` still mints into the issue-per-file source, and an id
// colliding between the document and the store surfaces as `issue_id_conflict` (dev/08); a write
// still fails closed for operations write-back doesn't support (dev/09's guards); and — the
// dev/09 headline — a real `ztrack ac patch` splices into a document source's recorded span,
// proven byte-diff-clean (see the "byte-diff splice" describe block below).
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

  test('3. a `--title` write routed at a document-sourced issue now SUCCEEDS (dev/09 splice); the file gains the new heading text', () => {
    // DOC-1 has a nested id-bearing child (DOC-1A) — its subtree was excised, so DOC-1 itself
    // fails closed regardless of field (see test 3c below); DOC-2 has no such child and is the
    // plain splice-writable case.
    const before = readFileSync(docPath(), 'utf8');
    const result = ztIn(root, 'issue', 'edit', 'DOC-2', '--title', 'Renamed');
    expect(result.code).toBe(0);
    const after = readFileSync(docPath(), 'utf8');
    expect(after).toContain('## DOC-2 — Renamed');
    expect(after).not.toBe(before);
    // Restore the fixture so every OTHER test in this describe block (which assumes the
    // original DOC.md contents) is unaffected by this test's write.
    writeFileSync(docPath(), before);
  });

  test('3b. a write that changes a document item\'s STATE still fails closed (dev/09 splices only body/title), naming the file', () => {
    const before = readFileSync(docPath(), 'utf8');
    const result = ztIn(root, 'issue', 'edit', 'DOC-2', '--state', 'done');
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('document');
    expect(result.out).toContain('status');
    expect(result.out).toContain(docPath());
    expect(readFileSync(docPath(), 'utf8')).toBe(before); // nothing was written
  });

  test('3c. a write on DOC-1 (its subtree was excised by nested child DOC-1A) fails closed regardless of field', () => {
    const before = readFileSync(docPath(), 'utf8');
    const result = ztIn(root, 'issue', 'edit', 'DOC-1', '--title', 'Renamed');
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('document');
    expect(result.out).toContain(docPath());
    expect(readFileSync(docPath(), 'utf8')).toBe(before);
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

const J = (r: { out: string }): unknown => JSON.parse(r.out);

describe('document source write-back (ZTB-4 dev/09): byte-diff splice through the real CLI', () => {
  let wbRoot = '';
  let wbRootReal = '';
  const wbDocPath = () => join(wbRootReal, 'doc.md');
  let headSha = '';

  // Canonical shape: preamble, an item with a `status:`/`assignee:` header block, a `### Context`
  // note subsection (position fidelity — ZTB-5, now proven through the document splice), and a
  // `### Acceptance Criteria` with TWO ACs in canonical AC-line form; a second, similar item.
  const WB_DOC = [
    '# Team backlog (no `Title:` header — no umbrella issue)',
    '',
    'Some preamble prose that must never move.',
    '',
    '## DOC-1 — Alpha item',
    '',
    'status: in-progress',
    'assignee: kim',
    '',
    '### Context',
    '',
    'A context note for Alpha — its position must survive the splice.',
    '',
    '### Acceptance Criteria',
    '',
    '- [ ] AC-1 v1 First criterion',
    '  - status: pending',
    '- [ ] AC-2 v1 Second criterion',
    '  - status: pending',
    '',
    '## DOC-2 — Beta item',
    '',
    'status: draft',
    'assignee: sam',
    '',
    '### Acceptance Criteria',
    '',
    '- [ ] AC-1 v1 Beta criterion',
    '  - status: pending',
    '',
  ].join('\n');

  beforeAll(() => {
    wbRoot = mkdtempSync(join(tmpdir(), 'ztrk-docwb-'));
    wbRootReal = realpathSync(wbRoot);
    mkdirSync(join(wbRoot, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(wbRoot, 'node_modules', 'ztrack'));
    gitIn(wbRoot, 'init', '-q'); gitIn(wbRoot, 'config', 'user.email', 't@t.co'); gitIn(wbRoot, 'config', 'user.name', 't');
    expect(ztIn(wbRoot, 'init', '--team', 'APP').code).toBe(0);
    writeFileSync(wbDocPath(), WB_DOC);
    setSources(wbRoot, [{ path: '.volter/tracker/markdown' }, { path: 'doc.md', format: 'document' }]);
    gitIn(wbRoot, 'add', '-A');
    gitIn(wbRoot, 'commit', '-q', '-m', 'seed');
    headSha = gitIn(wbRoot, 'rev-parse', 'HEAD').stdout.trim();
    expect(headSha).toMatch(/^[0-9a-f]{7,40}$/);
  }, 60_000);
  afterAll(() => { if (wbRoot) rmSync(wbRoot, { recursive: true, force: true }); });

  test('1. `ztrack ac patch` splices DOC-1/AC-1 in place — every other byte in the file is untouched', () => {
    const beforeText = readFileSync(wbDocPath(), 'utf8');
    const viewBefore = J(ztIn(wbRoot, 'issue', 'view', 'DOC-1', '--json')) as { lineStart: number; lineEnd: number };
    const { lineStart } = viewBefore;
    expect(typeof lineStart).toBe('number');

    const patchJson = JSON.stringify({
      checked: true, status: 'passed',
      evidence: [{ id: 'ev1', commit: headSha, acVersion: 1 }],
      proof: { explanation: 'the seed commit establishes the criterion', evidenceRefs: ['ev1'] },
    });
    const patch = ztIn(wbRoot, 'ac', 'patch', 'DOC-1', 'AC-1', '--json', patchJson);
    expect(patch.code).toBe(0);
    expect(JSON.parse(patch.out)).toMatchObject({ issue: 'DOC-1', acId: 'AC-1', changed: true });

    const afterText = readFileSync(wbDocPath(), 'utf8');
    expect(afterText).not.toBe(beforeText);

    const beforeLines = beforeText.split('\n');
    const afterLines = afterText.split('\n');

    // Byte-diff, presetConformance's edit-locality style: everything BEFORE AC-1's block (by line
    // index from the start) is untouched; everything AFTER it (by line index from the END — the
    // block itself can grow, e.g. gaining an evidence/proof line) is untouched.
    const acLineRe = /^- \[.\] AC-1\b/;
    const startIdx = beforeLines.findIndex((l) => acLineRe.test(l));
    expect(startIdx).toBeGreaterThanOrEqual(0);
    let endIdx = beforeLines.length;
    for (let i = startIdx + 1; i < beforeLines.length; i++) {
      if (/^- \[.\] /.test(beforeLines[i]!)) { endIdx = i; break; }
    }
    expect(afterLines.slice(0, startIdx)).toEqual(beforeLines.slice(0, startIdx));
    const suffix = beforeLines.slice(endIdx);
    expect(afterLines.slice(afterLines.length - suffix.length)).toEqual(suffix);

    // The bytes BEFORE DOC-1's recorded span (the preamble) are untouched, by line index from the
    // start (`lineStart` was fetched BEFORE the patch and is 1-based).
    expect(afterLines.slice(0, lineStart - 1)).toEqual(beforeLines.slice(0, lineStart - 1));

    // DOC-2's whole section (and everything after it) is untouched — it's the tail of the file.
    const doc2At = beforeText.indexOf('## DOC-2 — Beta item');
    expect(doc2At).toBeGreaterThan(0);
    const tail = beforeText.slice(doc2At);
    expect(afterText.endsWith(tail)).toBe(true);

    // `### Context` did not move (ZTB-5 position fidelity, now proven through the document splice).
    expect(afterLines.indexOf('### Context')).toBe(beforeLines.indexOf('### Context'));
    expect(afterLines.indexOf('### Context')).toBeGreaterThan(0);
  });

  test('2. `ztrack check` passes after the patch (both items have an assignee via their header block; in-progress has an AC)', () => {
    const result = ztIn(wbRoot, 'check', '--json');
    expect(result.code).toBe(0);
  });

  test('3. `issue view DOC-1 --json` reflects the new AC state, in-process AND cross-process', () => {
    const view = J(ztIn(wbRoot, 'issue', 'view', 'DOC-1', '--json')) as { body: string };
    expect(view.body).toContain('- [x] AC-1 v1 First criterion');
    expect(view.body).toContain('status: passed');
  });

  test('4. `issue edit DOC-1 --title` succeeds; the ONLY changed line in the file is the heading line', () => {
    const before = readFileSync(wbDocPath(), 'utf8');
    const result = ztIn(wbRoot, 'issue', 'edit', 'DOC-1', '--title', 'Renamed item');
    expect(result.code).toBe(0);
    const after = readFileSync(wbDocPath(), 'utf8');
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    expect(beforeLines.length).toBe(afterLines.length);
    const changedIdx = beforeLines.map((l, i) => (l === afterLines[i] ? -1 : i)).filter((i) => i !== -1);
    expect(changedIdx).toEqual([beforeLines.findIndex((l) => l.startsWith('## DOC-1'))]);
    expect(afterLines[changedIdx[0]!]).toBe('## DOC-1 — Renamed item');
  });

  test('5. fail-closed: `issue edit DOC-1 --state done` is rejected, file byte-identical, message names the file and the status: header line', () => {
    const before = readFileSync(wbDocPath(), 'utf8');
    const result = ztIn(wbRoot, 'issue', 'edit', 'DOC-1', '--state', 'done');
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(wbDocPath());
    expect(result.out).toContain('status:');
    expect(readFileSync(wbDocPath(), 'utf8')).toBe(before);
  });

  test('6. fail-closed: `issue comment DOC-1` is rejected, file byte-identical', () => {
    const before = readFileSync(wbDocPath(), 'utf8');
    const result = ztIn(wbRoot, 'issue', 'comment', 'DOC-1', '--body', 'x');
    expect(result.code).not.toBe(0);
    expect(readFileSync(wbDocPath(), 'utf8')).toBe(before);
  });

  test('7. fail-closed: `issue delete DOC-1` is rejected, file byte-identical', () => {
    const before = readFileSync(wbDocPath(), 'utf8');
    const result = ztIn(wbRoot, 'issue', 'delete', 'DOC-1');
    expect(result.code).not.toBe(0);
    expect(readFileSync(wbDocPath(), 'utf8')).toBe(before);
  });

  test('8. fail-closed: editing the umbrella of a `Title:`-header document is rejected, file byte-identical', () => {
    const umbrellaRoot = mkdtempSync(join(tmpdir(), 'ztrk-docwb-umbrella-'));
    try {
      mkdirSync(join(umbrellaRoot, 'node_modules'), { recursive: true });
      symlinkSync(REPO, join(umbrellaRoot, 'node_modules', 'ztrack'));
      gitIn(umbrellaRoot, 'init', '-q'); gitIn(umbrellaRoot, 'config', 'user.email', 't@t.co'); gitIn(umbrellaRoot, 'config', 'user.name', 't');
      expect(ztIn(umbrellaRoot, 'init', '--team', 'APP').code).toBe(0);
      const umbrellaDoc = [
        'Title: TRACK-Z — Test document',
        '',
        '## ZTB-1 — An item',
        '',
        'status: draft',
        'assignee: kim',
        '',
        'Body text.',
        '',
      ].join('\n');
      writeFileSync(join(umbrellaRoot, 'doc.md'), umbrellaDoc);
      setSources(umbrellaRoot, [{ path: '.volter/tracker/markdown' }, { path: 'doc.md', format: 'document' }]);
      const before = readFileSync(join(umbrellaRoot, 'doc.md'), 'utf8');
      const umbrellaId = 'doc'; // the umbrella's id comes from the FILENAME (fileToRecord semantics)
      const result = ztIn(umbrellaRoot, 'issue', 'edit', umbrellaId, '--title', 'New name');
      expect(result.code).not.toBe(0);
      expect(readFileSync(join(umbrellaRoot, 'doc.md'), 'utf8')).toBe(before);
    } finally {
      rmSync(umbrellaRoot, { recursive: true, force: true });
    }
  });

  test('9. round-trip: writing back DOC-2 unmodified reproduces the file byte-for-byte', () => {
    const before = readFileSync(wbDocPath(), 'utf8');
    const view = J(ztIn(wbRoot, 'issue', 'view', 'DOC-2', '--json')) as { title: string; body: string };
    const result = ztIn(wbRoot, 'issue', 'edit', 'DOC-2', '--title', view.title, '--body', view.body);
    expect(result.code).toBe(0);
    expect(readFileSync(wbDocPath(), 'utf8')).toBe(before);
  });
});

// Asserts that every byte OUTSIDE the target's recorded 1-based [lineStart, lineEnd] line span is
// unchanged between `beforeText`/`afterText` — the target's own span may grow/shrink (an AC patch
// can add evidence/proof lines), so this compares the prefix by line index from the START and the
// suffix by line index from the END, exactly like test "1" above.
function assertOnlySpanChanged(beforeText: string, afterText: string, lineStart: number, lineEnd: number): void {
  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  expect(afterLines.slice(0, lineStart - 1)).toEqual(beforeLines.slice(0, lineStart - 1));
  const suffix = beforeLines.slice(lineEnd);
  expect(afterLines.slice(afterLines.length - suffix.length)).toEqual(suffix);
}

describe('document source write-back (ZTB-9 dev/21): splices land on LEAF items at any nesting depth', () => {
  let nRoot = '';
  let nRootReal = '';
  const nDocPath = () => join(nRootReal, 'doc.md');
  let nHeadSha = '';

  // Three-level nesting: NEST-1 (grandparent) > NEST-1A (parent) > NEST-1A1 (leaf, has an AC) and
  // NEST-1A2 (leaf sibling, three levels deep); NEST-1B is a leaf two levels deep (a direct child
  // of NEST-1, with its own AC); NEST-2 is a top-level sibling, entirely outside NEST-1's subtree.
  const NEST_DOC = [
    '# Nested backlog (no `Title:` header — no umbrella issue)',
    '',
    'Some preamble prose that must never move.',
    '',
    '## NEST-1 — Grandparent item',
    '',
    'status: in-progress',
    'assignee: kim',
    '',
    'Grandparent own leading content, before any child heading.',
    '',
    '### NEST-1A — Parent item',
    '',
    'status: in-progress',
    'assignee: sam',
    '',
    'Parent own leading content, before its child headings.',
    '',
    '#### NEST-1A1 — Leaf item three levels deep',
    '',
    'status: in-progress',
    'assignee: jo',
    '',
    'Leaf body content.',
    '',
    '##### Acceptance Criteria',
    '',
    '- [ ] AC-1 v1 Leaf criterion',
    '  - status: pending',
    '',
    '#### NEST-1A2 — Leaf sibling item three levels deep',
    '',
    'status: draft',
    'assignee: al',
    '',
    'Sibling leaf body text.',
    '',
    '### NEST-1B — Leaf item two levels deep',
    '',
    'status: draft',
    'assignee: pat',
    '',
    'NEST-1B own leaf body text.',
    '',
    '#### Acceptance Criteria',
    '',
    '- [ ] AC-1 v1 NEST-1B criterion',
    '  - status: pending',
    '',
    '## NEST-2 — Top sibling item',
    '',
    'status: draft',
    'assignee: lee',
    '',
    'Top sibling body text.',
    '',
  ].join('\n');

  beforeAll(() => {
    nRoot = mkdtempSync(join(tmpdir(), 'ztrk-docwb-nest-'));
    nRootReal = realpathSync(nRoot);
    mkdirSync(join(nRoot, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(nRoot, 'node_modules', 'ztrack'));
    gitIn(nRoot, 'init', '-q'); gitIn(nRoot, 'config', 'user.email', 't@t.co'); gitIn(nRoot, 'config', 'user.name', 't');
    expect(ztIn(nRoot, 'init', '--team', 'APP').code).toBe(0);
    writeFileSync(nDocPath(), NEST_DOC);
    setSources(nRoot, [{ path: '.volter/tracker/markdown' }, { path: 'doc.md', format: 'document' }]);
    gitIn(nRoot, 'add', '-A');
    gitIn(nRoot, 'commit', '-q', '-m', 'seed');
    nHeadSha = gitIn(nRoot, 'rev-parse', 'HEAD').stdout.trim();
    expect(nHeadSha).toMatch(/^[0-9a-f]{7,40}$/);
  }, 60_000);
  afterAll(() => { if (nRoot) rmSync(nRoot, { recursive: true, force: true }); });

  test('1. `ac patch` on NEST-1B (a leaf two levels deep) succeeds; every byte outside its span is untouched', () => {
    const viewBefore = J(ztIn(nRoot, 'issue', 'view', 'NEST-1B', '--json')) as { lineStart: number; lineEnd: number };
    const beforeText = readFileSync(nDocPath(), 'utf8');

    const patchJson = JSON.stringify({
      checked: true, status: 'passed',
      evidence: [{ id: 'ev1', commit: nHeadSha, acVersion: 1 }],
      proof: { explanation: 'the seed commit establishes the criterion', evidenceRefs: ['ev1'] },
    });
    const patch = ztIn(nRoot, 'ac', 'patch', 'NEST-1B', 'AC-1', '--json', patchJson);
    expect(patch.code).toBe(0);
    expect(JSON.parse(patch.out)).toMatchObject({ issue: 'NEST-1B', acId: 'AC-1', changed: true });

    const afterText = readFileSync(nDocPath(), 'utf8');
    expect(afterText).not.toBe(beforeText);
    assertOnlySpanChanged(beforeText, afterText, viewBefore.lineStart, viewBefore.lineEnd);

    const view = J(ztIn(nRoot, 'issue', 'view', 'NEST-1B', '--json')) as { body: string };
    expect(view.body).toContain('- [x] AC-1 v1 NEST-1B criterion');
    expect(view.body).toContain('status: passed');
  });

  test('2. `issue edit --title` on NEST-1A2 (a leaf three levels deep) succeeds; only its heading line changes', () => {
    const before = readFileSync(nDocPath(), 'utf8');
    const result = ztIn(nRoot, 'issue', 'edit', 'NEST-1A2', '--title', 'Renamed leaf sibling');
    expect(result.code).toBe(0);
    const after = readFileSync(nDocPath(), 'utf8');
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    expect(beforeLines.length).toBe(afterLines.length);
    const changedIdx = beforeLines.map((l, i) => (l === afterLines[i] ? -1 : i)).filter((i) => i !== -1);
    expect(changedIdx).toEqual([beforeLines.findIndex((l) => l.startsWith('#### NEST-1A2'))]);
    expect(afterLines[changedIdx[0]!]).toBe('#### NEST-1A2 — Renamed leaf sibling');
  });

  test('3. `ac patch` on NEST-1A1 (a leaf three levels deep) succeeds; both ancestors\' own content and every sibling\'s raw section are untouched', () => {
    const viewBefore = J(ztIn(nRoot, 'issue', 'view', 'NEST-1A1', '--json')) as { lineStart: number; lineEnd: number };
    const grandparentBeforeFull = J(ztIn(nRoot, 'issue', 'view', 'NEST-1', '--json')) as { title: string; body: string };
    const parentBeforeFull = J(ztIn(nRoot, 'issue', 'view', 'NEST-1A', '--json')) as { title: string; body: string };
    const grandparentBefore = { title: grandparentBeforeFull.title, body: grandparentBeforeFull.body };
    const parentBefore = { title: parentBeforeFull.title, body: parentBeforeFull.body };
    const beforeText = readFileSync(nDocPath(), 'utf8');

    const patchJson = JSON.stringify({
      checked: true, status: 'passed',
      evidence: [{ id: 'ev1', commit: nHeadSha, acVersion: 1 }],
      proof: { explanation: 'the seed commit establishes the criterion', evidenceRefs: ['ev1'] },
    });
    const patch = ztIn(nRoot, 'ac', 'patch', 'NEST-1A1', 'AC-1', '--json', patchJson);
    expect(patch.code).toBe(0);
    expect(JSON.parse(patch.out)).toMatchObject({ issue: 'NEST-1A1', acId: 'AC-1', changed: true });

    const afterText = readFileSync(nDocPath(), 'utf8');
    expect(afterText).not.toBe(beforeText);
    // Byte-local: everything outside NEST-1A1's own recorded span (which covers both ancestors'
    // heading lines and own content, positioned BEFORE it, and every sibling section, positioned
    // AFTER it) is untouched.
    assertOnlySpanChanged(beforeText, afterText, viewBefore.lineStart, viewBefore.lineEnd);

    // Ancestors' own (post-excision) content is explicitly unchanged too, not just implied. Only
    // `title`/`body` are compared — `issue view --json` also embeds descendant subtree data (e.g.
    // `children`), which legitimately reflects the patched grandchild and must NOT be part of this
    // "own content unchanged" comparison.
    const grandparentAfterFull = J(ztIn(nRoot, 'issue', 'view', 'NEST-1', '--json')) as { title: string; body: string };
    const parentAfterFull = J(ztIn(nRoot, 'issue', 'view', 'NEST-1A', '--json')) as { title: string; body: string };
    const grandparentAfter = { title: grandparentAfterFull.title, body: grandparentAfterFull.body };
    const parentAfter = { title: parentAfterFull.title, body: parentAfterFull.body };
    expect(grandparentAfter).toEqual(grandparentBefore);
    expect(parentAfter).toEqual(parentBefore);

    // Siblings' raw sections, byte-for-byte: NEST-1A2's heading (renamed in test 2) through the
    // rest of the file — the tail after NEST-1A1's span — is untouched.
    const tailMarker = '#### NEST-1A2 — Renamed leaf sibling';
    const tailAt = beforeText.indexOf(tailMarker);
    expect(tailAt).toBeGreaterThan(0);
    const tail = beforeText.slice(tailAt);
    expect(afterText.endsWith(tail)).toBe(true);
  });

  test('4. fail-closed: NEST-1A (the middle item — has id-bearing children NEST-1A1/NEST-1A2) still fails closed, file byte-identical', () => {
    const before = readFileSync(nDocPath(), 'utf8');
    const result = ztIn(nRoot, 'issue', 'edit', 'NEST-1A', '--title', 'Should not apply');
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('document');
    expect(result.out).toContain(nDocPath());
    expect(readFileSync(nDocPath(), 'utf8')).toBe(before);
  });
});
