// ZTB-4 dev/08: unit tests for the document-source parser, modeled on the ztrack-launch docs
// (TRACK-B.md's `Title:` + `## ZTB-N —` umbrella shape; REMEDIATION-BACKLOG.md's
// `### ZL-XX · P0 · title` shape) — see /Users/yueranyuan/volter/ztrack-launch/TRACK-B.md and
// scripts/compile-backlog.mjs, read as real-world exemplars while designing this module.
import { describe, expect, test } from 'bun:test';
import { parseMarkdownDocumentSource } from './documentParser.ts';

// ── fixture A: an umbrella file (Title: header + top matter + `## ZTB-N —` items, each with a
// non-id-bearing `### dev/NN` subsection and its own nested `### Acceptance Criteria`) ──────────
const UMBRELLA_DOC = [
  'Title: TRACK-Z — Test document',
  'Status: ready',
  '',
  'Summary: doc used for parser tests.',
  '',
  '## About this file',
  '',
  "This section is not id-bearing and should be folded into the umbrella's body.",
  '',
  '## ZTB-1 — Fail-closed parsing',
  '',
  'Some context text for ZTB-1.',
  '',
  '### dev/01 — implement diagnostics channel',
  '',
  'Non-id-bearing subsection body text.',
  '',
  '### Acceptance Criteria',
  '',
  '- [ ] dev/01 v1 Something works.',
  '  - status: pending',
  '',
  '## ZTB-2 — Provenance on every record',
  '',
  'Body text for ZTB-2.',
  '',
  '### ZTB-2a — nested sub-item',
  '',
  "This nested item becomes ZTB-2's CHILD (parent ZTB-2), not folded into ZTB-2's body.",
  '',
].join('\n');

describe('parseMarkdownDocumentSource — umbrella file (Title: header, nested items)', () => {
  const issues = parseMarkdownDocumentSource(UMBRELLA_DOC, '/repo/docs/TRACK-Z.md');
  const byId = new Map(issues.map((i) => [i.id, i]));

  test('a `Title:` header block makes the file itself an umbrella issue, id from the filename', () => {
    const umbrella = byId.get('TRACK-Z');
    expect(umbrella).toBeDefined();
    expect(umbrella!.title).toBe('TRACK-Z — Test document');
    expect(umbrella!.parent).toBeNull();
    // No line span — the umbrella IS the file (mirrors fileToRecord's loose-mode "whole file").
    expect(umbrella!.lineStart).toBeUndefined();
    expect(umbrella!.lineEnd).toBeUndefined();
  });

  test('top-level id-bearing sections become the umbrella\'s children (symmetric with their `parent`)', () => {
    const umbrella = byId.get('TRACK-Z')!;
    expect(umbrella.children).toEqual(['ZTB-1', 'ZTB-2']);
    expect(byId.get('ZTB-1')!.parent).toBe('TRACK-Z');
    expect(byId.get('ZTB-2')!.parent).toBe('TRACK-Z');
  });

  test('a non-id-bearing top-level section (`## About this file`) folds into the umbrella body, not a separate issue', () => {
    expect(byId.has('About this file')).toBe(false);
    expect(byId.get('TRACK-Z')!.body).toContain("This section is not id-bearing and should be folded into the umbrella's body.");
  });

  test('id + title split at the `—` separator', () => {
    const ztb1 = byId.get('ZTB-1')!;
    expect(ztb1.id).toBe('ZTB-1');
    expect(ztb1.title).toBe('Fail-closed parsing');
  });

  test("an item's non-id-bearing `### dev/NN` subsection attaches to its body (not a separate issue)", () => {
    expect(byId.has('dev/01')).toBe(false);
    const ztb1 = byId.get('ZTB-1')!;
    expect(ztb1.body).toContain('### dev/01 — implement diagnostics channel');
    expect(ztb1.body).toContain('Non-id-bearing subsection body text.');
  });

  test("an item's own `### Acceptance Criteria` subsection attaches to its body (parsed by the preset like a store file)", () => {
    const ztb1 = byId.get('ZTB-1')!;
    expect(ztb1.body).toContain('### Acceptance Criteria');
    expect(ztb1.body).toContain('- [ ] dev/01 v1 Something works.');
    expect(ztb1.body).toContain('  - status: pending');
  });

  test('heading nesting between two id-bearing sections becomes a parent link, excised from the parent body', () => {
    const ztb2 = byId.get('ZTB-2')!;
    const ztb2a = byId.get('ZTB-2a')!;
    expect(ztb2a.parent).toBe('ZTB-2');
    expect(ztb2.children).toEqual(['ZTB-2a']);
    // ZTB-2a's own subtree is a SEPARATE issue — not duplicated into ZTB-2's body.
    expect(ztb2.body).not.toContain('ZTB-2a');
    expect(ztb2.body).not.toContain("nested item becomes ZTB-2's CHILD");
    expect(ztb2a.body).toContain("This nested item becomes ZTB-2's CHILD");
  });

  test('each item records its heading section\'s absolute line span', () => {
    expect(byId.get('ZTB-1')).toMatchObject({ lineStart: 10, lineEnd: 22 });
    expect(byId.get('ZTB-2')).toMatchObject({ lineStart: 23, lineEnd: 29 });
    expect(byId.get('ZTB-2a')).toMatchObject({ lineStart: 27, lineEnd: 29 });
  });
});

// ── fixture B: no `Title:` header (REMEDIATION-BACKLOG.md shape) — flat `### ZL-XX · P0 · title`
// items exercising every separator the id-heading grammar tolerates: `·`, `—`, `:`, and bare
// id + space (no separator character at all). ─────────────────────────────────────────────────
const FLAT_DOC = [
  '# Backlog excerpt (no Title: header)',
  '',
  'Prose that precedes any heading — no `Title:` block, so there is no umbrella issue.',
  '',
  '## B. Section header (non-id, groups the work orders below)',
  '',
  '### ZL-B1 · P0 · Fix the thing',
  '',
  'Body text for ZL-B1.',
  '',
  '### ZL-B2 — Fix another thing',
  '',
  'Body text for ZL-B2.',
  '',
  '### ZL-B3: Fix a third thing',
  '',
  'Body text for ZL-B3.',
  '',
  '### ZL-B4 Bare separator (space only)',
  '',
  'Body text for ZL-B4.',
].join('\n');

describe('parseMarkdownDocumentSource — no Title: header (flat items, separator tolerance)', () => {
  const issues = parseMarkdownDocumentSource(FLAT_DOC, '/repo/docs/REMEDIATION-BACKLOG.md');
  const byId = new Map(issues.map((i) => [i.id, i]));

  test('no `Title:` header block -> no umbrella issue; top matter is ignored for issue purposes', () => {
    expect(issues.map((i) => i.id).sort()).toEqual(['ZL-B1', 'ZL-B2', 'ZL-B3', 'ZL-B4']);
  });

  test('a non-id-bearing top-level section (`## B. Section header`) is not an issue; its id-bearing descendants still parse (parent null: no umbrella to own them)', () => {
    expect(byId.has('B')).toBe(false);
    for (const id of ['ZL-B1', 'ZL-B2', 'ZL-B3', 'ZL-B4']) expect(byId.get(id)!.parent).toBeNull();
  });

  test('separator tolerance: middot, em dash, colon, and bare id + space all split id from title identically', () => {
    expect(byId.get('ZL-B1')).toMatchObject({ id: 'ZL-B1', title: 'P0 · Fix the thing' });
    expect(byId.get('ZL-B2')).toMatchObject({ id: 'ZL-B2', title: 'Fix another thing' });
    expect(byId.get('ZL-B3')).toMatchObject({ id: 'ZL-B3', title: 'Fix a third thing' });
    expect(byId.get('ZL-B4')).toMatchObject({ id: 'ZL-B4', title: 'Bare separator (space only)' });
  });

  test('each item still gets its own line span and body content', () => {
    expect(byId.get('ZL-B1')).toMatchObject({ lineStart: 7, lineEnd: 10 });
    expect(byId.get('ZL-B1')!.body).toContain('Body text for ZL-B1.');
    expect(byId.get('ZL-B4')).toMatchObject({ lineStart: 19, lineEnd: 21 });
    expect(byId.get('ZL-B4')!.body).toContain('Body text for ZL-B4.');
  });
});

describe('parseMarkdownDocumentSource — no id-bearing sections and no Title: header', () => {
  test('a plain markdown file with nothing id-shaped parses to an empty issue list', () => {
    const issues = parseMarkdownDocumentSource('# Just a doc\n\nNo id-bearing headings here.\n', '/repo/notes.md');
    expect(issues).toEqual([]);
  });
});

// ── ZTB-4 dev/10: the umbrella's Status:/Assignee: header lines surface on the parsed issue ─────
describe('umbrella Status:/Assignee: header lines (ZTB-4 dev/10)', () => {
  test('the header block surfaces status/assignee on the umbrella issue ONLY (items use their own in-section blocks)', () => {
    const issues = parseMarkdownDocumentSource(
      'Title: T\nStatus: ready\nAssignee: kim\n\nTop matter.\n\n## AB-1 — Item\n\nBody.\n',
      '/x/plan.md',
    );
    const umbrella = issues.find((i) => i.id === 'plan')!;
    expect(umbrella.status).toBe('ready');
    expect(umbrella.assignee).toBe('kim');
    const item = issues.find((i) => i.id === 'AB-1')!;
    expect(item.status).toBeUndefined();
    expect(item.assignee).toBeUndefined();
  });

  test('a Title:-only header block leaves status/assignee unset (unchanged pre-dev/10 shape)', () => {
    const issues = parseMarkdownDocumentSource('Title: T\n\n## AB-1 — Item\n\nBody.\n', '/x/plan.md');
    const umbrella = issues.find((i) => i.id === 'plan')!;
    expect(umbrella.status).toBeUndefined();
    expect(umbrella.assignee).toBeUndefined();
  });
});

// ── ZTB-12: an aborted preamble header block must not mint an umbrella issue from rejected meta ──
describe('an aborted preamble header block mints no umbrella issue (ZTB-12 dev/27)', () => {
  test('`Title:` followed by a non-header line before the blank line aborts the block: no umbrella issue, top-level items get parent null, the preamble text appears in no issue', () => {
    const issues = parseMarkdownDocumentSource(
      'Title: Plan\nthis line breaks the header block\n\n## AB-1 — Item\n\nBody.\n',
      '/x/plan.md',
    );
    // no umbrella issue minted from the rejected header block (id would have been "plan")
    expect(issues.find((i) => i.id === 'plan')).toBeUndefined();
    const item = issues.find((i) => i.id === 'AB-1')!;
    expect(item).toBeDefined();
    expect(item.parent).toBeNull(); // no umbrella to own it — same as the headerless-document shape
    for (const issue of issues) {
      expect(issue.status).toBeUndefined();
      expect(issue.assignee).toBeUndefined();
      expect(issue.body).not.toContain('Title: Plan');
      expect(issue.body).not.toContain('this line breaks the header block');
    }
  });
});
