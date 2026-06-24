// End-to-end auto-scope over the REAL default preset: run an actual check over a
// two-issue tracker, then apply the same resolve+partition the CLI's --auto-scope
// path applies, and assert the scoped gate's verdict differs from the whole-tracker
// verdict. This is the behavior that matters — a green gate for THIS branch even
// when an unrelated issue is red.
import { describe, expect, test } from 'bun:test';
import { checkDefault } from '../boilerplates/presets/default.ts';
import type { IssueRecord } from './core/engine.ts';
import { partitionFindings, resolveActiveIssue } from './core/scope.ts';

const HEAD = 'cafe1234beef';
const PR = 'https://github.com/volter-ai/x/pull/5';
const ctx = { git: { existingCommits: [HEAD], prs: { [PR]: { headSha: HEAD, merged: false } } } };

// metadata (id/title/status/assignee) is structured on the record; only content is in `body`.
const clean = (id: string): IssueRecord => ({ id, title: 'Appointment search', status: 'in-review', assignee: 'otto', body: `Summary: members find appointments fast
PR: ${PR}

## Acceptance Criteria

- [x] AC-1 v2 Members can filter by status
  - status: passed
  - evidence ev1: commit=${HEAD} acv=2
  - proof: "ev1 shows the status filter applied" -> ev1
` });

const broken = (id: string): IssueRecord => ({ id, title: 'Half-authored', status: 'in-review', assignee: 'otto', body: `Summary: not ready yet

## Acceptance Criteria
` });

function scoped(issues: IssueRecord[], branch: string) {
  const whole = checkDefault(issues, ctx);
  const issueIds = (whole.export?.issues ?? []).map((i) => i.id);
  const { issueId } = resolveActiveIssue({ branch, issueIds });
  return { whole, active: issueId, ...partitionFindings(whole.findings, issueId) };
}

describe('auto-scope over real default-preset findings', () => {
  test('routes findings by the resolved active issue', () => {
    const s = scoped([broken('DEF-1'), broken('OTHER-9')], 'feature/DEF-1-fix');
    expect(s.active).toBe('DEF-1');
    expect(s.blocking.length).toBeGreaterThan(0);
    expect(s.blocking.every((f) => f.issueId === 'DEF-1')).toBe(true);
    expect(s.informational.length).toBeGreaterThan(0);
    expect(s.informational.every((f) => f.issueId === 'OTHER-9')).toBe(true);
  });

  test('a clean active issue passes the scoped gate even when another issue is red', () => {
    const s = scoped([clean('DEF-1'), broken('OTHER-9')], 'feature/DEF-1-fix');
    expect(s.active).toBe('DEF-1');
    expect(s.whole.ok).toBe(false);       // the whole tracker is red...
    expect(s.blocking).toHaveLength(0);    // ...but the gate for THIS branch is green
    expect(s.informational.length).toBeGreaterThan(0);
  });

  test('unresolved branch fails closed: the whole tracker gates', () => {
    const s = scoped([broken('DEF-1'), broken('OTHER-9')], 'autonomy-cutover');
    expect(s.active).toBeNull();
    expect(s.blocking).toHaveLength(s.whole.findings.length);
    expect(s.informational).toHaveLength(0);
  });
});
