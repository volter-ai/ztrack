import { describe, expect, test } from 'bun:test';
import {
  blockCycles, blockStatuses, blockerRefProblems, completionViolations, dependencyGraph,
  nodeIndex, nodeSatisfied, normalizeBlockRefs, parseBlockToken,
} from './blocking.ts';
import { formatRef } from './ref.ts';
import type { CoreAC, CoreIssue, CoreRoot, Relation } from './engine.ts';

const ac = (id: string, status: string, extra: Partial<CoreAC> = {}): CoreAC => ({ id, status, evidence: [], ...extra });
const issue = (id: string, acs: CoreAC[], relations?: Relation[]): CoreIssue => ({ id, title: id, summary: '', status: 'open', acceptanceCriteria: acs, ...(relations ? { relations } : {}) });
const root = (...issues: CoreIssue[]): CoreRoot => ({ issues });

describe('unified dependency graph', () => {
  test('blocked-by and the inverse of blocks feed the SAME edges', () => {
    const r = root(issue('A', [
      ac('1', 'pending', { blockedBy: [{ issue: 'A', ac: '2' }] }),
      ac('2', 'pending'),
      ac('3', 'pending', { blocks: [{ issue: 'A', ac: '4' }] }),
      ac('4', 'pending'),
    ]));
    const g = dependencyGraph(r);
    expect([...g.get('A:1')!]).toEqual(['A:2']);
    expect([...g.get('A:4')!]).toEqual(['A:3']); // `blocks` became 4-depends-on-3
  });

  test('an AC can be blocked by a whole issue, and an issue by an AC', () => {
    const r = root(
      issue('A', [ac('1', 'pending', { blockedBy: [{ issue: 'B' }], blocks: [{ issue: 'C' }] })]),
      issue('B', [ac('9', 'pending')]),
      issue('C', [ac('9', 'pending')]),
    );
    const g = dependencyGraph(r);
    expect([...g.get('A:1')!]).toEqual(['B']);   // AC depends on the whole issue B
    expect([...g.get('C')!]).toEqual(['A:1']);   // issue C depends on the AC
  });

  test('issue-level `relations` feed the same graph', () => {
    const r = root(
      issue('A', [], [{ type: 'blocked-by', issueId: 'B' }]),
      issue('B', []),
    );
    expect([...dependencyGraph(r).get('A')!]).toEqual(['B']);
  });
});

describe('nodeSatisfied', () => {
  test('an AC is satisfied iff passed; an issue iff all its ACs are passed', () => {
    const nodes = nodeIndex(root(issue('A', [ac('1', 'passed'), ac('2', 'pending')]), issue('B', [ac('1', 'passed')])));
    expect(nodeSatisfied(nodes.get('A:1')!)).toBe(true);
    expect(nodeSatisfied(nodes.get('A:2')!)).toBe(false);
    expect(nodeSatisfied(nodes.get('A')!)).toBe(false); // A has a pending AC
    expect(nodeSatisfied(nodes.get('B')!)).toBe(true);  // all of B passed
  });

  test('a zero-AC issue is satisfied only per the isIssueDone predicate', () => {
    const nodes = nodeIndex(root(issue('E', [])));
    expect(nodeSatisfied(nodes.get('E')!)).toBe(false); // no predicate → not vacuously done
    expect(nodeSatisfied(nodes.get('E')!, { isIssueDone: () => true })).toBe(true);
  });
});

describe('cycle detection', () => {
  test('a direct AC cycle is found', () => {
    expect(blockCycles(root(issue('A', [
      ac('1', 'pending', { blockedBy: [{ issue: 'A', ac: '2' }] }),
      ac('2', 'pending', { blockedBy: [{ issue: 'A', ac: '1' }] }),
    ]))).length).toBe(1);
  });

  test('a cross-level deadlock (each issue\'s AC waits on the whole other issue) is found via containment', () => {
    const r = root(
      issue('A', [ac('1', 'pending', { blockedBy: [{ issue: 'B' }] })]),
      issue('B', [ac('1', 'pending', { blockedBy: [{ issue: 'A' }] })]),
    );
    expect(blockCycles(r).length).toBe(1);
  });

  test('a DAG has no cycles', () => {
    expect(blockCycles(root(issue('A', [
      ac('1', 'pending', { blockedBy: [{ issue: 'A', ac: '2' }] }),
      ac('2', 'pending'),
    ])))).toEqual([]);
  });
});

describe('transitive blocked status', () => {
  test('an AC blocked on an issue with pending work is blocked, reporting the issue', () => {
    const r = root(
      issue('A', [ac('1', 'pending', { blockedBy: [{ issue: 'B' }] })]),
      issue('B', [ac('9', 'pending')]),
    );
    const st = blockStatuses(r);
    expect(st.get('A:1')!.blocked).toBe(true);
    expect(st.get('A:1')!.blockers.map(formatRef)).toEqual(['B']);
  });

  test('an in-progress issue is NOT blocked by its own open ACs (containment is cycle-only)', () => {
    const st = blockStatuses(root(issue('A', [ac('1', 'pending')])));
    expect(st.get('A')!.blocked).toBe(false);
  });

  test('once upstream is satisfied, downstream is actionable', () => {
    const r = root(
      issue('A', [ac('1', 'pending', { blockedBy: [{ issue: 'B' }] })]),
      issue('B', [ac('9', 'passed')]),
    );
    expect(blockStatuses(r).get('A:1')!.blocked).toBe(false);
  });
});

describe('completion gate', () => {
  test('a passed AC depending on an unfinished issue is a violation', () => {
    const r = root(
      issue('A', [ac('1', 'passed', { blockedBy: [{ issue: 'B' }] })]),
      issue('B', [ac('9', 'pending')]),
    );
    const v = completionViolations(r);
    expect(v.map((x) => `${x.node.key}->${x.dep.key}`)).toEqual(['A:1->B']);
  });
});

describe('blockerRefProblems', () => {
  test('flags a dangling ref and a self-block', () => {
    const r = root(issue('A', [
      ac('1', 'pending', { blockedBy: [{ issue: 'A', ac: '9' }] }), // missing
      ac('2', 'pending', { blockedBy: [{ issue: 'A', ac: '2' }] }), // self
    ]));
    const p = blockerRefProblems(r);
    expect(p.find((x) => x.kind === 'missing')?.acId).toBe('1');
    expect(p.find((x) => x.kind === 'self')?.acId).toBe('2');
  });
});

describe('authoring: parseBlockToken + normalizeBlockRefs', () => {
  test('parseBlockToken classifies bare vs qualified vs malformed', () => {
    expect(parseBlockToken('dev/02', 'A')).toEqual({ issue: 'A', ac: 'dev/02', bare: true });
    expect(parseBlockToken('B:dev/01', 'A')).toEqual({ issue: 'B', ac: 'dev/01', bare: false });
    expect(parseBlockToken('a:b:c', 'A')).toBeNull();
  });

  test('a bare token resolves to a local AC, else an issue, else a dangling local AC', () => {
    const issues = [
      { id: 'A', acceptanceCriteria: [
        { id: 'dev/01', blockedBy: [parseBlockToken('dev/02', 'A')!, parseBlockToken('B', 'A')!, parseBlockToken('ghost', 'A')!] },
        { id: 'dev/02' },
      ] },
      { id: 'B', acceptanceCriteria: [] },
    ];
    normalizeBlockRefs(issues as unknown as Parameters<typeof normalizeBlockRefs>[0]);
    expect((issues[0]!.acceptanceCriteria[0]! as any).blockedBy).toEqual([
      { issue: 'A', ac: 'dev/02' }, // local AC exists
      { issue: 'B' },               // bare token is an issue id
      { issue: 'A', ac: 'ghost' },  // neither → dangling local AC (referent rule flags it)
    ]);
  });
});
