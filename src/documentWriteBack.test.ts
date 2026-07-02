// ZTB-4 dev/09: unit tests for the grammar-free splice primitives (documentWriteBack.ts). Pins
// the identity documentSource.ts's write path is built on: decomposeSection(raw) reassembles
// byte-for-byte, and shiftHeadings is a true inverse of itself for a matched +/-delta pair.
import { describe, expect, test } from 'bun:test';
import { decomposeSection, HeadingShiftError, shiftHeadings, spliceSectionText } from './documentWriteBack.ts';

describe('shiftHeadings', () => {
  test('shifts every ATX heading down (deeper) by delta', () => {
    const text = '## Alpha\n\ntext\n\n### Beta\n\nmore text\n';
    expect(shiftHeadings(text, 1)).toBe('### Alpha\n\ntext\n\n#### Beta\n\nmore text\n');
  });

  test('shifts every ATX heading up (shallower) by delta, the inverse of the above', () => {
    const text = '### Alpha\n\ntext\n\n#### Beta\n\nmore text\n';
    expect(shiftHeadings(text, -1)).toBe('## Alpha\n\ntext\n\n### Beta\n\nmore text\n');
  });

  test('is a true round-trip inverse for a matched +delta/-delta pair', () => {
    const text = '## Acceptance Criteria\n\n- [ ] AC-1 v1 First.\n  - status: pending\n\n### Sub-note\n\nmore.\n';
    const shifted = shiftHeadings(text, 1);
    expect(shiftHeadings(shifted, -1)).toBe(text);
  });

  test('delta 0 is a no-op (still returns the input unchanged when no setext heading is present)', () => {
    const text = '## Alpha\n\ntext\n';
    expect(shiftHeadings(text, 0)).toBe(text);
  });

  test('a `#` inside a fenced code block is untouched (not a real heading) — shifting deeper', () => {
    const text = '## Alpha\n\n```md\n## fake heading, do not touch\n```\n\n### Beta\n';
    const out = shiftHeadings(text, 1);
    expect(out).toContain('```md\n## fake heading, do not touch\n```');
    expect(out).toContain('### Alpha');
    expect(out).toContain('#### Beta');
  });

  test('a `#` inside a fenced code block is untouched (not a real heading) — shifting shallower', () => {
    const text = '### Alpha\n\n```md\n## fake heading, do not touch\n```\n\n#### Beta\n';
    const out = shiftHeadings(text, -1);
    expect(out).toContain('```md\n## fake heading, do not touch\n```');
    expect(out).toContain('## Alpha');
    expect(out).toContain('### Beta');
  });

  test('shifting a level-6 heading deeper throws (would leave [1,6])', () => {
    const text = '###### Deepest\n\ntext\n';
    expect(() => shiftHeadings(text, 1)).toThrow(HeadingShiftError);
  });

  test('shifting a level-1 heading shallower throws (would leave [1,6])', () => {
    const text = '# Top\n\ntext\n';
    expect(() => shiftHeadings(text, -1)).toThrow(HeadingShiftError);
  });

  test('a setext heading (Title\\n===) throws rather than being silently left un-shifted', () => {
    const text = '## Alpha\n\nSub Title\n=========\n\ntext\n';
    expect(() => shiftHeadings(text, 1)).toThrow(HeadingShiftError);
  });

  test('a setext heading is still detected (and throws) even at delta 0', () => {
    const text = '## Alpha\n\nSub Title\n---------\n\ntext\n';
    expect(() => shiftHeadings(text, 0)).toThrow(HeadingShiftError);
  });
});

describe('decomposeSection: prefixRaw + middle + suffixBlanks reproduces `raw` byte-for-byte', () => {
  function assertIdentity(raw: string): void {
    const d = decomposeSection(raw);
    expect(d.prefixRaw + d.middle + d.suffixBlanks).toBe(raw);
    expect(d.prefixRaw.startsWith(d.headingLineRaw)).toBe(true);
  }

  test('no header block, no trailing blank run', () => {
    const raw = '## DOC-1 — Alpha item\n\nPlain body text.\n';
    assertIdentity(raw);
    const d = decomposeSection(raw);
    expect(d.header).toBeNull();
    expect(d.middle).toBe('Plain body text.\n');
  });

  test('a header block (status + assignee) is captured, and consumed out of `middle`', () => {
    const raw = '## DOC-1 — Alpha item\n\nstatus: in-progress\nassignee: kim\n\nAlpha body text.\n\n### Acceptance Criteria\n\n- [ ] AC-1 v1 x.\n';
    assertIdentity(raw);
    const d = decomposeSection(raw);
    expect(d.header).toEqual({ status: 'in-progress', assignee: 'kim' });
    expect(d.middle.startsWith('Alpha body text.')).toBe(true);
    expect(d.middle).not.toContain('status:');
    expect(d.middle).not.toContain('assignee:');
  });

  test('a header block with only `status:` (no `assignee:`)', () => {
    const raw = '## DOC-2 — Beta item\n\nstatus: ready\n\nBeta body.\n';
    assertIdentity(raw);
    const d = decomposeSection(raw);
    expect(d.header).toEqual({ status: 'ready' });
  });

  test('weird blank-line runs: multiple blanks after the heading, and multiple blanks after the header block', () => {
    const raw = '## DOC-3 — Gamma item\n\n\n\nstatus: draft\n\n\n\nGamma body.\n\n\n';
    assertIdentity(raw);
    const d = decomposeSection(raw);
    expect(d.header).toEqual({ status: 'draft' });
    expect(d.middle).toBe('Gamma body.\n');
    expect(d.suffixBlanks).toBe('\n\n');
  });

  test('an aborted header block (a `status:` line then a `title:` line) consumes NOTHING — both lines land in `middle`', () => {
    const raw = '## DOC-4 — Delta item\nstatus: pending\ntitle: not allowed here\n\nDelta body.\n';
    assertIdentity(raw);
    const d = decomposeSection(raw);
    expect(d.header).toBeNull();
    expect(d.prefixRaw).toBe('## DOC-4 — Delta item\n');
    expect(d.middle).toBe('status: pending\ntitle: not allowed here\n\nDelta body.\n');
  });

  test('an aborted header block (a non-header-shaped line right after the heading) consumes nothing', () => {
    const raw = '## DOC-5 — Epsilon item\nJust a sentence, not a header line.\n\nMore body.\n';
    assertIdentity(raw);
    const d = decomposeSection(raw);
    expect(d.header).toBeNull();
    expect(d.middle).toBe('Just a sentence, not a header line.\n\nMore body.\n');
  });

  test('a section with heading only, nothing else (no trailing newline)', () => {
    const raw = '## DOC-6 — Just a heading';
    assertIdentity(raw);
    const d = decomposeSection(raw);
    expect(d.header).toBeNull();
    expect(d.middle).toBe('');
    expect(d.suffixBlanks).toBe('');
  });

  test('a section whose body is nothing but blank lines (no header, no content)', () => {
    const raw = '## DOC-7 — Empty item\n\n\n';
    assertIdentity(raw);
    const d = decomposeSection(raw);
    expect(d.header).toBeNull();
    expect(d.middle).toBe('');
  });

  test('header block running to end of file with no terminating blank line', () => {
    const raw = '## DOC-8 — Trailing header\nstatus: draft\nassignee: sam';
    assertIdentity(raw);
    const d = decomposeSection(raw);
    expect(d.header).toEqual({ status: 'draft', assignee: 'sam' });
    expect(d.middle).toBe('');
  });
});

describe('spliceSectionText: the write-side inverse of decomposeSection + shiftHeadings', () => {
  const RAW = '## DOC-1 — Alpha item\n\nstatus: in-progress\nassignee: kim\n\n### Context\n\nSome note.\n\n### Acceptance Criteria\n\n- [ ] AC-1 v1 First.\n  - status: pending\n\n';

  test('splicing back the UNMODIFIED presented body reproduces `raw` byte-for-byte', () => {
    const level = 2;
    const d = decomposeSection(RAW);
    const presentedBody = shiftHeadings(d.middle, 1 - level);
    const storedTitle = 'Alpha item';
    const spliced = spliceSectionText(RAW, level, storedTitle, storedTitle, presentedBody);
    expect(spliced).toBe(RAW);
  });

  test('an edited body (new AC status) lands only in the AC block; header/context untouched', () => {
    const level = 2;
    const d = decomposeSection(RAW);
    const presentedBody = shiftHeadings(d.middle, 1 - level);
    const editedBody = presentedBody.replace('- [ ] AC-1 v1 First.\n  - status: pending', '- [x] AC-1 v1 First.\n  - status: passed');
    const spliced = spliceSectionText(RAW, level, 'Alpha item', 'Alpha item', editedBody);
    expect(spliced).toContain('- [x] AC-1 v1 First.\n  - status: passed');
    expect(spliced).toContain('status: in-progress\nassignee: kim'); // header block untouched
    expect(spliced).toContain('### Context\n\nSome note.'); // context untouched, still at its original level
  });

  test('a title rename replaces exactly the title suffix of the heading line, everything else untouched', () => {
    const level = 2;
    const d = decomposeSection(RAW);
    const presentedBody = shiftHeadings(d.middle, 1 - level);
    const spliced = spliceSectionText(RAW, level, 'Alpha item', 'Renamed item', presentedBody);
    expect(spliced.split('\n')[0]).toBe('## DOC-1 — Renamed item');
    expect(spliced.slice(spliced.indexOf('\n'))).toBe(RAW.slice(RAW.indexOf('\n')));
  });

  test('a stored title that is not a suffix of the heading line throws (pathological spacing)', () => {
    expect(() => spliceSectionText('## DOC-1 — Alpha item\n\nbody\n', 2, 'wrong title', 'New title', 'body\n')).toThrow();
  });
});
