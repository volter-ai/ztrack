import { z } from 'zod';
import type { MarkdownDiagnostic } from './markdownModel.ts';
import type { RuleClassification, RuleProfile } from './checkRules.ts';
import {
  parseMarkdownDocument,
  renderCanonicalIssueMarkdown,
  type CanonicalIssueMarkdown,
  type IssueMarkdownTemplate,
} from './markdownModel.ts';

export const RawIssueCheckboxRowSchema = z.object({
  checked: z.boolean(),
  marker: z.string(),
  body: z.string(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  sectionIndex: z.number().int().min(0),
  sectionTitle: z.string(),
});

export const RawIssueSectionSchema = z.object({
  index: z.number().int().min(0),
  level: z.number().int().min(1).max(6),
  title: z.string(),
  normalizedTitle: z.string(),
  body: z.string(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  parentIndex: z.number().int().min(0).nullable(),
  checkboxRows: z.array(RawIssueCheckboxRowSchema),
});

export const RawIssueMarkdownSchema = z.object({
  body: z.string(),
  preamble: z.string(),
  trailingNewline: z.boolean(),
  title: z.object({
    title: z.string(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
  }).nullable(),
  sections: z.array(RawIssueSectionSchema),
  checkboxRows: z.array(RawIssueCheckboxRowSchema),
});

export type RawIssueCheckboxRow = z.infer<typeof RawIssueCheckboxRowSchema>;
export type RawIssueSection = z.infer<typeof RawIssueSectionSchema>;
export type RawIssueMarkdown = z.infer<typeof RawIssueMarkdownSchema>;

export type ValidationContext = {
  projectRoot?: string;
  now?: string;
  issue?: {
    identifier?: string;
    state?: string;
    stateType?: string;
    labels?: string[];
    assignee?: string;
    branchName?: string;
    legacyPolicyVersion?: string;
    legacyExemptions?: string[];
  };
  git?: {
    currentSha?: string;
    branchHeads?: Record<string, string>;
    existingCommits?: string[];
  };
  files?: {
    existingPaths?: string[];
  };
  external?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
};

export type TrackerValidationPreset<ValidatedIssue> = {
  name: string;
  parseMarkdown: (body: string) => RawIssueMarkdown;
  schemaFactory: (ctx: ValidationContext) => z.ZodType<ValidatedIssue>;
  render?: (issue: ValidatedIssue) => string;
  docs?: string;
};

export type TrackerPresetValidatedIssue = {
  preset: string;
  template?: string;
  title?: string;
  sections?: Record<string, { body?: string }>;
  sources?: Array<{ number: string; label?: string; content: string }>;
  acceptanceCriteria?: Array<{
    id: string;
    type: string;
    checked: boolean;
    status: string;
    body: string;
    rawText?: string;
    text: string;
    sourceRefs?: string[];
    evidenceRefs?: string[];
    proofRefs?: string[];
    commitHashes?: string[];
    storedStatus?: string;
    storedAcVersion?: string;
    visibility?: string;
    citedPrIds?: string[];
    extensions?: Record<string, unknown>;
  }>;
  evidence?: Array<{
    id: string;
    type: string;
    fields?: Record<string, string>;
    ac?: string[];
  }>;
  proofs?: Array<{
    id: string;
    type: string;
    fields?: Record<string, string>;
    ac?: string[];
    evidence?: string[];
  }>;
};

export type TrackerPresetExportIssue = {
  labels?: string[];
  parentCase?: string;
  stateType?: string;
  blocks?: string[];
};

export type TrackerPresetExportHooks = {
  buildValidationContext?(input: {
    branchName: string;
    evidence: Array<Record<string, unknown>>;
    acceptanceCriteria: Array<Record<string, unknown>>;
  }, helpers: {
    branchHead(branchName: string): string;
    currentImplementationSha(
      evidence: Array<Record<string, unknown>>,
      acceptanceCriteria: Array<Record<string, unknown>>,
      branchName: string,
    ): string;
  }): ValidationContext;
  linkedIssues?(input: {
    channel: string;
    sources: Array<{ number: string; content: string }>;
    evidence: Array<Record<string, unknown>>;
    comments: Array<Record<string, unknown>>;
  }): Array<Record<string, unknown>>;
  gateType?(issue: TrackerPresetExportIssue): string | undefined;
  excludePrimaryIssue?(issue: TrackerPresetExportIssue): boolean;
  // True if this sub-issue is a blocker that should be excluded from its parent's
  // primary export (preset-defined notion of a blocking sub-issue).
  isExcludedBlocker?(issue: TrackerPresetExportIssue, parentIssue: string): boolean;
  excludeImplementationPullRequestEvidence?(evidence: Record<string, unknown>): boolean;
};

export type TrackerPresetCheckHooks = {
  ruleProfiles?: RuleProfile[];
  classifyRuleCode?(code: string): RuleClassification | null;
  gateLabelsFor?(labels: Set<string>): string[];
  requiredExternalSubcaseLabels?(labels: Set<string>): string[];
  implementationPrEvidence?(repo: string): boolean;
  gateOwnerMismatch?(gateType: string, labels: Set<string>): { code: string; message: string } | null;
};

export type TrackerPresetRuntime = {
  name: string;
  scaffoldIssueBody?(title: string): string;
  parseIssueMarkdown(body: string, template: IssueMarkdownTemplate): TrackerPresetValidatedIssue;
  markdownDiagnostics(
    body: string,
    template: IssueMarkdownTemplate,
    validationContext?: ValidationContext,
  ): MarkdownDiagnostic[];
  snapshot?: {
    exportSnapshot?(options: unknown): unknown;
    checkSnapshot?(rawSnapshot: unknown, options: unknown): unknown;
    classifyRuleCode?(code: string): RuleClassification & { explicit: boolean };
  };
  export?: TrackerPresetExportHooks;
  check?: TrackerPresetCheckHooks;
};

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseRawIssueMarkdown(body: string): RawIssueMarkdown {
  const document = parseMarkdownDocument(body);
  const titleSection = document.sections.find((section) => section.level === 1 && section.parentIndex === null) ?? null;
  const rawSections = document.sections.map((section, index) => {
    const checkboxRows = section.checkboxItems.map((item) => ({
      checked: item.checked,
      marker: item.marker,
      body: item.body,
      lineStart: item.lineStart,
      lineEnd: item.lineEnd,
      sectionIndex: index,
      sectionTitle: section.title,
    }));
    return {
      index,
      level: section.level,
      title: section.title,
      normalizedTitle: normalizeTitle(section.title),
      body: section.body,
      lineStart: section.lineStart,
      lineEnd: section.lineEnd,
      parentIndex: section.parentIndex,
      checkboxRows,
    };
  });
  const checkboxRowsByLine = new Map<number, RawIssueCheckboxRow>();
  for (const section of rawSections) {
    for (const row of section.checkboxRows) {
      checkboxRowsByLine.set(row.lineStart, row);
    }
  }
  return RawIssueMarkdownSchema.parse({
    body,
    preamble: document.preamble,
    trailingNewline: document.trailingNewline,
    title: titleSection ? {
      title: titleSection.title,
      lineStart: titleSection.lineStart,
      lineEnd: titleSection.lineEnd,
    } : null,
    sections: rawSections,
    checkboxRows: [...checkboxRowsByLine.values()].sort((a, b) => a.lineStart - b.lineStart),
  });
}

export function renderPresetCanonicalIssueMarkdown(issue: CanonicalIssueMarkdown, sectionOrder: readonly string[] = []): string {
  return renderCanonicalIssueMarkdown(issue, sectionOrder);
}
