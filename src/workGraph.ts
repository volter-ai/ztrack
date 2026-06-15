import { z } from 'zod';
import { validateProjectGraphRefs } from './workGraphValidation.ts';

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const WorkGraphMetadataSchema = z.record(z.string(), JsonValueSchema);
export type WorkGraphMetadata = z.infer<typeof WorkGraphMetadataSchema>;

export const WorkGraphArtifactKindSchema = z.enum([
  'constitution',
  'spec',
  'proposal',
  'plan',
  'research',
  'contract',
  'quickstart',
  'task-list',
  'task',
  'design',
  'decision',
  'scenario',
  'delta',
  'prd',
  'epic',
  'story',
  'qa-gate',
  'test-strategy',
  'risk',
  'nfr',
  'steering',
  'hook',
  'board',
  'unknown',
]);
export type WorkGraphArtifactKind = z.infer<typeof WorkGraphArtifactKindSchema>;

export const WorkGraphSourceKindSchema = z.enum([
  'external-message',
  'ticket',
  'issue',
  'document',
  'spec',
  'proposal',
  'prd',
  'task-file',
  'code',
  'manual',
]);
export type WorkGraphSourceKind = z.infer<typeof WorkGraphSourceKindSchema>;

export const WorkGraphAcStatusSchema = z.enum([
  'pending',
  'passed',
  'failed',
  'stale',
  'blocked',
  'descoped',
]);
export type WorkGraphAcStatus = z.infer<typeof WorkGraphAcStatusSchema>;

export const WorkGraphScenarioFormatSchema = z.enum([
  'given-when-then',
  'ears',
  'freeform',
]);
export type WorkGraphScenarioFormat = z.infer<typeof WorkGraphScenarioFormatSchema>;

export const WorkGraphEvidenceStatusSchema = z.enum([
  'pass',
  'fail',
  'unknown',
]);
export type WorkGraphEvidenceStatus = z.infer<typeof WorkGraphEvidenceStatusSchema>;

export const WorkGraphRelationKindSchema = z.enum([
  'derives-from',
  'implements',
  'covers',
  'proves',
  'observes',
  'blocks',
  'depends-on',
  'modifies',
  'justifies',
  'tests',
  'approves',
  'archives',
  'supersedes',
]);
export type WorkGraphRelationKind = z.infer<typeof WorkGraphRelationKindSchema>;

const NodeIdSchema = z.string().trim().min(1);
const RefListSchema = z.array(NodeIdSchema).default([]);

export const WorkGraphArtifactSchema = z.object({
  id: NodeIdSchema,
  kind: WorkGraphArtifactKindSchema,
  path: z.string().trim().min(1).optional(),
  locator: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  sourceRefs: RefListSchema,
  metadata: WorkGraphMetadataSchema.optional(),
});
export type WorkGraphArtifact = z.infer<typeof WorkGraphArtifactSchema>;

export const WorkGraphSourceSchema = z.object({
  id: NodeIdSchema,
  kind: WorkGraphSourceKindSchema,
  system: z.string().trim().min(1).optional(),
  uri: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
  locator: z.string().trim().min(1).optional(),
  excerpt: z.string().optional(),
  observedAt: z.string().trim().min(1).optional(),
  metadata: WorkGraphMetadataSchema.optional(),
});
export type WorkGraphSource = z.infer<typeof WorkGraphSourceSchema>;

export const WorkGraphIssueSchema = z.object({
  id: NodeIdSchema,
  title: z.string().trim().min(1),
  status: z.string().trim().min(1).optional(),
  sourceRefs: RefListSchema,
  acRefs: RefListSchema,
  artifactRefs: RefListSchema,
  metadata: WorkGraphMetadataSchema.optional(),
});
export type WorkGraphIssue = z.infer<typeof WorkGraphIssueSchema>;

export const WorkGraphRequirementSchema = z.object({
  id: NodeIdSchema,
  text: z.string().trim().min(1),
  strength: z.enum(['must', 'shall', 'should', 'may']).optional(),
  issueRefs: RefListSchema,
  acRefs: RefListSchema,
  sourceRefs: RefListSchema,
  scenarioRefs: RefListSchema,
  metadata: WorkGraphMetadataSchema.optional(),
});
export type WorkGraphRequirement = z.infer<typeof WorkGraphRequirementSchema>;

export const WorkGraphAcceptanceCriterionSchema = z.object({
  id: NodeIdSchema,
  text: z.string().trim().min(1),
  status: WorkGraphAcStatusSchema.optional(),
  issueRef: NodeIdSchema,
  sourceRefs: RefListSchema,
  requirementRefs: RefListSchema,
  scenarioRefs: RefListSchema,
  evidenceRefs: RefListSchema,
  version: z.string().trim().min(1).optional(),
  metadata: WorkGraphMetadataSchema.optional(),
});
export type WorkGraphAcceptanceCriterion = z.infer<typeof WorkGraphAcceptanceCriterionSchema>;

export const WorkGraphScenarioSchema = z.object({
  id: NodeIdSchema,
  text: z.string().trim().min(1),
  format: WorkGraphScenarioFormatSchema,
  requirementRefs: RefListSchema,
  acRefs: RefListSchema,
  sourceRefs: RefListSchema,
  metadata: WorkGraphMetadataSchema.optional(),
});
export type WorkGraphScenario = z.infer<typeof WorkGraphScenarioSchema>;

export const WorkGraphTaskSchema = z.object({
  id: NodeIdSchema,
  title: z.string().trim().min(1),
  status: z.string().trim().min(1).optional(),
  priority: z.string().trim().min(1).optional(),
  parentRef: NodeIdSchema.optional(),
  subtaskRefs: RefListSchema,
  dependencyRefs: RefListSchema,
  requirementRefs: RefListSchema,
  acRefs: RefListSchema,
  sourceRefs: RefListSchema,
  metadata: WorkGraphMetadataSchema.optional(),
});
export type WorkGraphTask = z.infer<typeof WorkGraphTaskSchema>;

export const WorkGraphEvidenceSchema = z.object({
  id: NodeIdSchema,
  kind: z.string().trim().min(1),
  provesAcRefs: RefListSchema,
  observesScenarioRefs: RefListSchema,
  sourceRefs: RefListSchema,
  uri: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
  sha: z.string().trim().min(1).optional(),
  status: WorkGraphEvidenceStatusSchema.optional(),
  metadata: WorkGraphMetadataSchema.optional(),
});
export type WorkGraphEvidence = z.infer<typeof WorkGraphEvidenceSchema>;

export const WorkGraphRelationSchema = z.object({
  from: NodeIdSchema,
  to: NodeIdSchema,
  kind: WorkGraphRelationKindSchema,
});
export type WorkGraphRelation = z.infer<typeof WorkGraphRelationSchema>;

export const ProjectGraphSchema = z.object({
  artifacts: z.array(WorkGraphArtifactSchema).default([]),
  sources: z.array(WorkGraphSourceSchema).default([]),
  issues: z.array(WorkGraphIssueSchema).default([]),
  requirements: z.array(WorkGraphRequirementSchema).default([]),
  acceptanceCriteria: z.array(WorkGraphAcceptanceCriterionSchema).default([]),
  scenarios: z.array(WorkGraphScenarioSchema).default([]),
  tasks: z.array(WorkGraphTaskSchema).default([]),
  evidence: z.array(WorkGraphEvidenceSchema).default([]),
  relations: z.array(WorkGraphRelationSchema).default([]),
}).superRefine(validateProjectGraphRefs);
export type ProjectGraph = z.infer<typeof ProjectGraphSchema>;

export type ValidatedPresetModel<Native> = {
  graph: ProjectGraph;
  native: Native;
};
