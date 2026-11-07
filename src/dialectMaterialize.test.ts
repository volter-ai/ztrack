// docs/DIALECTS.md WP6 — the materialize transform, pinned against the property that matters:
// the OUTPUT must parse under the NATIVE document grammar to the same issues the LENS saw
// (ids modulo the recorded aliases, titles, explicit statuses), with no user prose deleted.
import { describe, expect, test } from 'bun:test';
import { DIALECTS } from './dialects.ts';
import { materializeDialectText, nativeIdFor } from './dialectMaterialize.ts';
import { decomposeSection } from './documentWriteBack.ts';
import { parseMarkdownDocumentSource } from './documentParser.ts';

const EMOJI = DIALECTS['emoji-register']!;
const ROSTER = DIALECTS['checkbox-roster']!;

const PLAN = `# Kill questions

### KQ1 — Is it fun?

- **Kills**: the game.
- **Status**: 🟢 PASS, sessions were great.

### KQ2 — Does the min-spec work?

- **Status**: 🔴 untested, harness ready.
`;

describe('nativeIdFor', () => {
  test('grammar-legal ids are kept verbatim', () => {
    expect(nativeIdFor('WS-A')).toBe('WS-A');
    expect(nativeIdFor('TF-1001')).toBe('TF-1001');
    expect(nativeIdFor('ZL-A5')).toBe('ZL-A5');
  });
  test('hyphenless ids split before the first digit run', () => {
    expect(nativeIdFor('KQ3')).toBe('KQ-3');
    expect(nativeIdFor('B3x')).toBe('B-3x');
  });
  test('an id the grammar cannot hold is null, never invented', () => {
    expect(nativeIdFor('ABC')).toBeNull();
  });
});

describe('heading boundary (emoji-register)', () => {
  const result = materializeDialectText(PLAN, EMOJI);

  test('ids normalize with aliases recorded; headings rewritten in place', () => {
    expect(result.aliases).toEqual({ KQ1: 'KQ-1', KQ2: 'KQ-2' });
    expect(result.after).toContain('### KQ-1 — Is it fun?');
    expect(result.after).toContain('### KQ-2 — Does the min-spec work?');
  });

  test('statuses become status: header lines; the original bullets survive as prose', () => {
    expect(result.after).toContain('status: done');
    expect(result.after).toContain('status: ready');
    expect(result.after).toContain('- **Status**: 🟢 PASS, sessions were great.');
    expect(result.after).toContain('- **Kills**: the game.');
  });

  test('the output parses NATIVELY to the same issues the lens saw', () => {
    const native = parseMarkdownDocumentSource(result.after, 'PLAN.md').filter((issue) => issue.lineStart !== undefined);
    expect(native.map((issue) => issue.id).sort()).toEqual(['KQ-1', 'KQ-2']);
    const kq1 = native.find((issue) => issue.id === 'KQ-1')!;
    expect(kq1.title).toBe('Is it fun?');
    expect(decomposeSection(kq1.raw!).header).toEqual({ status: 'done' });
    const kq2 = native.find((issue) => issue.id === 'KQ-2')!;
    expect(decomposeSection(kq2.raw!).header).toEqual({ status: 'ready' });
  });

  test('an issue with no explicit status gets NO status line (nothing claimed, nothing written)', () => {
    const text = '### KQ1 — One\n\n- **Status**: 🟢 yes.\n\n### KQ2 — Two\n\nprose only.\n';
    const r = materializeDialectText(text, EMOJI);
    const kq2 = parseMarkdownDocumentSource(r.after, 'x.md').find((issue) => issue.id === 'KQ-2')!;
    expect(decomposeSection(kq2.raw!).header).toBeNull();
  });

  test('two ids normalizing to the same native id fail the whole file closed', () => {
    const text = '### KQ3 — a\n\n- **Status**: 🟢 ok.\n\n### KQ-3 — b\n\n- **Status**: 🔴 no.\n';
    expect(() => materializeDialectText(text, EMOJI)).toThrow(/normalize to KQ-3/);
  });
});

describe('checkbox-item boundary (checkbox-roster)', () => {
  const BUILD = `# Build

## Workstreams

- [x] **WS-A: Scaffold** — repo layout ready.
- [ ] **B3: Wire the loop** — pending on WS-A.
- keep this plain note untouched
`;
  const result = materializeDialectText(BUILD, ROSTER);

  test('items become sections one level under their container; plain items survive', () => {
    expect(result.aliases).toEqual({ B3: 'B-3' });
    expect(result.after).toContain('### WS-A — Scaffold');
    expect(result.after).toContain('### B-3 — Wire the loop');
    expect(result.after).toContain('- keep this plain note untouched');
  });

  test('the output parses NATIVELY with checkbox statuses as status: lines', () => {
    const native = parseMarkdownDocumentSource(result.after, 'BUILD.md').filter((issue) => issue.lineStart !== undefined);
    const byId = Object.fromEntries(native.map((issue) => [issue.id, issue]));
    expect(decomposeSection(byId['WS-A']!.raw!).header).toEqual({ status: 'done' });
    expect(decomposeSection(byId['B-3']!.raw!).header).toEqual({ status: 'ready' });
    expect(byId['B-3']!.body).toContain('pending on WS-A.');
  });
});

describe('failure modes', () => {
  test('a file the lens sees no issues in throws (caller skips, nothing partial)', () => {
    expect(() => materializeDialectText('# Just prose\n\nno issues here.\n', EMOJI)).toThrow(/no issues/);
  });
});
