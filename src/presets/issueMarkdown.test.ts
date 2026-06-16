import { describe, expect, test } from 'bun:test';
import {
  canonicalizeIssueMarkdown,
  parseIssueMarkdown,
  renderCanonicalIssueMarkdown,
  MARKDOWN_AC_PACK,
  resolveGrammarPack,
  type GrammarPack,
} from './issueMarkdown.ts';

// These suites exercise the 'parent-case' example grammar (required section canon,
// reordering, respelling). The default grammar is 'generic' (permissive) — see the
// dedicated "generic default grammar" suite below.
const fmt = (text: string) => canonicalizeIssueMarkdown(text, 'parent-case');

describe('fmt: mdast-gated heading detection (render-side robustness)', () => {
  test('a "##" inside a fenced code block is NOT split out as a section', () => {
    const body = [
      '# Ticket', '', '## Development Acceptance Criteria', '',
      '- [ ] dev/01 status: pending Document it. [1]', '',
      '```bash', '## not a heading — a comment in code', 'echo hi', '```', '',
      '## Sources', '', '[1] Req:', '> x', '',
    ].join('\n');
    const out = fmt(body);
    // the code-fence line stays inside the fence (under Dev ACs), not hoisted
    // into a reordered top-level section
    expect(out).toContain('```bash\n## not a heading — a comment in code\necho hi\n```');
    // and it did not become its own section before Sources
    expect(out.indexOf('## not a heading')).toBeLessThan(out.indexOf('## Sources'));
    expect(fmt(out)).toBe(out); // idempotent
  });
});

describe('pluggable grammar (roadmap G5)', () => {
  const body = '# Ticket\n\n## Done When\n\n- [ ] dev/01 status: pending Ship it. [1]\n\n## Sources\n\n[1] Req:\n> ship\n';

  test('default markdown-ac pack: a non-canonical heading is NOT mapped to the dev slot', () => {
    const parsed = parseIssueMarkdown(body);
    expect(parsed.sections.developmentAcceptanceCriteria).toBeNull(); // "Done When" is not our canonical title
  });

  test('a second pack aliasing "Done When" → dev slot maps it, from data alone', () => {
    const pack: GrammarPack = {
      name: 'my-team',
      slotTitles: { ...MARKDOWN_AC_PACK.slotTitles, developmentAcceptanceCriteria: ['Development Acceptance Criteria', 'Done When'] },
    };
    const parsed = parseIssueMarkdown(body, 'parent-case', pack);
    expect(parsed.sections.developmentAcceptanceCriteria).not.toBeNull();
    expect(parsed.sections.developmentAcceptanceCriteria!.checkboxItems.length).toBe(1);
    expect(parsed.sections.developmentAcceptanceCriteria!.checkboxItems[0]!.body).toContain('Ship it.');
  });

  test('registry: extends a named pack; unknown pack errors (no silent fallback)', () => {
    expect(resolveGrammarPack().name).toBe('markdown-ac'); // default selection
    const gh = resolveGrammarPack({ extends: 'github-flavored' });
    expect(gh.slotTitles.developmentAcceptanceCriteria).toContain('Done When');
    // extends + slotAliases compose
    const composed = resolveGrammarPack({ extends: 'github-flavored', slotAliases: { sources: ['Why'] } });
    expect(composed.slotTitles.sources).toContain('Why');
    expect(composed.slotTitles.sources).toContain('Context'); // from github-flavored base
    expect(() => resolveGrammarPack({ extends: 'no-such-pack' })).toThrow('unknown grammar pack');
  });
});

describe('generic default grammar (the OSS default — permissive)', () => {
  test('lint/diagnostics do not require or reject any project-specific sections', () => {
    const body = '# Ticket\n\n## Context\n\nWhy.\n\n## Done When\n\n- [ ] Ship it.\n\n## Notes\n\nanything\n';
    const parsed = parseIssueMarkdown(body); // default template = 'generic'
    expect(parsed.diagnostics).toEqual([]); // no missing/unknown/order findings
  });

  test('diagnostics still flag a missing title and body preamble', () => {
    const noTitle = parseIssueMarkdown('## Context\n\ntext\n');
    expect(noTitle.diagnostics.some((d) => d.code === 'issue_markdown_missing_title')).toBe(true);
  });

  test('fmt normalizes whitespace/markers but does NOT reorder a project\'s sections', () => {
    const out = canonicalizeIssueMarkdown('# T\n## Zebra\nz\n## Apple\na\n## Summary\ns\n'); // generic default
    // original order preserved (no canonical reordering)
    expect([out.indexOf('## Zebra'), out.indexOf('## Apple'), out.indexOf('## Summary')]
      .every((v) => v >= 0)).toBe(true);
    expect(out.indexOf('## Zebra')).toBeLessThan(out.indexOf('## Apple'));
    expect(out.indexOf('## Apple')).toBeLessThan(out.indexOf('## Summary'));
    expect(canonicalizeIssueMarkdown(out)).toBe(out); // idempotent
  });
});

describe('canonicalizeIssueMarkdown', () => {
  test('idempotent on messy real-world shapes', () => {
    const messy = [
      '# Title\n\n\n## Summary   \nText with trailing spaces   \n\n\n\n## Sources\n[1] A:\n> q\n',
      'preamble text\n# Title\n## Evidence\n- [X]   checked item   \n',
      '## Sources\n[1] x\n# Late Title\n## Summary\ns\n',
      '# T\n## Unknown Section\nstuff\n## Summary\nsum\n### Nested\nnested body\n#### Deeper\ndeep\n## Sources\n[1] s\n',
      '',
      'no headings at all\njust text\n',
    ];
    for (const input of messy) {
      const once = fmt(input);
      expect(fmt(once)).toBe(once);
    }
  });

  test('fixed point on the canonical writer output', () => {
    const rendered = renderCanonicalIssueMarkdown({
      title: 'Sample',
      sections: {
        'Summary': 'One line.',
        'Development Acceptance Criteria': '- [x] dev/01 status: passed Done. [1]',
        'Sources': '[1] Someone:\n> quote',
      },
    }, 'parent-case');
    expect(fmt(rendered)).toBe(rendered);
  });

  test('normalizes checkbox markers and trailing whitespace without touching content', () => {
    const out = fmt('# T\n## Evidence\n- [X] item one   \n-  [ ]  item two\n');
    expect(out).toContain('- [x] item one\n');
    expect(out).toContain('- [ ] item two');
  });

  test('reorders canonical sections, keeps unknown sections after them in original order', () => {
    const out = fmt('# T\n## Sources\n[1] s\n## Zebra\nz\n## Summary\nsum\n## Apple\na\n');
    const indexes = ['## Summary', '## Sources', '## Zebra', '## Apple'].map((h) => out.indexOf(h));
    expect(indexes.every((value) => value >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  test('does NOT rename legacy alias sections (lint --fix territory, not fmt)', () => {
    const out = fmt('# T\n## Acceptance Criteria\n- [ ] thing\n## Development Acceptance Criteria\n- [x] dev/01 status: passed x. [1]\n');
    expect(out).toContain('## Acceptance Criteria');
    expect(out).toContain('## Development Acceptance Criteria');
  });

  test('canonical-spelling normalization for known sections differing only in case', () => {
    const out = fmt('# T\n## SOURCES\n[1] s\n');
    expect(out).toContain('## Sources');
  });

  test('preserves preamble and nested headings with their section', () => {
    const out = fmt('stray preamble\n\n# T\n## Summary\nsum\n### Detail\nbody\n');
    expect(out.startsWith('stray preamble\n')).toBe(true);
    expect(out).toContain('## Summary\n\nsum\n\n### Detail\n\nbody');
  });

  test('parse semantics survive fmt (sections + checkbox state)', () => {
    const input = '# T\n## Development Acceptance Criteria\n- [X] dev/01 status: passed A. [1]\n- [ ] dev/02 status: pending B. [1]\n## Summary\ns\n';
    const before = parseIssueMarkdown(input);
    const after = parseIssueMarkdown(fmt(input));
    expect(after.sections.developmentAcceptanceCriteria?.checkboxItems.map((item) => item.checked))
      .toEqual(before.sections.developmentAcceptanceCriteria?.checkboxItems.map((item) => item.checked));
    expect(after.sections.summary?.body.trim()).toBe('s');
  });
});
