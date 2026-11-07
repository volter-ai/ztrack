import { describe, expect, test } from 'bun:test';
import { lintIssueBody, LINT_RULES, WEAK_CLAIM_LEXICON_IDS } from './lint.ts';
import type { TrackerConfig } from './types.ts';

// A minimal level-2 section wrapper — lintIssueBody only walks level-2 (`##`) sections, so
// every fixture body needs at least one to exercise the rules at all.
const body = (inner: string) => `# Case\n\nAssignee: me\nStatus: draft\n\n## Notes\n\n${inner}\n`;

function weakClaimFindings(text: string, config?: TrackerConfig) {
  return lintIssueBody(body(text), 'CASE-1', config).filter((f) => f.rule === 'weak_claim');
}

describe('lint: weak_claim lexicon', () => {
  const cases: Array<[string, string]> = [
    ['all tests pass', 'All tests pass.'],
    ['all tests passed', 'All tests passed as expected.'],
    ['works perfectly', 'The new flow works perfectly.'],
    ['fully verified', 'This has been fully verified.'],
    ['fully tested', 'The change is fully tested.'],
    ['100% working', 'It is 100% working now.'],
    ['should work', 'This should work for every case.'],
    ['verified end to end', 'Verified end to end on staging.'],
  ];

  for (const [label, text] of cases) {
    test(`fires on "${label}"`, () => {
      const findings = weakClaimFindings(text);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]!.message).toMatch(/is not backed by cited evidence here/);
    });
  }

  test('every lexicon phrase in the Design doc\'s own list is covered by the fixture matrix above', () => {
    // Pins that the lexicon itself hasn't silently grown or shrunk without a matching test.
    expect(WEAK_CLAIM_LEXICON_IDS).toEqual([
      'all tests pass(ed)', 'works perfectly', 'fully verified', 'fully tested',
      '100% working', 'should work', 'verified end to end',
    ]);
    expect(new Set(cases.map(([label]) => label)).size).toBeGreaterThanOrEqual(WEAK_CLAIM_LEXICON_IDS.length);
  });

  test('is case-insensitive and word-boundary anchored (no match inside a longer word)', () => {
    expect(weakClaimFindings('ALL TESTS PASS.').length).toBeGreaterThan(0);
    expect(weakClaimFindings('This workshop should workshop through the deck.').length).toBe(0);
  });

  test('does not fire on unrelated prose', () => {
    expect(weakClaimFindings('The migration adds a new column and backfills defaults.').length).toBe(0);
  });
});

describe('lint: weak_claim skips code', () => {
  test('the same phrase inside a fenced code block does not fire', () => {
    const text = ['```', 'echo "All tests pass. Works perfectly. Fully verified."', '```'].join('\n');
    expect(weakClaimFindings(text).length).toBe(0);
  });

  test('the same phrase inside an inline code span does not fire', () => {
    expect(weakClaimFindings('The log literally says `All tests pass.` in the fixture.').length).toBe(0);
  });

  test('prose OUTSIDE a fence in the same section still fires', () => {
    const text = ['All tests pass.', '```', 'some code', '```'].join('\n');
    expect(weakClaimFindings(text).length).toBe(1);
  });
});

describe('lint: weak_claim "accompanied by cited evidence" scoping', () => {
  // "Accompanied" is defined precisely as: same item block (the claim's own line plus any
  // nested/indented lines under it, e.g. its own evidence/proof bullets) carries an evidence
  // citation — an [E1]/[P1]/[source 1] ref, a commit hash (`commit:`/`commit=`), or an
  // uploads/*.png path. A citation elsewhere in the document does NOT retroactively excuse
  // an unrelated claim.

  test('a claim inside an AC item is suppressed when the SAME item cites a commit', () => {
    const text = [
      '- [x] dev/01 v1 Ship the health check. All tests pass.',
      '  - evidence ev1: commit=25c37963fd772dcf2b6352db96aecf5a3ee6ae14 acv=1',
    ].join('\n');
    expect(weakClaimFindings(text).length).toBe(0);
  });

  test('the workspace-style `commit=<sha>` citation counts as evidence (not just `commit:`)', () => {
    const text = '- [x] dev/01 v1 Fully verified.\n  - evidence ev1: commit=abc1234 acv=1';
    expect(weakClaimFindings(text).length).toBe(0);
  });

  test('an [E#]/[P#] bracket ref counts as evidence', () => {
    expect(weakClaimFindings('- [x] dev/01 v1 Fully tested. [E1]').length).toBe(0);
    expect(weakClaimFindings('- [x] dev/01 v1 Fully tested. [P1]').length).toBe(0);
  });

  test('a claim is NOT suppressed by a citation that lives in a DIFFERENT AC item', () => {
    const text = [
      '- [x] dev/01 v1 Ship the health check.',
      '  - evidence ev1: commit=25c37963fd772dcf2b6352db96aecf5a3ee6ae14 acv=1',
      '- [x] dev/02 v1 Ship the dashboard. All tests pass.',
    ].join('\n');
    const findings = weakClaimFindings(text);
    expect(findings.length).toBe(1);
    expect(findings[0]!.excerpt).toMatch(/dev\/02/);
  });

  test('a bare claim with no evidence anywhere fires', () => {
    const text = '- [x] dev/01 v1 Ship the health check. Works perfectly.';
    expect(weakClaimFindings(text).length).toBe(1);
  });
});

describe('lint: weak_claim severity + config', () => {
  test('defaults to warn severity', () => {
    expect(LINT_RULES.weak_claim!.default).toBe('warn');
    const findings = weakClaimFindings('All tests pass.');
    expect(findings[0]!.severity).toBe('warn');
  });

  test('organization.lint.rules.weak_claim = "off" silences it', () => {
    const config = { organization: { lint: { rules: { weak_claim: 'off' } } } } as unknown as TrackerConfig;
    expect(weakClaimFindings('All tests pass.', config).length).toBe(0);
  });

  test('organization.lint.rules.weak_claim = "error" escalates severity', () => {
    const config = { organization: { lint: { rules: { weak_claim: 'error' } } } } as unknown as TrackerConfig;
    const findings = weakClaimFindings('All tests pass.', config);
    expect(findings[0]!.severity).toBe('error');
  });
});

describe('lint: weak_claim does not disturb the three mechanical rules', () => {
  test('todo-marker still fires standalone', () => {
    const findings = lintIssueBody(body('TODO: fill this in'), 'CASE-1');
    expect(findings.some((f) => f.rule === 'todo-marker')).toBe(true);
  });

  test('placeholder-token still fires standalone', () => {
    const findings = lintIssueBody(body('See <CASE> for details.'), 'CASE-1');
    expect(findings.some((f) => f.rule === 'placeholder-token')).toBe(true);
  });

  test('unchecked-with-commit still fires standalone', () => {
    const text = '- [ ] dev/01 v1 Ship it. Commit: 1234567';
    const findings = lintIssueBody(body(text), 'CASE-1');
    expect(findings.some((f) => f.rule === 'unchecked-with-commit')).toBe(true);
  });

  test('a body with zero findings across all four rules lints clean', () => {
    const findings = lintIssueBody(body('A normal update with no red flags.'), 'CASE-1');
    expect(findings).toEqual([]);
  });
});
