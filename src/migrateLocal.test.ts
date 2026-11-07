import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLocalToMarkdown } from './migrateLocal.ts';
import { createMarkdownBackend } from './backends/markdownBackend.ts';

const J = (r: { stdout: string }) => JSON.parse(r.stdout);
const hasPython = (() => { try { execFileSync('python3', ['--version']); return true; } catch { return false; } })();

// Build a tracker.sqlite shaped exactly like the removed Python backend wrote it:
// a single tracker_store(key='store', value=<json>) row whose JSON has an `issues` map.
function seedSqlite(root: string, issues: Record<string, unknown>): void {
  const store = JSON.stringify({ version: 1, teamKey: 'APP', issues });
  const py = [
    'import sqlite3,sys,os',
    "d=os.path.join(sys.argv[1],'.volter','tracker'); os.makedirs(d,exist_ok=True)",
    "c=sqlite3.connect(os.path.join(d,'tracker.sqlite'))",
    "c.execute('CREATE TABLE tracker_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)')",
    "c.execute(\"INSERT INTO tracker_store VALUES('store', ?)\", (sys.argv[2],)); c.commit()",
  ].join('; ');
  execFileSync('python3', ['-c', py, root, store]);
}

describe.if(hasPython)('migrate-local: Python SQLite store → markdown files', () => {
  test('migrates every issue and the markdown backend reads them back faithfully', () => {
    const root = mkdtempSync(join(tmpdir(), 'mig-'));
    seedSqlite(root, {
      'APP-1': {
        identifier: 'APP-1', title: 'Open one', body: '# Open\n\n## Acceptance Criteria\n\n- [x] AC-01 do it (commit abc123)\n',
        state: 'In Progress', stateType: 'open', assignee: 'alice', labels: ['type:case'],
        projectId: '', parentId: '', branchName: 'app-1-open', priority: 0, devProgress: '',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', completedAt: null, canceledAt: null,
        url: 'local://tracker/issue/APP-1',
      },
      'APP-2': {
        identifier: 'APP-2', title: 'Done two', body: '# Done', state: 'Done', stateType: 'completed',
        assignee: '', labels: ['type:bug'], projectId: '', parentId: '', branchName: '', priority: 0, devProgress: '',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z', completedAt: '2026-01-03T00:00:00Z', canceledAt: null,
        url: 'local://tracker/issue/APP-2',
      },
    });

    const result = migrateLocalToMarkdown(root);
    expect(result).toMatchObject({ ran: true, migrated: 2 });

    // The pure-JS backend now reads the migrated store with no SQLite involved.
    const be = createMarkdownBackend(root, 'APP');

    return Promise.all([
      be.command(['issue', 'view', 'APP-1', '--json']).then((r) => {
        const v = J(r);
        expect(v).toMatchObject({ identifier: 'APP-1', title: 'Open one', state: { name: 'In Progress', type: 'open' } });
        expect(v.body).toContain('AC-01'); // body (with acceptance criteria) survived the migration
        expect(v.assignee).toEqual({ name: 'alice' });
        expect(v.labels.nodes.map((n: { name: string }) => n.name)).toEqual(['type:case']);
      }),
      be.command(['issue', 'view', 'APP-2', '--json']).then((r) => {
        // ZTB-22 dev/01: the legacy Python store's Title-case 'Done' is healed to lowercase 'done'
        // on read (markdown.ts's parseIssue) — the same normalization `issue close`'s own legacy
        // output gets, since both wrote the identical exact string. stateType is untouched/preserved.
        expect(J(r).state).toEqual({ name: 'done', type: 'completed' }); // stateType preserved → check honors closed
      }),
      // `list --state open` (what recovery uses) excludes the migrated Done issue by TYPE
      be.command(['issue', 'list', '--state', 'open', '--json', 'identifier']).then((r) => {
        expect(J(r).map((x: { identifier: string }) => x.identifier)).toEqual(['APP-1']);
      }),
    ]);
  });

  test('no sqlite → ran:false, nothing written', () => {
    const root = mkdtempSync(join(tmpdir(), 'mig-'));
    expect(migrateLocalToMarkdown(root)).toMatchObject({ ran: false, migrated: 0 });
  });
});
