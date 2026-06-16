import { z } from 'zod';

const ExtensionSchema = z.record(z.string(), z.unknown());

export const TrackerCommentSchema = z.object({
  body: z.string().optional(),
  createdAt: z.string().optional(),
}).passthrough();

export const TrackerSourceSchema = z.object({
  number: z.string().min(1),
  connection: z.string().min(1),
  content: z.string(),
  meta: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export const TrackerLinkedIssueSchema = z.object({
  key: z.string().min(1),
  system: z.string().min(1),
  url: z.string().optional(),
  title: z.string().optional(),
  sourceNumber: z.string().optional(),
}).passthrough();

export const TrackerAcceptanceCriterionStatusSchema = z.enum([
  'pending',
  'passed',
  'failed',
  'stale',
  'blocked',
  'descoped',
]);

export const TrackerAcceptanceCriterionBasicSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  checked: z.boolean(),
  status: TrackerAcceptanceCriterionStatusSchema.or(z.string().min(1)),
  body: z.string(),
  text: z.string(),
  sourceRefs: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  proofRefs: z.array(z.string().min(1)).default([]),
  commitHashes: z.array(z.string().min(1)).default([]),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export type TrackerAcceptanceCriterionBasic = z.infer<typeof TrackerAcceptanceCriterionBasicSchema>;

export const TrackerSkillRunSchema = z.object({
  runId: z.string().min(1),
  skill: z.string().min(1),
  taskIssue: z.string().optional(),
  parentCase: z.string().optional(),
  status: z.string().min(1),
  startedAt: z.string().optional(),
  stoppedAt: z.string().optional(),
  summary: z.string().optional(),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerThreadRedirectSchema = z.object({
  notificationKey: z.string().min(1),
  index: z.number().int().min(0),
  reason: z.string().min(1),
  target: z.string().min(1),
  issue: z.string().optional(),
  targetIssue: z.string().optional(),
  sourceMessage: z.string().optional(),
  currentThreadText: z.string().min(1),
  newThreadText: z.string().optional(),
  currentThreadRef: z.string().min(1),
  targetThreadRef: z.string().optional(),
  channel: z.string(),
  threadTs: z.string(),
  sentAt: z.string(),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerDiagnosticSchema = z.object({
  level: z.enum(['error', 'warning']),
  code: z.string().min(1),
  message: z.string().min(1),
  section: z.string().optional(),
  line: z.number().int().positive().optional(),
  issue: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerAuditEntrySchema = z.object({
  id: z.number().int().nonnegative(),
  createdAt: z.string(),
  actor: z.string().optional(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  issueIdentifier: z.string().optional(),
  field: z.string().optional(),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerLegacyVersionSchema = z.object({
  version: z.string().min(1),
  label: z.string().optional(),
  reason: z.string().optional(),
  appliesTo: z.record(z.string(), z.unknown()).optional(),
  exemptions: z.array(z.string().min(1)).optional(),
}).passthrough();

export const TrackerLegacyExemptionSchema = z.object({
  version: z.string().min(1),
  label: z.string().optional(),
  reason: z.string().optional(),
  exemptions: z.array(z.string().min(1)).optional(),
}).passthrough();

export const TrackerPresetPayloadSchema = z.object({
  preset: z.string().min(1),
  template: z.string().optional(),
  title: z.string().optional(),
  sections: z.record(z.string(), z.object({ body: z.string().optional() }).passthrough()).default({}),
  sources: z.array(z.object({
    number: z.string().min(1),
    label: z.string().optional(),
    content: z.string(),
  }).passthrough()).default([]),
  acceptanceCriteria: z.array(TrackerAcceptanceCriterionBasicSchema).default([]),
  evidence: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    fields: z.record(z.string(), z.string()).default({}),
    ac: z.array(z.string().min(1)).default([]),
    extensions: ExtensionSchema.optional(),
  }).passthrough()).default([]),
  proofs: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    fields: z.record(z.string(), z.string()).default({}),
    ac: z.array(z.string().min(1)).default([]),
    evidence: z.array(z.string().min(1)).default([]),
    extensions: ExtensionSchema.optional(),
  }).passthrough()).default([]),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerValidatedIssueSchema = TrackerPresetPayloadSchema;

const BaseIssueSchema = z.object({
  identifier: z.string().min(1),
  title: z.string(),
  summary: z.string().default(''),
  body: z.string(),
  validatedIssue: TrackerValidatedIssueSchema,
  acceptanceCriteria: z.array(TrackerAcceptanceCriterionBasicSchema).default([]),
  markdownDiagnostics: z.array(TrackerDiagnosticSchema).default([]),
  state: z.string(),
  status: z.string().default(''),
  stateType: z.string(),
  createdAt: z.string().optional(),
  stateSince: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()),
  project: z.string().default(''),
  comments: z.array(TrackerCommentSchema).default([]),
  branchName: z.string().default(''),
  sources: z.array(TrackerSourceSchema),
  linkedIssues: z.array(TrackerLinkedIssueSchema).default([]),
  blocks: z.array(z.string().min(1)).default([]),
  blockedBy: z.array(z.string().min(1)).default([]),
  skillRuns: z.array(TrackerSkillRunSchema).default([]),
  history: z.array(TrackerAuditEntrySchema).default([]),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerTaskIssueSchema = BaseIssueSchema.extend({
  kind: z.string().min(1),
  gateType: z.string().min(1).optional(),
  issueType: z.string().min(1).optional(),
  parentCase: z.string().min(1),
  legacyExemption: TrackerLegacyExemptionSchema.nullable().optional(),
}).passthrough();

export const TrackerCaseSchema = BaseIssueSchema.extend({
  gateType: z.string().min(1).optional(),
  legacyExemption: TrackerLegacyExemptionSchema.nullable().optional(),
  parentCase: z.string().optional(),
  unmappedCheckedAcCount: z.number().int().min(0).default(0),
  threadRedirects: z.array(TrackerThreadRedirectSchema).default([]),
  taskIssues: z.array(TrackerTaskIssueSchema).default([]),
}).passthrough();

export const TrackerMessageSchema = z.object({
  message_id: z.string().min(1),
  team: z.string(),
  channel: z.string(),
  ts: z.string(),
  thread_ts: z.string(),
  user: z.string(),
  user_name: z.string(),
  text: z.string(),
  datetime_utc: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  author_role: z.string().optional(),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerAnnotationSchema = z.object({
  message_id: z.string().optional(),
  id: z.string().optional(),
  classification: z.string().optional(),
  action_classification: z.string().optional(),
  quote: z.string().optional(),
  target: z.string().optional(),
  issue: z.string().optional(),
  externalIssue: z.string().optional(),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerSnapshotSchema = z.object({
  schema: z.literal('tracker-snapshot@1').or(z.string().min(1)),
  projectRoot: z.string().min(1),
  preset: z.string().optional(),
  legacyVersions: z.array(TrackerLegacyVersionSchema).default([]),
  cases: z.array(TrackerCaseSchema),
  noCaseSkillRuns: z.array(TrackerSkillRunSchema).default([]),
  threadRedirects: z.array(TrackerThreadRedirectSchema).default([]),
  messages: z.array(TrackerMessageSchema).default([]),
  annotations: z.array(TrackerAnnotationSchema).default([]),
  malformed: z.object({
    messages: z.number().int().min(0),
    annotations: z.number().int().min(0),
  }).default({ messages: 0, annotations: 0 }),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerFindingSchema = z.object({
  level: z.enum(['error', 'warning']),
  code: z.string().min(1),
  message: z.string().min(1),
  issue: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export const TrackerValidationReportSchema = z.object({
  valid: z.boolean(),
  summary: z.record(z.string(), z.unknown()),
  findings: z.array(TrackerFindingSchema),
  extensions: ExtensionSchema.optional(),
}).passthrough();

export type TrackerSnapshot = z.infer<typeof TrackerSnapshotSchema>;
export type TrackerFinding = z.infer<typeof TrackerFindingSchema>;
export type TrackerValidationReport = z.infer<typeof TrackerValidationReportSchema>;
