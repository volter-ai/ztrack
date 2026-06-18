// Write-side / formatter helpers over issue markdown (the canonical-issue parser
// + renderer used by `fmt`/`lint`/mutation). This is NOT the validation pipeline
// — validation is the single core engine (core/engine.ts + the active preset).
import { z } from 'zod';
import {
  parseMarkdownDocument,
  renderCanonicalIssueMarkdown,
  type CanonicalIssueMarkdown,
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
