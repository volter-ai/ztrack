import { describe, expect, test } from 'bun:test';
import { canonicalize, parseIssue, roundTripDiff, serializeIssue, type CanonicalIssue } from './markdown.ts';

const tricky: CanonicalIssue = {
  identifier: 'PH-9',
  title: 'Fix http://x:8080 "quoted" — colons: everywhere',
  body: '# PH-9: t\n\n## Summary\n\nbody with `code`, a --- line, and a trailing newline.\n',
  state: 'In Review',
  stateType: 'open',
  assignees: ['otto@volter.ai'],
  labels: ['type:bug', 'P1', 'size/XS'],
  project: null,
  parent: null,
  children: ['PH-10', 'PH-11'],
  branchName: 'otto/ph-9',
  priority: 0,
  devProgress: '',
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: '2026-06-15T01:00:00.000Z',
  completedAt: null,
  canceledAt: null,
  url: 'local://tracker/issue/PH-9',
  comments: [{ user: 'local', createdAt: '2026-06-15T00:30:00Z', body: 'multi-line\n\n## heading inside comment\n| a | b |\n|---|---|\n| 1 | 2 |' }],
};

describe('markdown backend (de)serialization', () => {
  test('round-trips a tricky canonical issue exactly', () => {
    expect(roundTripDiff(tricky)).toEqual([]);
    expect(parseIssue(serializeIssue(tricky))).toEqual(tricky);
  });
  test('comments live in an HTML-comment block (invisible to the preset body parser)', () => {
    const md = serializeIssue(tricky);
    const body = md.split('\n---\n')[1]!.split('\n<!--tracker:comments')[0]!;
    expect(body).toBe(tricky.body);                       // body is verbatim
    expect(body).not.toContain('heading inside comment'); // comment text is NOT in the body
    expect(md).toContain('<!--tracker:comments');
  });
  test('null/empty optional fields are omitted, not written as "null"', () => {
    const md = serializeIssue(tricky);
    expect(md).not.toContain('parent:');   // null → omitted (so the preset never reads "null")
    expect(md).not.toContain('project:');
  });
  test('devProgress is always written (null vs "" are distinct and both preserved)', () => {
    expect(serializeIssue({ ...tricky, devProgress: '' })).toContain('devProgress: ""');
    expect(serializeIssue({ ...tricky, devProgress: null })).toContain('devProgress: null');
    expect(parseIssue(serializeIssue({ ...tricky, devProgress: null })).devProgress).toBeNull();
  });
  test('canonicalize maps the raw CLI shape + drops only derived fields', () => {
    const raw = { id: 'PH-9', identifier: 'PH-9', number: 'PH-9', title: 't', body: 'b', description: 'b', state: { name: 'Done', type: 'completed' }, stateType: 'completed', assignee: { name: 'otto' }, assignees: { nodes: [{ name: 'otto' }] }, labels: { nodes: [{ name: 'P1' }] }, project: null, parent: null, children: { nodes: [] }, comments: { nodes: [{ body: 'c', createdAt: 't', user: { name: 'local' } }] }, branchName: '', priority: 0, devProgress: '', createdAt: 't', updatedAt: 't', completedAt: null, canceledAt: null, url: 'u' };
    const c = canonicalize(raw);
    expect(c).toMatchObject({ identifier: 'PH-9', title: 't', body: 'b', state: 'Done', stateType: 'completed', assignees: ['otto'], labels: ['P1'], comments: [{ user: 'local', body: 'c' }] });
  });

  test("a body containing the comments marker round-trips (split at last marker)", () => {
    const c: CanonicalIssue = { ...tricky, body: "real\n<!--tracker:comments\n[\"fake\"]\n-->\nafter", comments: [{ user: "u", createdAt: "2026-06-15T00:00:00Z", body: "real comment" }] };
    const back = parseIssue(serializeIssue(c));
    expect(back.body).toBe(c.body);
    expect(back.comments).toEqual(c.comments);
  });

});
