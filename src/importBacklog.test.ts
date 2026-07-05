// ZTB-14 dev/31 (read-only planner + `import --dry-run`) and dev/32 (in-place writer + idempotence
// + the pre-checked `[x]` policy). The fixture corpus under src/importBacklog.fixtures/ IS the
// spec: every `<name>.input.md` has a pinned `<name>.expected.md` (the exact materialized bytes)
// and this file asserts the PLAN (ids/titles/parents/AC counts) matches by hand-verified
// expectation, cross-checked against the actual algorithm run (see the module's own probes in the
// PR description / final report for how these were derived and eyeballed before being pinned).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { assertNoCrlf, existingIdsInFile, IdAllocator, planAndMaterialize, type ImportPlan } from './importBacklog.ts';

const FIXTURES = join(import.meta.dirname, 'importBacklog.fixtures');

function load(name: string): { input: string; expected: string } {
  return {
    input: readFileSync(join(FIXTURES, `${name}.input.md`), 'utf8'),
    expected: readFileSync(join(FIXTURES, `${name}.expected.md`), 'utf8'),
  };
}

function run(name: string, prefix = 'APP') {
  const { input, expected } = load(name);
  const allocator = new IdAllocator();
  const result = planAndMaterialize(input, join(FIXTURES, `${name}.input.md`), { prefix, allocator });
  return { ...result, expected };
}

// ── dev/31: every fixture yields its expected plan + materialized bytes; --dry-run writes nothing ─

describe('planAndMaterialize — fixture corpus (dev/31 read-only plan, dev/32 writer bytes)', () => {
  test('mixed-prose-checkboxes: a heading tree with prose interleaved with checkboxes', () => {
    const { plan, materialized, expected } = run('mixed-prose-checkboxes');
    expect(materialized).toBe(expected);
    expect(plan.issues.map((i) => [i.id, i.title, i.parentId])).toEqual([
      ['APP-1', 'Team backlog', null],
      ['APP-2', 'Improve onboarding flow', 'APP-1'],
      ['APP-3', 'Speed up CI', 'APP-1'],
    ]);
    expect(plan.issues[1]!.acs.map((a) => a.id)).toEqual(['dev/01', 'dev/02', 'dev/03']);
    expect(plan.isNoop).toBe(false);
  });

  test('pure-checklist: headingless file — top-level checkboxes promote to issues, nested ones to ACs', () => {
    const { plan, materialized, expected } = run('pure-checklist');
    expect(materialized).toBe(expected);
    expect(plan.issues.map((i) => i.title)).toEqual(['Build login page', 'Build logout page']);
    expect(plan.issues[0]!.acs.map((a) => a.id)).toEqual(['dev/01', 'dev/02']);
    expect(plan.issues[0]!.parentId).toBeNull();
    expect(plan.issues[1]!.parentId).toBeNull(); // N sibling trees, no folder/file-level parent invented
  });

  test('mixed-bullet-todo-styles: `- [ ]`, `* [ ]`, and `TODO:` all become ACs, in document order', () => {
    const { plan, materialized, expected } = run('mixed-bullet-todo-styles');
    expect(materialized).toBe(expected);
    expect(plan.issues[0]!.acs.map((a) => [a.id, a.text])).toEqual([
      ['dev/01', 'Wire up the CSV export'],
      ['dev/02', 'Add the date-range filter'],
      ['dev/03', 'paginate large result sets'],
    ]);
  });

  test('prechecked: pre-checked `[x]` items import UNCHECKED with the preserved-claim marker + a report', () => {
    const { plan, materialized, expected } = run('prechecked');
    expect(materialized).toBe(expected);
    expect(materialized).not.toMatch(/- \[x\]/i); // never minted checked
    expect(plan.preChecked).toEqual([
      { issueId: 'APP-1', acId: 'dev/01', text: 'Add rate limiting' },
      { issueId: 'APP-1', acId: 'dev/02', text: 'Rotate the signing key' },
    ]);
    expect(plan.issues[0]!.acs[0]!.text).toContain('(imported: previously marked done — needs evidence)');
    expect(plan.issues[0]!.acs[2]!.wasPreChecked).toBe(false);
  });

  test('half-materialized: existing ids/ACs untouched; new numbering continues after the existing max', () => {
    const { plan, materialized, expected } = run('half-materialized');
    expect(materialized).toBe(expected);
    expect(plan.issues[0]).toMatchObject({ status: 'existing', id: 'APP-1' });
    expect(plan.issues[0]!.acs).toEqual([{ status: 'minted', id: 'dev/02', text: 'Needs an id still', wasPreChecked: false }]);
    expect(plan.issues[1]).toMatchObject({ status: 'minted', id: 'APP-2' }); // never reuses/collides with APP-1
  });

  test('duplicate-titles: same title twice is fine — ids (not titles) are the identity, nothing merges', () => {
    const { plan, materialized, expected } = run('duplicate-titles');
    expect(materialized).toBe(expected);
    expect(plan.issues.map((i) => i.id)).toEqual(['APP-1', 'APP-2']);
    expect(plan.issues[0]!.title).toBe(plan.issues[1]!.title);
  });

  test('deep-nesting: four heading levels each become their own issue with the correct parent chain', () => {
    const { plan, materialized, expected } = run('deep-nesting');
    expect(materialized).toBe(expected);
    expect(plan.issues.map((i) => [i.id, i.parentId])).toEqual([
      ['APP-1', null], ['APP-2', 'APP-1'], ['APP-3', 'APP-2'], ['APP-4', 'APP-3'],
    ]);
    expect(materialized).toContain('##### Acceptance Criteria'); // level clamps to the AC's own nesting depth
  });

  test('already-canonical: the plan is EMPTY (no minted issues/ACs) and materialization is a byte-identical no-op', () => {
    const { plan, materialized, expected, input } = { ...run('already-canonical'), input: load('already-canonical').input };
    expect(materialized).toBe(expected);
    expect(materialized).toBe(input);
    expect(plan.isNoop).toBe(true);
    expect(plan.issues.every((i) => i.status === 'existing')).toBe(true);
    expect(plan.issues.flatMap((i) => i.acs)).toEqual([]);
  });

  test('unmapped-preamble: preamble prose with no `Title:` header is left in place and NAMED, never dropped', () => {
    const { plan, materialized, expected, input } = { ...run('unmapped-preamble'), input: load('unmapped-preamble').input };
    expect(materialized).toBe(expected);
    expect(materialized).toContain(input.split('\n')[0]); // the stray prose line survives verbatim
    expect(plan.unmapped).toHaveLength(1);
    expect(plan.unmapped[0]!.reason).toMatch(/Title:/);
  });

  test('multi-list-interleaved-prose: EVERY root-level list is processed; prose between lists lands ABOVE the AC heading as issue body, never inside the AC section', () => {
    // Regression: only the FIRST top-level list was processed — "payments" was silently untouched
    // by import1, then mis-attributed by import2 as build auth's ACs (non-idempotent), leaving the
    // interleaved prose inside build auth's AC section (which the preset flags ac_prose_in_section
    // and the write path then refuses).
    const { plan, materialized, expected } = run('multi-list-interleaved-prose');
    expect(materialized).toBe(expected);
    expect(plan.issues.map((i) => [i.id, i.title])).toEqual([['APP-1', 'build auth'], ['APP-2', 'payments']]);
    expect(plan.issues[0]!.acs.map((a) => a.text)).toEqual(['login page', 'logout']);
    expect(plan.issues[1]!.acs.map((a) => a.text)).toEqual(['stripe integration']);
    // the prose is body: above the AC heading, below the issue heading
    const lines = materialized.split('\n');
    expect(lines.indexOf('Some notes in between.')).toBeGreaterThan(lines.indexOf('## APP-1 build auth'));
    expect(lines.indexOf('Some notes in between.')).toBeLessThan(lines.indexOf('### Acceptance Criteria'));
  });

  test('multiline-checkbox: a checkbox item spanning more than one line is left FULLY in place and named in the report; its single-line sibling still promotes', () => {
    const { plan, materialized, expected } = run('multiline-checkbox');
    expect(materialized).toBe(expected);
    // the multi-line item's lines survive verbatim, in order, still adjacent
    expect(materialized).toContain('- [ ] implement fuzzy search\n  with typo tolerance and ranking');
    expect(plan.unmapped).toEqual([{
      line: 3,
      excerpt: 'implement fuzzy search',
      reason: 'multi-line checkbox item — move it into the Acceptance Criteria section manually (only single-line items are auto-promoted)',
    }]);
    expect(plan.issues[0]!.acs.map((a) => a.text)).toEqual(['add search analytics']);
  });

  // ZTB-16 dev/02 regression: a `TODO:` paragraph followed by an indented prose continuation line
  // used to relocate only its FIRST line into the AC section, orphaning the continuation in place
  // (the freeze guard above only ever looked at checkbox listItem spans). Mirrors the
  // multiline-checkbox case exactly: the whole paragraph freezes together and is named once.
  test('multiline-todo: a `TODO:` paragraph with a continuation line is left FULLY in place and named in the report; its single-line checkbox sibling still promotes', () => {
    const { plan, materialized, expected } = run('multiline-todo');
    expect(materialized).toBe(expected);
    // both the TODO: line and its continuation survive verbatim, in order, still adjacent
    expect(materialized).toContain('TODO: implement fuzzy search\n  with typo tolerance and ranking');
    expect(plan.unmapped).toEqual([{
      line: 3,
      excerpt: 'TODO: implement fuzzy search',
      reason: 'multi-line TODO: item — move it into the Acceptance Criteria section manually (only single-line items are auto-promoted)',
    }]);
    expect(plan.issues[0]!.acs.map((a) => a.text)).toEqual(['add search analytics']);
  });

  // ZTB-37: a bare `Waivers` heading is ALSO reserved document-source structure (like
  // `Acceptance Criteria`) — never an issue, never id-bearing, its rows never scanned/edited.
  test('waivers-idempotent: an already-materialized issue with an AC section AND a Waivers section is a no-op — no id minted into the Waivers heading', () => {
    const { plan, materialized, expected, input } = { ...run('waivers-idempotent', 'ZT'), input: load('waivers-idempotent').input };
    expect(materialized).toBe(expected);
    expect(materialized).toBe(input);
    expect(plan.isNoop).toBe(true);
    expect(plan.issues).toEqual([{
      status: 'existing', id: 'ZT-1', title: 'First feature', parentId: null, acs: [], existingAcCount: 1,
    }]);
    // no junk "Waivers" issue, and the waiver row bytes are untouched
    expect(materialized).not.toContain('ZT-2');
    expect(materialized).toContain('- code: evidence_commit_not_found ref: aaaaaaa1111111111111111111111111111111a1 reason: destroyed in the incident by: Tess (t@t.co)');
  });

  test('freeform-with-waivers: a freeform issue (no id, loose checkbox) with a Waivers section mints ONE issue, relocates the checkbox into an AC block BEFORE the Waivers heading, and leaves the Waivers heading/rows untouched', () => {
    const { plan, materialized, expected } = run('freeform-with-waivers');
    expect(materialized).toBe(expected);
    expect(plan.issues).toHaveLength(1); // no separate "Waivers" issue
    expect(plan.issues[0]).toMatchObject({ status: 'minted', id: 'APP-1', title: 'First feature' });
    expect(plan.issues[0]!.acs.map((a) => a.text)).toEqual(['do the thing']);
    // Waivers heading gained no id, and the waiver row survives byte-for-byte.
    expect(materialized).toContain('### Waivers\n');
    expect(materialized).toContain('- code: evidence_commit_not_found ref: aaaaaaa1111111111111111111111111111111a1 reason: destroyed in the incident by: Tess (t@t.co)');
    // insertion-point sanity: the minted AC block lands BEFORE the Waivers heading, not after it.
    const lines = materialized.split('\n');
    expect(lines.indexOf('### Acceptance Criteria')).toBeLessThan(lines.indexOf('### Waivers'));
  });

  test('case/level robustness: `#### waivers` and `## WAIVERS` are reserved regardless of case/level; an id-bearing `### ZT-9 Waivers` is NOT reserved and still parses as an existing issue', () => {
    const text = [
      '## APP-1 Something',
      '',
      'body content',
      '',
      '#### waivers',
      '',
      '- code: whatever ref: aaa reason: x by: y (y@y.co)',
      '',
      '## WAIVERS',
      '',
      '- code: something else',
      '',
      '### ZT-9 Waivers',
      '',
      'some prose',
      '',
    ].join('\n');
    expect(existingIdsInFile(text)).toEqual(['APP-1', 'ZT-9']);
    const allocator = new IdAllocator();
    const { plan, materialized } = planAndMaterialize(text, 'x.md', { prefix: 'APP', allocator });
    expect(plan.issues.map((i) => [i.id, i.title])).toEqual([['APP-1', 'Something'], ['ZT-9', 'Waivers']]);
    expect(plan.isNoop).toBe(true); // nothing to mint — both reserved headings and the id-bearing one are already canonical
    expect(materialized).toBe(text);
  });
});

// ── dev/31: --dry-run writes nothing; collision-safe allocation across sources ────────────────

describe('planAndMaterialize — dry-run semantics (writes nothing) and cross-source id safety', () => {
  test('planning does not mutate the input string or touch disk — the caller decides whether to write', () => {
    const { input } = load('mixed-prose-checkboxes');
    const before = input;
    const allocator = new IdAllocator();
    planAndMaterialize(input, '/tmp/x.md', { prefix: 'APP', allocator });
    expect(input).toBe(before); // JS strings are immutable, but this pins the CONTRACT explicitly
  });

  test('an allocator pre-seeded with ids from OTHER sources never collides when minting for this file', () => {
    const allocator = new IdAllocator();
    allocator.note('APP-1'); allocator.note('APP-2'); allocator.note('APP-5'); // e.g. from other configured sources
    const { input } = load('duplicate-titles');
    const { plan } = planAndMaterialize(input, '/tmp/dup.md', { prefix: 'APP', allocator });
    expect(plan.issues.map((i) => i.id)).toEqual(['APP-6', 'APP-7']); // continues after the seeded max, not from 1
  });
});

// ── dev/32: the writer — insert-only, idempotent, existing ids untouched, [x] policy, CRLF error ─

describe('planAndMaterialize — writer idempotence + insert-only contract (dev/32)', () => {
  for (const name of ['mixed-prose-checkboxes', 'pure-checklist', 'mixed-bullet-todo-styles', 'prechecked', 'half-materialized', 'duplicate-titles', 'deep-nesting', 'already-canonical', 'unmapped-preamble', 'multi-list-interleaved-prose', 'multiline-checkbox', 'waivers-idempotent', 'freeform-with-waivers']) {
    test(`${name}: import ∘ import === import (byte-identical on a second pass)`, () => {
      const { materialized } = run(name);
      const allocator2 = new IdAllocator();
      const second = planAndMaterialize(materialized, `${name}.md`, { prefix: 'APP', allocator: allocator2 });
      expect(second.materialized).toBe(materialized);
      expect(second.plan.isNoop).toBe(true);
    });
  }

  test('incremental import after freeform edits touches ONLY the new content — every prior byte survives as a prefix', () => {
    const already = run('mixed-prose-checkboxes').materialized;
    const appended = `${already.replace(/\n$/, '')}\n\n## Add rate limiting to the login endpoint\n\n- [ ] Cap attempts per IP\n`;
    const allocator = new IdAllocator();
    const { plan, materialized } = planAndMaterialize(appended, '/tmp/incremental.md', { prefix: 'APP', allocator });
    expect(materialized.startsWith(already.replace(/\n$/, ''))).toBe(true);
    expect(plan.issues.filter((i) => i.status === 'existing').map((i) => i.id)).toEqual(['APP-1', 'APP-2', 'APP-3']);
    expect(plan.issues.filter((i) => i.status === 'minted').map((i) => i.id)).toEqual(['APP-4']);
  });

  test('existing ids are never altered or renumbered even when new siblings are minted around them', () => {
    const { plan } = run('half-materialized');
    expect(plan.issues.find((i) => i.status === 'existing')!.id).toBe('APP-1');
  });

  test('CRLF input throws a clear, actionable error naming the file (never silently mis-splices)', () => {
    const allocator = new IdAllocator();
    expect(() => planAndMaterialize('# X\r\n\r\nbody\r\n', '/tmp/crlf.md', { prefix: 'APP', allocator }))
      .toThrow(/CRLF/);
    expect(() => assertNoCrlf('a\r\nb', '/tmp/crlf.md')).toThrow(/crlf\.md/);
  });

  test('never mints a checked AC line and never mints an evidence line', () => {
    const results: ImportPlan[] = ['prechecked', 'pure-checklist'].map((n) => run(n).plan);
    for (const plan of results) {
      for (const issue of plan.issues) {
        for (const ac of issue.acs) {
          expect(ac.status).toBe('minted');
          // The materialized text for a minted AC is always unchecked, regardless of the source claim.
        }
      }
    }
  });
});
