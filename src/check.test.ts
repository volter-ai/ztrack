// ZTB-1: the loose-file header scan (fileToRecord) fails open today — an aborted header block
// or a header-shaped line stranded in the body silently becomes plain text with no trace. These
// tests pin `loose_header_ignored`, a warning finding naming the offending line, for both shapes.
import { describe, expect, test } from 'bun:test';
import type { Finding } from './core/engine.ts';
import { fileToRecord } from './check.ts';

describe('fileToRecord — loose-file header scan (ZTB-1)', () => {
  test('a clean header block (ends at the first blank line) yields zero diagnostics', () => {
    const diagnostics: Finding[] = [];
    const record = fileToRecord('/x/clean.md', 'Title: Clean\nStatus: ready\nAssignee: otto\n\nSome body content\n', diagnostics);
    expect(diagnostics).toEqual([]);
    expect(record).toMatchObject({ title: 'Clean', status: 'ready', assignee: 'otto', body: 'Some body content\n' });
  });

  test('a file with no header at all (first line does not match) yields zero diagnostics — the normal case', () => {
    const diagnostics: Finding[] = [];
    const record = fileToRecord('/x/plain.md', '# Heading\n\nJust prose, no metadata block.\n', diagnostics);
    expect(diagnostics).toEqual([]);
    expect(record.title).toBe('Heading'); // falls back to the first `# heading`
  });

  test('(a) a header block ABORTED by a non-matching line: loose_header_ignored names the offending line', () => {
    const diagnostics: Finding[] = [];
    const content = 'Title: Loose\nthis line breaks the header block\nStatus: ready\n\nbody\n';
    const record = fileToRecord('/x/aborted.md', content, diagnostics);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'loose_header_ignored', severity: 'warning' });
    expect(diagnostics[0]?.message).toContain('this line breaks the header block');
    // the WHOLE file (including the valid `Title:`/`Status:` lines) fell back to plain body —
    // pinning this fallback shape so a future change to it is deliberate and visible.
    expect(record.body).toBe(content);
  });

  test('(a, ZTB-12) an aborted header block does not leak its partially-parsed meta: title/status/' +
    'assignee come from the fallback chain, not the rejected Title:/Status: lines — matching what ' +
    'the diagnostic above already claimed ("discarding any Title:/Status:/Assignee: lines already read")', () => {
    const diagnostics: Finding[] = [];
    const content = 'Title: X\nthis line breaks the header block\n\n# Real Heading\n\nbody\n';
    const record = fileToRecord('/x/aborted-leak.md', content, diagnostics);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'loose_header_ignored', severity: 'warning' });
    // title falls back to the first `# heading` in the (now whole-file) body, NOT the aborted
    // block's `Title: X`
    expect(record.title).toBe('Real Heading');
    expect(record.status).toBe('draft');
    expect(record.assignee).toBeUndefined();
  });

  test('a bad line as the VERY FIRST line is not "aborted" — no header was ever in progress, so no diagnostic', () => {
    const diagnostics: Finding[] = [];
    fileToRecord('/x/none.md', 'Not a header line at all\n\nbody\n', diagnostics);
    expect(diagnostics).toEqual([]);
  });

  test('(b) a Title:/Status:/Assignee:-shaped line stranded in the body after the scan stopped: loose_header_ignored names it', () => {
    const diagnostics: Finding[] = [];
    const content = 'Title: Loose\nStatus: ready\n\nSummary: something\n\nStatus: this-looks-like-metadata-but-is-just-text\n\n## Acceptance Criteria\n';
    const record = fileToRecord('/x/stranded.md', content, diagnostics);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'loose_header_ignored', severity: 'warning' });
    expect(diagnostics[0]?.message).toContain('Status: this-looks-like-metadata-but-is-just-text');
    // the header block itself parsed fine — only the stranded line is flagged
    expect(record.title).toBe('Loose');
    expect(record.status).toBe('ready');
  });

  test('without a diagnostics collector, behavior is unchanged (the param is optional)', () => {
    const record = fileToRecord('/x/no-collector.md', 'Title: X\n\nbody\n');
    expect(record.title).toBe('X');
  });
});
