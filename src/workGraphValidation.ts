import type { z } from 'zod';
import type { ProjectGraph } from './workGraph.ts';

type RefCheck = {
  owner: string;
  field: string;
  refs: string[];
  allowed: ReadonlySet<string>;
};

function addMissingRefIssues(checks: RefCheck[], ctx: z.RefinementCtx): void {
  for (const check of checks) {
    for (const ref of check.refs) {
      if (check.allowed.has(ref)) continue;
      ctx.addIssue({
        code: 'custom',
        path: [check.owner, check.field],
        message: `${check.owner}.${check.field} references missing node "${ref}"`,
        params: { code: 'work_graph_missing_ref', owner: check.owner, field: check.field, ref },
      });
    }
  }
}

function addDuplicateIdIssues(ids: string[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    ctx.addIssue({
      code: 'custom',
      path: ['nodes'],
      message: `duplicate work graph node id "${id}"`,
      params: { code: 'work_graph_duplicate_id', id },
    });
  }
}

export function validateProjectGraphRefs(graph: ProjectGraph, ctx: z.RefinementCtx): void {
  const artifactIds = new Set(graph.artifacts.map((node) => node.id));
  const sourceIds = new Set(graph.sources.map((node) => node.id));
  const issueIds = new Set(graph.issues.map((node) => node.id));
  const requirementIds = new Set(graph.requirements.map((node) => node.id));
  const acIds = new Set(graph.acceptanceCriteria.map((node) => node.id));
  const scenarioIds = new Set(graph.scenarios.map((node) => node.id));
  const taskIds = new Set(graph.tasks.map((node) => node.id));
  const evidenceIds = new Set(graph.evidence.map((node) => node.id));
  const allNodeIds = [
    ...graph.artifacts.map((node) => node.id),
    ...graph.sources.map((node) => node.id),
    ...graph.issues.map((node) => node.id),
    ...graph.requirements.map((node) => node.id),
    ...graph.acceptanceCriteria.map((node) => node.id),
    ...graph.scenarios.map((node) => node.id),
    ...graph.tasks.map((node) => node.id),
    ...graph.evidence.map((node) => node.id),
  ];
  const allNodeIdSet = new Set(allNodeIds);
  addDuplicateIdIssues(allNodeIds, ctx);

  const checks: RefCheck[] = [];
  for (const node of graph.artifacts) checks.push({ owner: `artifact:${node.id}`, field: 'sourceRefs', refs: node.sourceRefs, allowed: sourceIds });
  for (const node of graph.issues) {
    checks.push({ owner: `issue:${node.id}`, field: 'sourceRefs', refs: node.sourceRefs, allowed: sourceIds });
    checks.push({ owner: `issue:${node.id}`, field: 'acRefs', refs: node.acRefs, allowed: acIds });
    checks.push({ owner: `issue:${node.id}`, field: 'artifactRefs', refs: node.artifactRefs, allowed: artifactIds });
  }
  for (const node of graph.requirements) {
    checks.push({ owner: `requirement:${node.id}`, field: 'issueRefs', refs: node.issueRefs, allowed: issueIds });
    checks.push({ owner: `requirement:${node.id}`, field: 'acRefs', refs: node.acRefs, allowed: acIds });
    checks.push({ owner: `requirement:${node.id}`, field: 'sourceRefs', refs: node.sourceRefs, allowed: sourceIds });
    checks.push({ owner: `requirement:${node.id}`, field: 'scenarioRefs', refs: node.scenarioRefs, allowed: scenarioIds });
  }
  for (const node of graph.acceptanceCriteria) {
    checks.push({ owner: `ac:${node.id}`, field: 'issueRef', refs: [node.issueRef], allowed: issueIds });
    checks.push({ owner: `ac:${node.id}`, field: 'sourceRefs', refs: node.sourceRefs, allowed: sourceIds });
    checks.push({ owner: `ac:${node.id}`, field: 'requirementRefs', refs: node.requirementRefs, allowed: requirementIds });
    checks.push({ owner: `ac:${node.id}`, field: 'scenarioRefs', refs: node.scenarioRefs, allowed: scenarioIds });
    checks.push({ owner: `ac:${node.id}`, field: 'evidenceRefs', refs: node.evidenceRefs, allowed: evidenceIds });
  }
  for (const node of graph.scenarios) {
    checks.push({ owner: `scenario:${node.id}`, field: 'requirementRefs', refs: node.requirementRefs, allowed: requirementIds });
    checks.push({ owner: `scenario:${node.id}`, field: 'acRefs', refs: node.acRefs, allowed: acIds });
    checks.push({ owner: `scenario:${node.id}`, field: 'sourceRefs', refs: node.sourceRefs, allowed: sourceIds });
  }
  for (const node of graph.tasks) {
    checks.push({ owner: `task:${node.id}`, field: 'parentRef', refs: node.parentRef ? [node.parentRef] : [], allowed: taskIds });
    checks.push({ owner: `task:${node.id}`, field: 'subtaskRefs', refs: node.subtaskRefs, allowed: taskIds });
    checks.push({ owner: `task:${node.id}`, field: 'dependencyRefs', refs: node.dependencyRefs, allowed: taskIds });
    checks.push({ owner: `task:${node.id}`, field: 'requirementRefs', refs: node.requirementRefs, allowed: requirementIds });
    checks.push({ owner: `task:${node.id}`, field: 'acRefs', refs: node.acRefs, allowed: acIds });
    checks.push({ owner: `task:${node.id}`, field: 'sourceRefs', refs: node.sourceRefs, allowed: sourceIds });
  }
  for (const node of graph.evidence) {
    checks.push({ owner: `evidence:${node.id}`, field: 'provesAcRefs', refs: node.provesAcRefs, allowed: acIds });
    checks.push({ owner: `evidence:${node.id}`, field: 'observesScenarioRefs', refs: node.observesScenarioRefs, allowed: scenarioIds });
    checks.push({ owner: `evidence:${node.id}`, field: 'sourceRefs', refs: node.sourceRefs, allowed: sourceIds });
  }
  for (const relation of graph.relations) {
    checks.push({ owner: `relation:${relation.kind}`, field: 'from', refs: [relation.from], allowed: allNodeIdSet });
    checks.push({ owner: `relation:${relation.kind}`, field: 'to', refs: [relation.to], allowed: allNodeIdSet });
  }
  addMissingRefIssues(checks, ctx);
}
