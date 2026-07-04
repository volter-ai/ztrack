// ZTB-4 dev/09: unit tests for DocumentSource's read-side reshaping (per-item `status:`/
// `assignee:` header block -> state/assignees; body shifted to preset shape) and its write-side
// guards (constructed directly against a ResolvedSource, no CLI spawn — mirrors
// markdownBackend.test.ts's style). The black-box byte-diff e2e lives in documentSource.e2e.test.ts.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentSource } from './documentSource.ts';
import type { CanonicalIssue } from './markdown.ts';
import type { ResolvedSource } from '../sources.ts';

function docFile(text: string): { path: string; resolved: ResolvedSource } {
  const dir = mkdtempSync(join(tmpdir(), 'docsrc-'));
  const path = join(dir, 'doc.md');
  writeFileSync(path, text);
  return { path, resolved: { dir: path, format: 'document', readonly: false, isDefault: false, name: path } };
}

const CANON = [
  'Title: TRACK-Z — Test document',
  '',
  '## DOC-1 — Alpha item',
  '',
  'status: in-progress',
  'assignee: kim',
  '',
  '### Context',
  '',
  'Some context note.',
  '',
  '### Acceptance Criteria',
  '',
  '- [ ] AC-1 v1 First criterion',
  '  - status: pending',
  '',
  '## DOC-2 — Beta item',
  '',
  'No header block on this one.',
  '',
].join('\n');

describe('DocumentSource read presentation (ZTB-4 dev/09)', () => {
  test('a header block (status + assignee) shapes state/assignees; body is shifted to preset depth', () => {
    const { resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    expect(doc1.state).toBe('in-progress');
    expect(doc1.stateType).toBe('open');
    expect(doc1.assignees).toEqual(['kim']);
    // heading + header block stripped; `### Context`/`### Acceptance Criteria` shifted to `##`
    expect(doc1.body.startsWith('## Context')).toBe(true);
    expect(doc1.body).toContain('## Acceptance Criteria');
    expect(doc1.body).not.toContain('### Context');
    expect(doc1.body).not.toContain('status: in-progress');
    expect(doc1.body).toContain('- [ ] AC-1 v1 First criterion');
  });

  test('an item without a header block presents state "draft", no assignees', () => {
    const { resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc2 = src.load('DOC-2')!;
    expect(doc2.state).toBe('draft');
    expect(doc2.stateType).toBe('open');
    expect(doc2.assignees).toEqual([]);
    expect(doc2.body).toContain('No header block on this one.');
  });

  test('the umbrella issue is presented exactly as before dev/09 — no reshaping, draft/open, no span', () => {
    const { resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    // The umbrella's id comes from the FILENAME (mirrors fileToRecord), not the `Title:` text.
    const umbrella = src.load('doc')!;
    expect(umbrella).not.toBeNull();
    expect(umbrella.state).toBe('draft');
    expect(umbrella.stateType).toBe('open');
    expect(umbrella.assignees).toEqual([]);
    const origin = src.origin('doc');
    expect(origin.lineStart).toBeUndefined();
    expect(origin.lineEnd).toBeUndefined();
  });
});

describe('DocumentSource.write guards (ZTB-4 dev/09)', () => {
  function edited(base: CanonicalIssue, patch: Partial<CanonicalIssue>): CanonicalIssue {
    return { ...base, ...patch };
  }

  test('a body-only edit splices cleanly and is reflected by a fresh read', () => {
    const { path, resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    const newBody = doc1.body.replace('- [ ] AC-1 v1 First criterion\n  - status: pending', '- [x] AC-1 v1 First criterion\n  - status: passed');
    src.write(edited(doc1, { body: newBody }));
    const reloaded = src.load('DOC-1')!;
    expect(reloaded.body).toContain('- [x] AC-1 v1 First criterion');
    expect(reloaded.body).toContain('  - status: passed');
    // untouched: DOC-2 and the header block
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).toContain('## DOC-2 — Beta item');
    expect(onDisk).toContain('status: in-progress\nassignee: kim');
  });

  test('a title-only edit renames just the heading suffix, splicing the same body back', () => {
    const { path, resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    src.write(edited(doc1, { title: 'Renamed item' }));
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).toContain('## DOC-1 — Renamed item');
    expect(onDisk).not.toContain('## DOC-1 — Alpha item');
    expect(onDisk).toContain('### Context\n\nSome context note.');
  });

  test('external file mutation between construction and write throws (stale) and leaves the file unchanged', () => {
    const { path, resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    // Mutate DOC-1's OWN recorded span on disk (its assignee header line) so the constructor-time
    // `raw` snapshot the write path checks against no longer matches — a stale read, not just an
    // unrelated file edit elsewhere.
    const mutated = readFileSync(path, 'utf8').replace('assignee: kim', 'assignee: someone-else');
    writeFileSync(path, mutated);
    expect(() => src.write(edited(doc1, { body: `${doc1.body}Extra.\n` }))).toThrow(/changed on disk/);
    expect(readFileSync(path, 'utf8')).toBe(mutated); // nothing further was written
  });

  // ZTB-16 dev/03: a state change used to fail closed unconditionally ("splicing a status change
  // is not implemented"). It now splices the item's `status:` header line — the analogue of the
  // body/title splice above — leaving every other byte (including the assignee line, DOC-2, the
  // umbrella) untouched.
  test('a write that changes ONLY state splices the `status:` header line; every other byte is untouched', () => {
    const { path, resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    const before = readFileSync(path, 'utf8');
    src.write(edited(doc1, { state: 'done', stateType: 'completed' }));
    const reloaded = src.load('DOC-1')!;
    expect(reloaded.state).toBe('done');
    expect(reloaded.stateType).toBe('completed');
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).toContain('status: done\nassignee: kim'); // status changed, assignee line untouched
    expect(onDisk).not.toContain('status: in-progress');
    // Byte-diff: every line except the status line itself is identical to the pre-write file.
    const beforeLines = before.split('\n');
    const afterLines = onDisk.split('\n');
    expect(afterLines.length).toBe(beforeLines.length);
    const statusLineIndex = beforeLines.findIndex((l) => l === 'status: in-progress');
    expect(statusLineIndex).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < beforeLines.length; i++) {
      if (i === statusLineIndex) continue;
      expect(afterLines[i]).toBe(beforeLines[i]);
    }
    // untouched: DOC-2 and its own lack of a header block
    expect(onDisk).toContain('## DOC-2 — Beta item\n\nNo header block on this one.');
  });

  test('a state change on an item with NO `status:` header line (DOC-2) fails closed, naming the file/issue, and writes nothing', () => {
    const { path, resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc2 = src.load('DOC-2')!;
    const before = readFileSync(path, 'utf8');
    expect(() => src.write(edited(doc2, { state: 'done', stateType: 'completed' }))).toThrow(/no `status:` header line/);
    expect(readFileSync(path, 'utf8')).toBe(before); // nothing written
  });

  test('a combined state + body change splices BOTH; everything else (assignee, DOC-2) untouched', () => {
    const { path, resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    const newBody = doc1.body.replace('- [ ] AC-1 v1 First criterion\n  - status: pending', '- [x] AC-1 v1 First criterion\n  - status: passed');
    src.write(edited(doc1, { state: 'done', stateType: 'completed', body: newBody }));
    const reloaded = src.load('DOC-1')!;
    expect(reloaded.state).toBe('done');
    expect(reloaded.body).toContain('- [x] AC-1 v1 First criterion');
    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).toContain('status: done\nassignee: kim');
    expect(onDisk).toContain('## DOC-2 — Beta item\n\nNo header block on this one.');
  });

  test('a write that changes assignees throws, naming "assignee"', () => {
    const { resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    expect(() => src.write(edited(doc1, { assignees: ['someone-else'] }))).toThrow(/assignee/);
  });

  test('a write that changes children (a reparent) throws, naming "children"', () => {
    const { resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    expect(() => src.write(edited(doc1, { children: [...doc1.children, 'SOMETHING'] }))).toThrow(/children/);
  });

  test('a write on the umbrella issue throws', () => {
    const { resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const umbrella = src.load('doc')!;
    expect(() => src.write(edited(umbrella, { body: 'new body' }))).toThrow();
  });

  test('a write on a parent whose subtree was excised by a nested id-bearing child throws', () => {
    const nested = [
      '## DOC-9 — Has a nested child',
      '',
      'Own text.',
      '',
      '### DOC-9A — Nested child',
      '',
      'Nested text.',
      '',
    ].join('\n');
    const { resolved } = docFile(nested);
    const src = new DocumentSource(resolved);
    const doc9 = src.load('DOC-9')!;
    expect(() => src.write(edited(doc9, { body: `${doc9.body}Extra.\n` }))).toThrow(/excised|child issues/i);
  });

  test('a CRLF file throws on write (write-back only supports LF)', () => {
    const { path, resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    writeFileSync(path, CANON.replace(/\n/g, '\r\n'));
    expect(() => src.write(edited(doc1, { body: `${doc1.body}Extra.\n` }))).toThrow(/CRLF/);
  });

  test('delete always fails closed', () => {
    const { resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    expect(() => src.delete('DOC-1')).toThrow();
  });
});

describe('DocumentSource round-trip: unmodified splice reproduces the file byte-for-byte', () => {
  test('writing back the SAME body/title leaves the file byte-identical', () => {
    const { path, resolved } = docFile(CANON);
    const src = new DocumentSource(resolved);
    const doc1 = src.load('DOC-1')!;
    const before = readFileSync(path, 'utf8');
    src.write(doc1); // no changes at all
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

describe("DocumentSource umbrella presentation from the file's Title: header block (ZTB-4 dev/10)", () => {
  test('Status:/Assignee: lines shape the umbrella state/assignees; Done maps to completed', () => {
    const { resolved } = docFile([
      'Title: TRACK-Z — Test document',
      'Status: in-progress',
      'Assignee: claude',
      '',
      '## DOC-1 — Alpha item',
      '',
      'Body.',
      '',
    ].join('\n'));
    const umbrella = new DocumentSource(resolved).load('doc')!;
    expect(umbrella.state).toBe('in-progress');
    expect(umbrella.stateType).toBe('open');
    expect(umbrella.assignees).toEqual(['claude']);

    const { resolved: doneResolved } = docFile('Title: X\nStatus: done\n\n## DOC-1 — Item\n\nBody.\n');
    const done = new DocumentSource(doneResolved).load('doc')!;
    expect(done.state).toBe('done');
    expect(done.stateType).toBe('completed');
  });
});
