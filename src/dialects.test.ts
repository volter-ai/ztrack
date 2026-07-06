// The dialect conformance corpus (docs/DIALECTS.md): every built-in dialect is DEFINED by its
// fixture pair in src/dialects.fixtures/ — <name>.md (a distilled real-world shape) and
// <name>.expected.json (the exact projection the engine must produce, plus which dialect
// detection must pick). Negative fixtures (negative-*.md) pin what must NOT detect: the
// decision-log table and plain prose with checkbox lists. Adding a dialect = adding a registry
// entry + a fixture pair; the registry-driven test below fails if either half is missing.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIALECTS, DialectSchema, detectDialect, parseWithDialect, resolveDialect } from './dialects.ts';

const FIXTURES = join(import.meta.dir, 'dialects.fixtures');
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

interface ExpectedIssue {
  children: string[]; id: string; parent: string | null; status: string; statusExplicit: boolean; title: string;
}
interface Expected {
  detects: string;
  diagnostics: { id: string; kind: 'duplicate_id' | 'status_unrecognized' }[];
  issues: ExpectedIssue[];
}

describe('conformance corpus', () => {
  for (const name of Object.keys(DIALECTS)) {
    test(`built-in '${name}' has a fixture pair and matches it exactly`, () => {
      expect(existsSync(join(FIXTURES, `${name}.md`))).toBe(true);
      expect(existsSync(join(FIXTURES, `${name}.expected.json`))).toBe(true);
      const input = read(`${name}.md`);
      const expected = JSON.parse(read(`${name}.expected.json`)) as Expected;
      const result = parseWithDialect(input, DIALECTS[name]!);
      const projection = result.issues.map((issue) => ({
        children: issue.children, id: issue.id, parent: issue.parent,
        status: issue.status, statusExplicit: issue.statusExplicit, title: issue.title,
      }));
      expect(projection).toEqual(expected.issues);
      expect(result.diagnostics.map((d) => ({ id: d.id, kind: d.kind }))).toEqual(expected.diagnostics);
      // Spans are real and ordered; bodies belong to the issue, not the file at large.
      let previous = -1;
      for (const issue of result.issues) {
        expect(issue.lineStart).toBeGreaterThan(previous);
        expect(issue.lineEnd).toBeGreaterThanOrEqual(issue.lineStart);
        previous = issue.lineStart;
      }
      // Detection over the fixture picks this dialect (the pair is self-describing).
      const detected = detectDialect(input);
      expect(detected?.name).toBe(expected.detects);
    });
  }

  test('negative fixtures never detect (the false-positive floor holds)', () => {
    for (const name of ['negative-decision-log.md', 'negative-prose.md']) {
      expect(detectDialect(read(name))).toBeNull();
    }
  });
});

describe('the engine is data-driven', () => {
  test('every registry entry validates against DialectSchema (a dialect is data, never code)', () => {
    for (const dialect of Object.values(DIALECTS)) expect(() => DialectSchema.parse(dialect)).not.toThrow();
  });

  test('resolveDialect: unknown names error naming the available set; inline objects validate', () => {
    expect(() => resolveDialect('no-such-dialect')).toThrow(/unknown dialect 'no-such-dialect'.*emoji-register/);
    const inline = resolveDialect({
      hierarchy: 'flat',
      idPattern: 'T\\d+',
      issueBoundary: 'heading',
      status: { at: 'field-bullet', label: 'State', vocabulary: { OPEN: 'ready' } },
    });
    expect(inline.name).toBe('inline');
    expect(() => resolveDialect({ bogus: true } as never)).toThrow();
  });
});

describe('engine semantics', () => {
  test('a parent status bullet is never stolen from a child issue section', () => {
    const text = [
      '## EPIC-1 — Umbrella', '',
      '### T-2 — Child task', '',
      '- **Status**: 🟢 done and dusted', '',
    ].join('\n');
    const { dialect } = resolveDialect('emoji-register');
    const { issues } = parseWithDialect(text, dialect);
    const epic = issues.find((issue) => issue.id === 'EPIC-1')!;
    const child = issues.find((issue) => issue.id === 'T-2')!;
    expect(child.status).toBe('done');
    expect(epic.status).toBe('draft');
    expect(epic.statusExplicit).toBe(false);
    expect(epic.children).toEqual(['T-2']);
    expect(child.parent).toBe('EPIC-1');
  });

  test('duplicate ids: first wins, second is skipped with a diagnostic', () => {
    const text = '## D1 — First\n\n- **Status**: 🟢 ok\n\n## D1 — Impostor\n\n- **Status**: 🔴 no\n';
    const { dialect } = resolveDialect('emoji-register');
    const result = parseWithDialect(text, dialect);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.title).toBe('First');
    expect(result.diagnostics).toEqual([expect.objectContaining({ id: 'D1', kind: 'duplicate_id' })]);
  });

  test('a checkbox inside a fenced code block is never an issue', () => {
    const text = '## Notes\n\n```\n- [x] **WS-A: fake** — inside a code fence\n```\n';
    const { dialect } = resolveDialect('checkbox-roster');
    expect(parseWithDialect(text, dialect).issues).toHaveLength(0);
  });

  test('detection needs two explicit statuses — one is never enough', () => {
    const text = '### Z9 — Lonely\n\n- **Status**: 🟢 fine\n';
    expect(detectDialect(text)).toBeNull();
  });
});
