import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownBackend } from './markdownBackend.ts';

const J = (r: { stdout: string }) => JSON.parse(r.stdout);

describe('markdown backend (peer to local) — CRUD + shapes over the .md store', () => {
  test('create → view → list → edit → comment → close round-trips', async () => {
    const be = createMarkdownBackend(mkdtempSync(join(tmpdir(), 'mdbe-')), 'PH');

    const created = J(await be.command(['issue', 'create', '--title', 'First', '--body', '# b', '--state', 'Backlog', '--label', 'type:bug']));
    expect(created).toMatchObject({ identifier: 'PH-1', title: 'First', state: { name: 'Backlog', type: 'open' } });

    const view = J(await be.command(['issue', 'view', 'PH-1', '--json']));
    expect(view).toMatchObject({ id: 'PH-1', identifier: 'PH-1', number: 'PH-1', title: 'First', body: '# b', labels: { nodes: [{ name: 'type:bug' }] }, parent: null, children: { nodes: [] } });

    const list = J(await be.command(['issue', 'list', '--json', 'identifier,title,state,labels']));
    expect(list).toEqual([{ identifier: 'PH-1', title: 'First', state: 'Backlog', labels: ['type:bug'] }]);

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
