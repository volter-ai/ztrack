import { describe, expect, test } from 'bun:test';
import type { CoreAC, CoreIssue, CoreRoot, Relation } from './core/engine.ts';
import { visualizerOperationalBlocking } from './visualizerBlocking.ts';

const ac = (id: string, status: string, blockedBy?: Array<{ issue: string; ac?: string }>): CoreAC => ({
  id,
  status,
  evidence: [],
  ...(blockedBy ? { blockedBy } : {}),
});
const issue = (id: string, acceptanceCriteria: CoreAC[], relations?: Relation[]): CoreIssue => ({
  id,
  title: id,
  summary: '',
  status: 'open',
  acceptanceCriteria,
  ...(relations ? { relations } : {}),
});
const root = (...issues: CoreIssue[]): CoreRoot => ({ issues });

describe('visualizerOperationalBlocking', () => {
  test('derives active blockers from the canonical whole-graph frontier', () => {
    const statuses = visualizerOperationalBlocking(root(
      issue('A', [ac('1', 'pending')]),
      issue('B', [ac('1', 'pending')], [{ type: 'blocked-by', issueId: 'A' }]),
    ));
    expect(statuses.B).toEqual({ blocked: true, blockers: [{ issue: 'A' }] });
  });

  test('a satisfied external dependency is not operationally blocked merely because its ref remains', () => {
    const statuses = visualizerOperationalBlocking(root(
      issue('A', [ac('1', 'passed')]),
      issue('B', [ac('1', 'pending')], [{ type: 'blocked-by', issueId: 'A' }]),
    ));
    expect(statuses.B).toEqual({ blocked: false, blockers: [] });
  });

  test('same-issue AC sequencing stays actionable, matching issueFrontier', () => {
    const statuses = visualizerOperationalBlocking(root(issue('A', [
      ac('1', 'pending', [{ issue: 'A', ac: '2' }]),
      ac('2', 'pending'),
    ])));
    expect(statuses.A).toEqual({ blocked: false, blockers: [] });
  });
});
