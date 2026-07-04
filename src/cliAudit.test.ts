import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMutatingCommand } from './cliAudit.ts';
import { appendAudit, seedAuditBaseline } from './core/audit.ts';

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), 'cliaudit-'));
}

describe('isMutatingCommand — argv classification (drives the post-command observe)', () => {
  test('issue write subcommands are mutating; read subcommands are not', () => {
    for (const sub of ['create', 'edit', 'patch', 'close', 'reopen', 'assign', 'label']) {
      expect(isMutatingCommand(['issue', sub, 'X-1'])).toBe(true);
    }
    for (const sub of ['view', 'list', 'show', 'get', 'log']) {
      expect(isMutatingCommand(['issue', sub, 'X-1'])).toBe(false);
    }
    expect(isMutatingCommand(['issue'])).toBe(false); // bare `issue` (help) mutates nothing
  });

  test('ac/tx/import/sync mutate; waiver mutates except `list`; unknown verbs do not', () => {
    expect(isMutatingCommand(['ac', 'patch', 'X-1', 'AC-1', '--json', '{}'])).toBe(true);
    expect(isMutatingCommand(['tx', '--file', 't.json'])).toBe(true);
    expect(isMutatingCommand(['import', 'notes.md'])).toBe(true);
    expect(isMutatingCommand(['sync', 'github'])).toBe(true);
    expect(isMutatingCommand(['waiver', 'grant', 'X-1'])).toBe(true);
    expect(isMutatingCommand(['waiver', 'list'])).toBe(false);
    for (const verb of ['check', 'export', 'lint', 'visualizer', 'preset', 'completions']) {
      expect(isMutatingCommand([verb])).toBe(false);
    }
  });
});

describe('audit files are gitignored + baseline seeding', () => {
  test('writing the audit log drops a .gitignore covering both files (idempotent, non-clobbering)', () => {
    const repo = tmpRepo();
    appendAudit(repo, { ts: '2026-01-01T00:00:00Z', issueId: 'A-1', op: 'create' });
    const gi = join(repo, 'tracker', '.gitignore');
    const first = readFileSync(gi, 'utf8');
    expect(first).toContain('.audit.jsonl');
    expect(first).toContain('.audit-state.json');
    // a second write must not duplicate the entries
    appendAudit(repo, { ts: '2026-01-02T00:00:00Z', issueId: 'A-2', op: 'create' });
    expect(readFileSync(gi, 'utf8')).toBe(first);
  });

  test('an existing .gitignore is appended to, never overwritten', () => {
    const repo = tmpRepo();
    const dir = join(repo, 'tracker');
    // pre-create the tracker dir with a hand-authored ignore
    seedAuditBaseline(repo); // creates the dir + .gitignore
    writeFileSync(join(dir, '.gitignore'), 'keep-me\n');
    appendAudit(repo, { ts: '2026-01-03T00:00:00Z', issueId: 'A-3', op: 'create' });
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('keep-me');
    expect(gi).toContain('.audit.jsonl');
    expect(gi).toContain('.audit-state.json');
  });

  test('seedAuditBaseline writes an empty baseline once, then is a no-op', () => {
    const repo = tmpRepo();
    const baseline = join(repo, 'tracker', '.audit-state.json');
    expect(existsSync(baseline)).toBe(false);
    seedAuditBaseline(repo);
    expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual({});
    // populate, then re-seed: must not clobber
    writeFileSync(baseline, JSON.stringify({ 'A-1': { status: 'ready', acs: {} } }));
    seedAuditBaseline(repo);
    expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual({ 'A-1': { status: 'ready', acs: {} } });
  });
});
