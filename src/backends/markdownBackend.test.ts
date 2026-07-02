import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownBackend } from './markdownBackend.ts';
import { markdownStoreDir } from '../config.ts';
import type { ResolvedSource } from '../sources.ts';

const J = (r: { stdout: string }) => JSON.parse(r.stdout);

describe('markdown backend (peer to local) — CRUD + shapes over the .md store', () => {
  test('create → view → list → edit → comment → close round-trips', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mdbe-'));
    const be = createMarkdownBackend(dir, 'PH');
    const mdPath = join(markdownStoreDir(dir), 'PH-1.md');

    const created = J(await be.command(['issue', 'create', '--title', 'First', '--body', '# b', '--state', 'Backlog', '--label', 'type:bug']));
    expect(created).toMatchObject({ identifier: 'PH-1', title: 'First', state: { name: 'Backlog', type: 'open' } });
    // ZTB-2: `path` is always on the view, even though the caller never asked for it — it's how
    // the loader populates IssueRecord.origin.
    expect(created.path).toBe(mdPath);

    const view = J(await be.command(['issue', 'view', 'PH-1', '--json']));
    expect(view).toMatchObject({ id: 'PH-1', identifier: 'PH-1', number: 'PH-1', title: 'First', body: '# b', labels: { nodes: [{ name: 'type:bug' }] }, parent: null, children: { nodes: [] }, path: mdPath });

    const list = J(await be.command(['issue', 'list', '--json', 'identifier,title,state,labels']));
    expect(list).toEqual([{ identifier: 'PH-1', title: 'First', state: 'Backlog', labels: ['type:bug'] }]); // `path` NOT requested -> not on the row

    const listWithPath = J(await be.command(['issue', 'list', '--json', 'identifier,path']));
    expect(listWithPath).toEqual([{ identifier: 'PH-1', path: mdPath }]); // requested -> present

    await be.command(['issue', 'edit', 'PH-1', '--add-label', 'P1', '--state', 'Ready']);
    await be.command(['issue', 'comment', 'PH-1', '--body', 'a note']);
    const v2 = J(await be.command(['issue', 'view', 'PH-1', '--comments', '--json']));
    expect(v2.state).toEqual({ name: 'Ready', type: 'open' });
    expect(v2.labels.nodes.map((n: { name: string }) => n.name)).toEqual(['type:bug', 'P1']);
    expect(v2.comments.nodes[0]).toMatchObject({ body: 'a note', user: { name: 'local' } });

    await be.command(['issue', 'close', 'PH-1']);
    const v3 = J(await be.command(['issue', 'view', 'PH-1', '--json']));
    expect(v3.state).toEqual({ name: 'Done', type: 'completed' });
    expect(v3.completedAt).not.toBeNull();

    expect(J(await be.command(['issue', 'create', '--title', 'Second'])).identifier).toBe('PH-2'); // id increments
  });

  test('create/edit derive stateType from the state name (Done→completed, Canceled→canceled)', async () => {
    const be = createMarkdownBackend(mkdtempSync(join(tmpdir(), 'mdbe-')), 'PH');
    expect(J(await be.command(['issue', 'create', '--title', 'D', '--state', 'Done'])).state).toEqual({ name: 'Done', type: 'completed' });
    expect(J(await be.command(['issue', 'create', '--title', 'C', '--state', 'Canceled'])).state).toEqual({ name: 'Canceled', type: 'canceled' });
    expect(J(await be.command(['issue', 'create', '--title', 'P', '--state', 'In Progress'])).state).toEqual({ name: 'In Progress', type: 'open' });
    // edit re-derives, and `list --state open` filters by TYPE (excludes Done/Canceled)
    await be.command(['issue', 'edit', 'PH-1', '--state', 'In Review']);
    expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).stateType).toBe('open');
    expect(J(await be.command(['issue', 'list', '--state', 'open', '--json', 'identifier'])).map((r: { identifier: string }) => r.identifier)).toEqual(['PH-1', 'PH-3']);
  });

  test('create/edit read --body-file, not just --body (else the body is silently dropped)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mdbe-'));
    const be = createMarkdownBackend(dir, 'PH');
    const bodyPath = join(dir, 'body.md');
    writeFileSync(bodyPath, '# T\n\n## Acceptance Criteria\n\n- [x] AC-01 do it\n');
    const created = J(await be.command(['issue', 'create', '--title', 'T', '--body-file', bodyPath]));
    expect(created.body).toContain('AC-01'); // the file content was stored, not dropped
    expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).body).toContain('## Acceptance Criteria');
    writeFileSync(bodyPath, '# T\n\nedited via file\n');
    await be.command(['issue', 'edit', 'PH-1', '--body-file', bodyPath]);
    expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).body).toContain('edited via file');
  });

  // ZTB-6: `children` is a denormalized VIEW of `parent` (markdown.ts:19-20) that nothing else
  // maintains — `issue edit --parent`/`--remove-parent` must keep the OLD and NEW parents' `children`
  // in sync, or `issue list --parent`/a parent's own view lies. `issue create --parent` intentionally
  // does NOT (out of scope here — see docs/GUIDE.md's parent/children note).
  test('edit --parent / --remove-parent keeps the OLD and NEW parents\' children arrays honest', async () => {
    const be = createMarkdownBackend(mkdtempSync(join(tmpdir(), 'mdbe-')), 'PH');
    await be.command(['issue', 'create', '--title', 'Parent A']);   // PH-1
    await be.command(['issue', 'create', '--title', 'Parent B']);   // PH-2
    await be.command(['issue', 'create', '--title', 'Child']);      // PH-3

    // reparent PH-3 onto PH-1 (no prior parent) → PH-1.children gains PH-3
    await be.command(['issue', 'edit', 'PH-3', '--parent', 'PH-1']);
    expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).children.nodes.map((n: { identifier: string }) => n.identifier)).toEqual(['PH-3']);
    expect(J(await be.command(['issue', 'view', 'PH-3', '--json'])).parent).toMatchObject({ identifier: 'PH-1' });

    // re-parent PH-3 from PH-1 to PH-2 → PH-1 loses it, PH-2 gains it
    await be.command(['issue', 'edit', 'PH-3', '--parent', 'PH-2']);
    expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).children.nodes).toEqual([]);
    expect(J(await be.command(['issue', 'view', 'PH-2', '--json'])).children.nodes.map((n: { identifier: string }) => n.identifier)).toEqual(['PH-3']);

    // --remove-parent → PH-2 loses it, PH-3 is parentless again
    await be.command(['issue', 'edit', 'PH-3', '--remove-parent']);
    expect(J(await be.command(['issue', 'view', 'PH-2', '--json'])).children.nodes).toEqual([]);
    expect(J(await be.command(['issue', 'view', 'PH-3', '--json'])).parent).toBeNull();
  });

  test('list filters (state/label/search) + project list + deferred snapshot', async () => {
    const be = createMarkdownBackend(mkdtempSync(join(tmpdir(), 'mdbe-')), 'PH');
    await be.command(['issue', 'create', '--title', 'Alpha bug', '--state', 'Ready', '--label', 'type:bug']);
    await be.command(['issue', 'create', '--title', 'Beta feature', '--state', 'Backlog', '--label', 'type:feature']);
    expect(J(await be.command(['issue', 'list', '--state', 'Ready', '--json', 'title'])).map((r: { title: string }) => r.title)).toEqual(['Alpha bug']);
    expect(J(await be.command(['issue', 'list', '--label', 'type:feature', '--json', 'title'])).map((r: { title: string }) => r.title)).toEqual(['Beta feature']);
    expect(J(await be.command(['issue', 'list', '--search', 'alpha', '--json', 'title'])).map((r: { title: string }) => r.title)).toEqual(['Alpha bug']);
    expect(J(await be.command(['project', 'list', '--json', 'id,name']))).toEqual([]);
    expect((await be.command(['snapshot', 'project-manager', '--format', 'json'])).stderr).toContain('snapshot');
  });
});

// ZTB-3: `createMarkdownBackend`'s third (optional) `sources` param generalizes the single
// hardwired store to a declared list. These are UNIT-level (no CLI spawn); sourcesConfig.e2e.test.ts
// covers the same behavior end to end through config + the real CLI.
describe('markdown backend — declared `sources` (ZTB-3)', () => {
  const src = (dir: string, readonly = false): ResolvedSource => ({ dir, format: 'issue-per-file', readonly, isDefault: false });

  test('list unions ids across declared sources, each row carrying its OWN source path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mdbe-src-'));
    const dirA = join(root, 'a');
    const dirB = join(root, 'b');
    // Seed one issue into each dir via single-source backends (isolates "where it was created"
    // from "what the multi-source backend under test sees").
    await createMarkdownBackend(root, 'PH', [src(dirA)]).command(['issue', 'create', '--title', 'In A']);
    await createMarkdownBackend(root, 'PH', [src(dirB)]).command(['issue', 'create', '--title', 'In B']);

    const be = createMarkdownBackend(root, 'PH', [src(dirA), src(dirB)]);
    const rows = J(await be.command(['issue', 'list', '--json', 'identifier,path'])) as Array<{ identifier: string; path: string }>;
    expect(rows.sort((x, y) => x.identifier.localeCompare(y.identifier))).toEqual([
      { identifier: 'PH-1', path: join(dirA, 'PH-1.md') },
      { identifier: 'PH-1', path: join(dirB, 'PH-1.md') }, // SAME id, DIFFERENT source — undeduped on purpose (see engine.ts crossSourceConflicts)
    ]);
  });

  test('create mints into the first WRITABLE declared source, continuing the id counter across ALL sources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mdbe-src-'));
    const dirA = join(root, 'a');
    const dirB = join(root, 'b');
    await createMarkdownBackend(root, 'PH', [src(dirB)]).command(['issue', 'create', '--title', 'Seeded in B']); // PH-1, in B

    const be = createMarkdownBackend(root, 'PH', [src(dirA), src(dirB, true)]); // A writable, B readonly, A first
    const created = J(await be.command(['issue', 'create', '--title', 'Minted in A']));
    expect(created.identifier).toBe('PH-2'); // global counter (max across BOTH sources), not per-source
    expect(created.path).toBe(join(dirA, 'PH-2.md'));
  });

  test('a readonly source rejects edit/comment/close/delete, naming the source dir; the other source is unaffected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mdbe-src-'));
    const dirA = join(root, 'a');
    const dirB = join(root, 'b');
    await createMarkdownBackend(root, 'PH', [src(dirB)]).command(['issue', 'create', '--title', 'Seeded in B']); // PH-1, in B
    const be = createMarkdownBackend(root, 'PH', [src(dirA), src(dirB, true)]);
    const created = J(await be.command(['issue', 'create', '--title', 'Minted in A']));
    expect(created.identifier).toBe('PH-2');

    await expect(be.command(['issue', 'edit', 'PH-1', '--title', 'renamed'])).rejects.toThrow('read-only');
    await expect(be.command(['issue', 'edit', 'PH-1', '--title', 'renamed'])).rejects.toThrow(dirB);
    expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).title).toBe('Seeded in B'); // genuinely unwritten

    await be.command(['issue', 'edit', 'PH-2', '--title', 'Renamed A']); // the writable source is unaffected
    expect(J(await be.command(['issue', 'view', 'PH-2', '--json'])).title).toBe('Renamed A');
  });

  test('every declared source readonly: create fails clean instead of writing anywhere', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mdbe-src-'));
    const be = createMarkdownBackend(root, 'PH', [src(join(root, 'a'), true), src(join(root, 'b'), true)]);
    await expect(be.command(['issue', 'create', '--title', 'nope'])).rejects.toThrow('no writable source');
  });
});
