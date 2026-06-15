// A minimal preset that follows the rules. Domain: a simple spec issue whose
// acceptance criteria are GFM task-list items, each carrying commit-backed
// evidence as a nested list. The whole thing is ONE strict Zod schema; mdast
// fills it; rules validate it with injected context.
//
// Hard schema = the core fields (id/title/summary/status, id/status/evidence,
// id) PLUS preset-specific strict fields (a status enum, AC `text`, evidence
// `commit`). No passthrough, no unknown.

import { z } from 'zod';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { check as runCheck, type Context, type CoreRoot, type Finding, type Preset, type Rule } from '../core/engine.ts';

// ── the hard schema (core + preset-specific, all strict) ────────────────────
export const SpecEvidenceSchema = z.object({
  id: z.string().min(1),                              // core
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),       // preset: evidence is commit-backed
}).strict();

export const SpecAcStatusSchema = z.enum(['pending', 'passed', 'failed']); // preset's status vocabulary
export const SpecAcSchema = z.object({
  id: z.string().min(1),                              // core
  status: SpecAcStatusSchema,                          // core (preset narrows the type)
  evidence: z.array(SpecEvidenceSchema),              // core
  text: z.string().min(1),                            // preset
}).strict();

export const SpecIssueStatusSchema = z.enum(['draft', 'in-review', 'done']);
export const SpecIssueSchema = z.object({
  id: z.string().min(1),                              // core
  title: z.string().min(1),                           // core
  summary: z.string(),                                // core
  status: SpecIssueStatusSchema,                       // core (narrowed)
  acceptanceCriteria: z.array(SpecAcSchema),          // core
}).strict();

export const SpecRootSchema = z.object({ issues: z.array(SpecIssueSchema) }).strict();
export type SpecRoot = z.infer<typeof SpecRootSchema>;

// ── mdast parse: markdown -> the schema shape (structured, no prose mining) ──
type MdNode = { type: string; depth?: number; checked?: boolean | null; children?: MdNode[]; value?: string };

function nodeText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(nodeText).join('');
}

function firstParagraphText(item: MdNode): string {
  const p = (item.children ?? []).find((c) => c.type === 'paragraph');
  return p ? nodeText(p).split('\n')[0]!.trim() : '';
}

// designated-position parses (the title line, the AC line, the evidence line) —
// not free-prose mining.
function splitIdTitle(headingText: string): { id: string; title: string } {
  const m = /^(\S+):\s*(.+)$/.exec(headingText.trim());
  return m ? { id: m[1]!, title: m[2]!.trim() } : { id: headingText.trim(), title: headingText.trim() };
}
function splitAcIdText(line: string): { id: string; text: string } {
  const m = /^(\S+)\s+(.+)$/.exec(line);
  return m ? { id: m[1]!, text: m[2]!.trim() } : { id: line, text: line };
}

export function parseSpec(markdown: string): unknown {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as MdNode;
  const nodes = tree.children ?? [];
  const issue: Record<string, unknown> = { id: '', title: '', summary: '', status: 'draft', acceptanceCriteria: [] };
  let inAc = false;

  for (const node of nodes) {
    if (node.type === 'heading' && node.depth === 1) {
      const { id, title } = splitIdTitle(nodeText(node));
      issue.id = id; issue.title = title; inAc = false;
      continue;
    }
    if (node.type === 'heading') {
      inAc = /acceptance criteria/i.test(nodeText(node));
      continue;
    }
    if (node.type === 'paragraph') {
      const text = nodeText(node);
      const status = /^Status:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (status) issue.status = status;
      const summary = /^Summary:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (summary) issue.summary = summary;
      continue;
    }
    if (node.type === 'list' && inAc) {
      const acs: unknown[] = [];
      for (const item of node.children ?? []) {
        if (item.type !== 'listItem') continue;
        const { id, text } = splitAcIdText(firstParagraphText(item));
        const status = item.checked === true ? 'passed' : 'pending';
        const evidence: unknown[] = [];
        const nested = (item.children ?? []).find((c) => c.type === 'list');
        for (const evItem of nested?.children ?? []) {
          const commit = /commit:\s*([0-9a-fA-F]+)/.exec(firstParagraphText(evItem))?.[1]?.toLowerCase();
          if (commit) evidence.push({ id: `${id}/ev${evidence.length + 1}`, commit });
        }
        acs.push({ id, status, text, evidence });
      }
      issue.acceptanceCriteria = acs;
    }
  }
  return { issues: issue.id ? [issue] : [] };
}

// ── rules: pure, over the typed root + context ──────────────────────────────
const passedAcNeedsEvidence: Rule<SpecRoot> = {
  name: 'passed_ac_needs_evidence',
  run: (root) => root.issues.flatMap((issue) =>
    issue.acceptanceCriteria.filter((ac) => ac.status === 'passed' && ac.evidence.length === 0).map((ac): Finding => ({
      code: 'passed_ac_missing_evidence', severity: 'error',
      message: `AC ${ac.id} is passed but cites no commit-backed evidence.`, issueId: issue.id, acId: ac.id,
    }))),
};

const evidenceCommitExists: Rule<SpecRoot> = {
  name: 'evidence_commit_exists',
  run: (root, ctx: Context) => {
    const existing = new Set(ctx.git?.existingCommits ?? []);
    return root.issues.flatMap((issue) => issue.acceptanceCriteria.flatMap((ac) =>
      ac.evidence.filter((ev) => !existing.has(ev.commit)).map((ev): Finding => ({
        code: 'evidence_commit_not_found', severity: 'error',
        message: `Evidence ${ev.id} cites commit ${ev.commit}, which does not exist.`, issueId: issue.id, acId: ac.id, evidenceId: ev.id,
      }))));
  },
};

const uniqueAcIds: Rule<SpecRoot> = {
  name: 'unique_ac_ids',
  run: (root) => root.issues.flatMap((issue) => {
    const seen = new Set<string>(); const dups: Finding[] = [];
    for (const ac of issue.acceptanceCriteria) {
      if (seen.has(ac.id)) dups.push({ code: 'duplicate_ac_id', severity: 'error', message: `Duplicate AC id ${ac.id}.`, issueId: issue.id, acId: ac.id });
      seen.add(ac.id);
    }
    return dups;
  }),
};

export const SpecPreset: Preset<SpecRoot> = {
  name: 'spec',
  schema: SpecRootSchema,
  parse: parseSpec,
  rules: [passedAcNeedsEvidence, evidenceCommitExists, uniqueAcIds],
};

export function checkSpec(markdown: string, ctx?: Context) {
  return runCheck(SpecPreset, markdown, ctx);
}
