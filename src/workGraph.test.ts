import { describe, expect, test } from 'bun:test';
import { ProjectGraphSchema } from './workGraph.ts';

function issueCodes(error: { issues: Array<{ code: string; params?: Record<string, string> }> }): string[] {
  return error.issues
    .map((issue) => issue.params?.code ?? issue.code)
    .sort();
}

describe('ProjectGraphSchema', () => {
  test('validates the issue to AC to scenario to evidence proof chain', () => {
    const graph = ProjectGraphSchema.parse({
      artifacts: [{
        id: 'artifact:spec',
        kind: 'spec',
        path: 'specs/search/spec.md',
        sourceRefs: ['source:spec-fr-1'],
      }],
      sources: [{
        id: 'source:spec-fr-1',
        kind: 'spec',
        system: 'speckit',
        path: 'specs/search/spec.md',
        locator: '# Functional Requirements / FR-001',
        excerpt: 'Users can filter appointments by status.',
      }],
      issues: [{
        id: 'issue:search',
        title: 'Appointment status filtering',
        sourceRefs: ['source:spec-fr-1'],
        acRefs: ['ac:dev-01'],
        artifactRefs: ['artifact:spec'],
      }],
      requirements: [{
        id: 'req:fr-001',
        text: 'Users can filter appointments by status.',
        strength: 'must',
        issueRefs: ['issue:search'],
        acRefs: ['ac:dev-01'],
        sourceRefs: ['source:spec-fr-1'],
        scenarioRefs: ['scenario:completed-filter'],
      }],
      acceptanceCriteria: [{
        id: 'ac:dev-01',
        text: 'The appointments list can be filtered by status.',
        status: 'passed',
        issueRef: 'issue:search',
        sourceRefs: ['source:spec-fr-1'],
        requirementRefs: ['req:fr-001'],
        scenarioRefs: ['scenario:completed-filter'],
        evidenceRefs: ['evidence:screenshot-1'],
        version: 'acv_123',
      }],
      scenarios: [{
        id: 'scenario:completed-filter',
        text: 'Given mixed appointment statuses, when Completed is selected, then only completed appointments are shown.',
        format: 'given-when-then',
        requirementRefs: ['req:fr-001'],
        acRefs: ['ac:dev-01'],
        sourceRefs: ['source:spec-fr-1'],
      }],
      tasks: [{
        id: 'task:filter-ui',
        title: 'Add appointment status filter UI',
        status: 'done',
        requirementRefs: ['req:fr-001'],
        acRefs: ['ac:dev-01'],
        sourceRefs: ['source:spec-fr-1'],
      }],
      evidence: [{
        id: 'evidence:screenshot-1',
        kind: 'screenshot',
        provesAcRefs: ['ac:dev-01'],
        observesScenarioRefs: ['scenario:completed-filter'],
        sourceRefs: ['source:spec-fr-1'],
        path: 'evidence/completed-filter.png',
        sha: 'abc123',
        status: 'pass',
      }],
      relations: [
        { from: 'req:fr-001', to: 'ac:dev-01', kind: 'derives-from' },
        { from: 'scenario:completed-filter', to: 'ac:dev-01', kind: 'covers' },
        { from: 'task:filter-ui', to: 'ac:dev-01', kind: 'implements' },
        { from: 'evidence:screenshot-1', to: 'ac:dev-01', kind: 'proves' },
        { from: 'evidence:screenshot-1', to: 'scenario:completed-filter', kind: 'observes' },
      ],
    });

    expect(graph.acceptanceCriteria[0]?.status).toBe('passed');
    expect(graph.scenarios[0]?.format).toBe('given-when-then');
    expect(graph.evidence[0]?.observesScenarioRefs).toEqual(['scenario:completed-filter']);
  });

  test('reports duplicate ids and missing references with stable codes', () => {
    const result = ProjectGraphSchema.safeParse({
      sources: [
        { id: 'source:duplicate', kind: 'spec' },
        { id: 'source:duplicate', kind: 'ticket' },
      ],
      issues: [{
        id: 'issue:search',
        title: 'Appointment status filtering',
        sourceRefs: ['source:missing'],
        acRefs: ['ac:missing'],
        artifactRefs: ['artifact:missing'],
      }],
      acceptanceCriteria: [{
        id: 'ac:dev-01',
        text: 'The appointments list can be filtered by status.',
        issueRef: 'issue:missing',
        requirementRefs: ['req:missing'],
        scenarioRefs: ['scenario:missing'],
        evidenceRefs: ['evidence:missing'],
      }],
      relations: [
        { from: 'issue:search', to: 'node:missing', kind: 'depends-on' },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(issueCodes(result.error)).toContain('work_graph_duplicate_id');
    expect(issueCodes(result.error)).toContain('work_graph_missing_ref');
    expect(result.error.issues.some((issue) => issue.message.includes('issue:search.acRefs'))).toBe(true);
    expect(result.error.issues.some((issue) => issue.message.includes('relation:depends-on.to'))).toBe(true);
  });
});
