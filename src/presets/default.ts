// The default preset — a minimal, standards-following process. One AC type (dev),
// image+commit-anchored evidence, five issue states, every issue assigned. Built
// exactly on the architecture: ONE strict Zod schema, mdast fills it, rules validate
// it against the injected git world.
//
// Deliberately minimal: no external/approval ACs, no source markers /
// world-annotations, no multi-channel or linked-issue choreography — a single
// straightforward dev lifecycle. See spec.ts for the even smaller sibling, and write
// a richer SDLC preset.
//
// Lifecycle gates (the process):
//   draft        — nothing required yet
//   ready        — at least one dev AC exists
//   in-progress  — at least one dev AC exists
//   in-review    — PR exists; every AC passed; every passed AC has fresh evidence
//   done         — the PR is merged (review gates still hold)

import { z } from 'zod';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { check as runCheck, rule, type BlockerFact, type BlockRef, type CompletionFact, type Context, type CycleFact, type DerivedModel, type Preset, type PresetContextInput } from '../core/engine.ts';
import { splitIssueBundle } from '../core/bundle.ts';
import { gitWorld } from '../core/gitWorld.ts';
import { BlockRefSchema, formatRef } from '../core/ref.ts';
import { normalizeBlockRefs, parseBlockToken, type RawBlockRef } from '../core/blocking.ts';

// ── the hard schema (core + preset-specific, all strict) ────────────────────
export const DefaultEvidenceSchema = z.object({
  id: z.string().min(1),                              // core
  image: z.string().min(1),                           // preset: evidence is an image
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),       // preset: captured at this commit
  acVersion: z.number().int().min(1),                 // preset: against this AC version
}).strict();

// proof primitive — explanation of how the cited evidence demonstrates the AC
export const DefaultProofSchema = z.object({
  explanation: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)),
}).strict();

export const DefaultAcStatusSchema = z.enum(['pending', 'passed', 'failed']);
export const DefaultAcSchema = z.object({
  id: z.string().min(1),                              // core
  status: DefaultAcStatusSchema,                       // core (preset narrows)
  checked: z.boolean(),                                // preset: the GFM checkbox (guarded vs status)
  text: z.string().min(1),                            // preset
  version: z.number().int().min(1),                   // preset: bumps when AC text changes
  evidence: z.array(DefaultEvidenceSchema),           // core
  proof: DefaultProofSchema.optional(),               // primitive (rule requires it for passed)
  blockedBy: z.array(BlockRefSchema).optional(),      // primitive: nodes that gate this one
  blocks: z.array(BlockRefSchema).optional(),         // primitive: nodes this one gates
}).strict();

// primitives the default SDLC implements (issue-level)
export const DefaultRelationSchema = z.object({
  type: z.enum(['blocks', 'blocked-by', 'relates']),
  issueId: z.string().min(1),
}).strict();
export const DefaultLinkedIssueSchema = z.object({
  system: z.string().min(1),
  key: z.string().min(1),
  url: z.string().min(1).optional(),
}).strict();

export const DefaultIssueStatusSchema = z.enum(['draft', 'ready', 'in-progress', 'in-review', 'done']);
export const DefaultIssueSchema = z.object({
  id: z.string().min(1),                              // core
  title: z.string().min(1),                           // core
  summary: z.string(),                                // core
  status: DefaultIssueStatusSchema,                    // core (narrowed)
  assignee: z.string(),                               // preset (rule enforces non-empty)
  pr: z.object({ url: z.string().min(1) }).strict().optional(), // preset
  acceptanceCriteria: z.array(DefaultAcSchema),       // core
  labels: z.array(z.string().min(1)).optional(),               // primitive
  relations: z.array(DefaultRelationSchema).optional(),         // primitive
  linkedIssues: z.array(DefaultLinkedIssueSchema).optional(),   // primitive
  children: z.array(z.string().min(1)).optional(),             // primitive
}).strict();

export const DefaultRootSchema = z.object({ issues: z.array(DefaultIssueSchema) }).strict();
export type DefaultRoot = z.infer<typeof DefaultRootSchema>;

// ── mdast parse: markdown -> the schema shape (designated-position, no mining) ─
type MdNode = { type: string; depth?: number; checked?: boolean | null; children?: MdNode[]; value?: string };

function nodeText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(nodeText).join('');
}
function firstParagraphText(item: MdNode): string {
  const p = (item.children ?? []).find((c) => c.type === 'paragraph');
  // Take the AC's first line only: the single-line `parseAcLine` regexes can't span a
  // soft-wrapped continuation line, which would otherwise swallow the whole wrapped
  // text into the id and lose the version (matches spec.ts behavior).
  return p ? (nodeText(p).trim().split('\n')[0] ?? '') : '';
}
function splitIdTitle(headingText: string): { id: string; title: string } {
  const m = /^(\S+):\s*(.+)$/.exec(headingText.trim());
  return m ? { id: m[1]!, title: m[2]!.trim() } : { id: headingText.trim(), title: headingText.trim() };
}
function splitList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

// the AC line: "<id> v<version> <text>"  (version optional -> schema flags absence)
function parseAcLine(line: string): { id: string; version?: number; text: string } {
  const withV = /^(\S+)\s+v(\d+)\s+(.+)$/.exec(line);
  if (withV) return { id: withV[1]!, version: Number(withV[2]), text: withV[3]!.trim() };
  const noV = /^(\S+)\s+(.+)$/.exec(line);
  return noV ? { id: noV[1]!, text: noV[2]!.trim() } : { id: line, text: line };
}

function parseDefaultIssue(markdown: string): Record<string, unknown> | null {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as MdNode;
  const issue: Record<string, unknown> = { id: '', title: '', summary: '', status: 'draft', assignee: '', acceptanceCriteria: [] };
  let inAc = false;

  for (const node of tree.children ?? []) {
    if (node.type === 'heading' && node.depth === 1) {
      // first H1 is the issue id/title; a later H1 in the body is just content
      if (!issue.id) { const { id, title } = splitIdTitle(nodeText(node)); issue.id = id; issue.title = title; }
      inAc = false;
      continue;
    }
    if (node.type === 'heading') { inAc = /acceptance criteria/i.test(nodeText(node)); continue; }
    if (node.type === 'paragraph') {
      const text = nodeText(node);
      const status = /^Status:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (status) issue.status = status;
      const summary = /^Summary:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (summary) issue.summary = summary;
      const assignee = /^Assignee:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (assignee) issue.assignee = assignee;
      const pr = /^PR:\s*(\S+)/im.exec(text)?.[1]?.trim();
      if (pr) issue.pr = { url: pr };
      // ── optional primitives (designated lines) ──
      const labels = /^Labels:\s*(.+)$/im.exec(text)?.[1];
      if (labels) issue.labels = splitList(labels);
      const children = /^Children:\s*(.+)$/im.exec(text)?.[1];
      if (children) issue.children = splitList(children);
      const relations: unknown[] = [];
      for (const m of text.matchAll(/^Blocks:\s*(.+)$/gim)) for (const id of splitList(m[1]!)) relations.push({ type: 'blocks', issueId: id });
      for (const m of text.matchAll(/^Blocked by:\s*(.+)$/gim)) for (const id of splitList(m[1]!)) relations.push({ type: 'blocked-by', issueId: id });
      for (const m of text.matchAll(/^Relates:\s*(.+)$/gim)) for (const id of splitList(m[1]!)) relations.push({ type: 'relates', issueId: id });
      if (relations.length) issue.relations = relations;
      const linked: unknown[] = [];
      for (const m of text.matchAll(/^Linked:\s*(\S+)\s+(\S+)(?:\s+(\S+))?/gim)) linked.push({ system: m[1], key: m[2], ...(m[3] ? { url: m[3] } : {}) });
      if (linked.length) issue.linkedIssues = linked;
      continue;
    }
    if (node.type === 'list' && inAc) {
      const acs: unknown[] = [];
      for (const item of node.children ?? []) {
        if (item.type !== 'listItem') continue;
        const { id, version, text } = parseAcLine(firstParagraphText(item));
        const checked = item.checked === true;
        let status: string | undefined;
        let proof: unknown;
        const evidence: unknown[] = [];
        const blockedBy: RawBlockRef[] = [];
        const blocks: RawBlockRef[] = [];
        const rawList = (raw: string): RawBlockRef[] =>
          splitList(raw).map((t) => parseBlockToken(t, issue.id as string)).filter((r): r is RawBlockRef => r !== null);
        const nested = (item.children ?? []).find((c) => c.type === 'list');
        for (const sub of nested?.children ?? []) {
          const line = firstParagraphText(sub);
          const st = /^status:\s*([\w-]+)/i.exec(line)?.[1];
          if (st) { status = st.toLowerCase(); continue; }
          const ev = /^evidence\s+(\S+):\s*image=(\S+)\s+commit=([0-9a-fA-F]+)\s+acv=(\d+)/i.exec(line);
          if (ev) { evidence.push({ id: ev[1], image: ev[2], commit: ev[3]!.toLowerCase(), acVersion: Number(ev[4]) }); continue; }
          // proof: "<explanation>" -> ev1, ev2
          const pf = /^proof:\s*(.+?)\s*->\s*(.+)$/i.exec(line);
          if (pf) { proof = { explanation: pf[1]!.trim().replace(/^"|"$/g, ''), evidenceRefs: splitList(pf[2]!) }; continue; }
          // blocking: bare id (this issue's AC, or an issue) or `issue:ac`, comma-listed
          const bb = /^blocked-by:\s*(.+)$/i.exec(line);
          if (bb) { blockedBy.push(...rawList(bb[1]!)); continue; }
          const bk = /^blocks:\s*(.+)$/i.exec(line);
          if (bk) { blocks.push(...rawList(bk[1]!)); continue; }
        }
        // status defaults from the checkbox; an explicit line can override (and is then guarded by a rule)
        if (!status) status = checked ? 'passed' : 'pending';
        const ac: Record<string, unknown> = { id, status, checked, text, evidence };
        if (version !== undefined) ac.version = version;
        if (proof !== undefined) ac.proof = proof;
        if (blockedBy.length) ac.blockedBy = blockedBy;
        if (blocks.length) ac.blocks = blocks;
        acs.push(ac);
      }
      issue.acceptanceCriteria = acs;
    }
  }
  return issue.id ? issue : null;
}

// The multi-issue root: the loader frames every tracker issue into one bundle;
// a single-issue document (no envelope) still parses to a one-issue root.
export function parseDefault(markdown: string): unknown {
  const issues = splitIssueBundle(markdown).map((s) => parseDefaultIssue(s.body)).filter((i): i is Record<string, unknown> => i !== null);
  normalizeBlockRefs(issues as unknown as Parameters<typeof normalizeBlockRefs>[0]); // classify bare refs now the whole tracker is known
  return { issues };
}

// ── serialize: the schema shape -> canonical markdown (inverse of parse) ─────
// Mutations parse -> change the object -> serialize -> write, so the file always
// conforms to the template the parser reads. One issue per file.
export function serializeIssue(issue: DefaultRoot['issues'][number]): string {
  const out: string[] = [`# ${issue.id}: ${issue.title}`, ''];
  if (issue.assignee) out.push(`Assignee: ${issue.assignee}`);
  if (issue.summary) out.push(`Summary: ${issue.summary}`);
  out.push(`Status: ${issue.status}`);
  if (issue.pr) out.push(`PR: ${issue.pr.url}`);
  if (issue.labels?.length) out.push(`Labels: ${issue.labels.join(', ')}`);
  if (issue.children?.length) out.push(`Children: ${issue.children.join(', ')}`);
  const rel = (t: string) => (issue.relations ?? []).filter((r) => r.type === t).map((r) => r.issueId);
  if (rel('blocks').length) out.push(`Blocks: ${rel('blocks').join(', ')}`);
  if (rel('blocked-by').length) out.push(`Blocked by: ${rel('blocked-by').join(', ')}`);
  if (rel('relates').length) out.push(`Relates: ${rel('relates').join(', ')}`);
  for (const l of issue.linkedIssues ?? []) out.push(`Linked: ${l.system} ${l.key}${l.url ? ` ${l.url}` : ''}`);
  out.push('', '## Acceptance Criteria', '');
  for (const ac of issue.acceptanceCriteria) {
    out.push(`- [${ac.checked ? 'x' : ' '}] ${ac.id} v${ac.version} ${ac.text}`);
    out.push(`  - status: ${ac.status}`);
    for (const ev of ac.evidence) out.push(`  - evidence ${ev.id}: image=${ev.image} commit=${ev.commit} acv=${ev.acVersion}`);
    if (ac.proof) out.push(`  - proof: "${ac.proof.explanation}" -> ${ac.proof.evidenceRefs.join(', ')}`);
    // render refs relatively (bare) when they target this issue's own AC, absolutely
    // otherwise; an issue-level ref (no `ac`) is just the issue id.
    const renderRef = (r: BlockRef) => (r.ac !== undefined && r.issue === issue.id ? r.ac : formatRef(r));
    if (ac.blockedBy?.length) out.push(`  - blocked-by: ${ac.blockedBy.map(renderRef).join(', ')}`);
    if (ac.blocks?.length) out.push(`  - blocks: ${ac.blocks.map(renderRef).join(', ')}`);
  }
  return out.join('\n') + '\n';
}
export function serializeDefault(root: DefaultRoot): string {
  return root.issues.map(serializeIssue).join('\n');
}

// ── rules: declarative records over the engine's derived model ───────────────
// Each rule SELECTS a list off the analyzed model — a per-item scope (issues / acs /
// evidence), a universal aggregate (duplicate ids), an engine-derived graph fact, or
// one of THIS preset's own derived facts — and DESCRIBES each match. The block-graph
// algorithms and id aggregates are computed once by the engine; this preset adds only
// relation reciprocity and dangling proof references (see deriveDefault).
const STATE_RANK: Record<DefaultRoot['issues'][number]['status'], number> = {
  draft: 0, ready: 1, 'in-progress': 2, 'in-review': 3, done: 4,
};

type Issue = DefaultRoot['issues'][number];
type AC = Issue['acceptanceCriteria'][number];
type Evidence = AC['evidence'][number];

// shas may be short (7+) or full (40); a match is either being a prefix of the other
const shaMatches = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

interface RelationProblem { issueId: string; kind: 'missing' | 'reciprocal'; relType: string; target: string }
interface ProofRefProblem { issueId: string; acId: string; ref: string }

// This preset's OWN analyzed facts. Everything universal — duplicate ids, the unified
// block graph (cycles, blocker problems, completion violations) — already arrives on the
// core model; only cross-issue relation reciprocity and dangling proof references are
// default-specific, so they are derived here.
function deriveDefault(model: DerivedModel<DefaultRoot>): { relationProblems: RelationProblem[]; proofRefProblems: ProofRefProblem[] } {
  const ids = new Set(model.root.issues.map((i) => i.id));
  const has = (id: string, type: string, target: string) =>
    (model.root.issues.find((i) => i.id === id)?.relations ?? []).some((r) => r.type === type && r.issueId === target);
  const relationProblems: RelationProblem[] = [];
  for (const i of model.root.issues) {
    for (const r of i.relations ?? []) {
      if (!ids.has(r.issueId)) { relationProblems.push({ issueId: i.id, kind: 'missing', relType: r.type, target: r.issueId }); continue; }
      if (r.type === 'blocks' && !has(r.issueId, 'blocked-by', i.id)) relationProblems.push({ issueId: i.id, kind: 'reciprocal', relType: 'blocks', target: r.issueId });
      if (r.type === 'blocked-by' && !has(r.issueId, 'blocks', i.id)) relationProblems.push({ issueId: i.id, kind: 'reciprocal', relType: 'blocked-by', target: r.issueId });
    }
  }
  const proofRefProblems: ProofRefProblem[] = [];
  for (const issue of model.root.issues) {
    for (const ac of issue.acceptanceCriteria) {
      if (ac.status !== 'passed' || !ac.proof || ac.proof.explanation.trim() === '' || ac.proof.evidenceRefs.length === 0) continue;
      const evIds = new Set(ac.evidence.map((e) => e.id));
      for (const ref of ac.proof.evidenceRefs.filter((r) => !evIds.has(r))) proofRefProblems.push({ issueId: issue.id, acId: ac.id, ref });
    }
  }
  return { relationProblems, proofRefProblems };
}
// Typed view of this preset's derived facts — the one place the engine's open
// `derived` bag is narrowed to what deriveDefault produced; selects stay cast-free.
type DefaultFacts = { relationProblems: RelationProblem[]; proofRefProblems: ProofRefProblem[] };
const facts = (m: DerivedModel<DefaultRoot>): DefaultFacts => m.derived as unknown as DefaultFacts;

const DEFAULT_RULES = [
  // wellformedness over single items + universal id aggregates
  rule<DefaultRoot, { issueId: string; issue: Issue }>({
    code: 'issue_missing_assignee', select: (m) => m.issues,
    when: ({ issue }) => issue.assignee.trim() === '',
    message: ({ issue }) => `Issue ${issue.id} has no assignee.`,
  }),
  rule<DefaultRoot, { issueId: string; acId: string; ac: AC }>({
    code: 'ac_checkbox_status_mismatch', select: (m) => m.acs,
    when: ({ ac }) => (ac.checked && ac.status !== 'passed') || (!ac.checked && ac.status === 'passed'),
    message: ({ ac }) => `AC ${ac.id} checkbox (${ac.checked ? '[x]' : '[ ]'}) disagrees with status "${ac.status}".`,
  }),
  rule<DefaultRoot, { issueId: string; acId: string }>({
    code: 'duplicate_ac_id', select: (m) => m.duplicateAcIds,
    message: ({ acId }) => `Duplicate AC id ${acId}.`,
  }),
  rule<DefaultRoot, { issueId: string }>({
    code: 'duplicate_issue_id', select: (m) => m.duplicateIssueIds,
    message: ({ issueId }) => `Duplicate issue id ${issueId}.`,
  }),

  // evidence + proof
  rule<DefaultRoot, { issueId: string; acId: string; ac: AC }>({
    code: 'passed_ac_missing_evidence', select: (m) => m.acs,
    when: ({ ac }) => ac.status === 'passed' && ac.evidence.length === 0,
    message: ({ ac }) => `AC ${ac.id} is passed but has no image evidence.`,
  }),
  rule<DefaultRoot, { issueId: string; acId: string; ac: AC }>({
    code: 'passed_ac_missing_proof', select: (m) => m.acs,
    when: ({ ac }) => ac.status === 'passed' && (!ac.proof || ac.proof.explanation.trim() === ''),
    message: ({ ac }) => `AC ${ac.id} is passed but has no proof explaining how its evidence demonstrates it.`,
  }),
  rule<DefaultRoot, { issueId: string; acId: string; ac: AC }>({
    code: 'proof_cites_no_evidence', select: (m) => m.acs,
    when: ({ ac }) => ac.status === 'passed' && !!ac.proof && ac.proof.explanation.trim() !== '' && ac.proof.evidenceRefs.length === 0,
    message: ({ ac }) => `AC ${ac.id} proof cites no evidence.`,
  }),
  rule<DefaultRoot, ProofRefProblem>({
    code: 'proof_evidence_ref_missing', select: (m) => facts(m).proofRefProblems,
    message: ({ acId, ref }) => `AC ${acId} proof references evidence "${ref}", which does not exist on the AC.`,
  }),
  rule<DefaultRoot, { issueId: string; acId: string; evidenceId: string; ev: Evidence }>({
    code: 'evidence_commit_not_found', select: (m) => m.evidence,
    when: ({ ev }, m) => { const c = m.context.git?.existingCommits; return !!c && !c.some((x) => shaMatches(x, ev.commit)); },
    message: ({ ev }) => `Evidence ${ev.id} cites commit ${ev.commit}, which does not exist.`,
  }),
  rule<DefaultRoot, { issueId: string; issue: Issue }>({
    code: 'current_head_unknown', select: (m) => m.issues,
    when: ({ issue }, m) => {
      const evCount = issue.acceptanceCriteria.reduce((n, ac) => n + ac.evidence.length, 0);
      return evCount > 0 && !!issue.pr && !m.context.git?.prs?.[issue.pr.url]?.headSha;
    },
    message: ({ issue }) => `Issue ${issue.id} has evidence but the PR head sha is unknown.`,
  }),
  rule<DefaultRoot, { issueId: string; acId: string; evidenceId: string; issue: Issue; ev: Evidence }>({
    code: 'evidence_sha_stale', select: (m) => m.evidence,
    when: ({ issue, ev }, m) => { const h = issue.pr && m.context.git?.prs?.[issue.pr.url]?.headSha; return !!h && !shaMatches(ev.commit, h); },
    message: ({ issue, ev }, m) => `Evidence ${ev.id} was captured at ${ev.commit}, not the current head ${m.context.git!.prs![issue.pr!.url]!.headSha}.`,
  }),
  rule<DefaultRoot, { issueId: string; acId: string; evidenceId: string; ac: AC; ev: Evidence }>({
    code: 'evidence_ac_version_stale', select: (m) => m.evidence,
    when: ({ ac, ev }) => ev.acVersion !== ac.version,
    message: ({ ac, ev }) => `Evidence ${ev.id} is for AC ${ac.id} v${ev.acVersion}, but the AC is now v${ac.version}.`,
  }),

  // lifecycle gates — the omnibus state_gates rule, decomposed into named records
  rule<DefaultRoot, { issueId: string; issue: Issue }>({
    code: 'ready_requires_dev_ac', select: (m) => m.issues,
    when: ({ issue }) => STATE_RANK[issue.status] >= STATE_RANK.ready && issue.acceptanceCriteria.length === 0,
    message: ({ issue }) => `Issue ${issue.id} is "${issue.status}" but has no dev ACs.`,
  }),
  rule<DefaultRoot, { issueId: string; issue: Issue }>({
    code: 'review_requires_pr', select: (m) => m.issues,
    when: ({ issue }) => STATE_RANK[issue.status] >= STATE_RANK['in-review'] && !issue.pr,
    message: ({ issue }) => `Issue ${issue.id} is "${issue.status}" but has no PR.`,
  }),
  rule<DefaultRoot, { issueId: string; issue: Issue }>({
    code: 'review_requires_all_acs_passed', select: (m) => m.issues,
    when: ({ issue }) => STATE_RANK[issue.status] >= STATE_RANK['in-review'] && issue.acceptanceCriteria.some((ac) => ac.status !== 'passed'),
    message: ({ issue }) => `Issue ${issue.id} is "${issue.status}" but not all ACs are passed.`,
  }),
  rule<DefaultRoot, { issueId: string; issue: Issue }>({
    code: 'done_requires_merged_pr', select: (m) => m.issues,
    when: ({ issue }, m) => issue.status === 'done' && !!issue.pr && m.context.git?.prs?.[issue.pr.url]?.merged !== true,
    message: ({ issue }) => `Issue ${issue.id} is done but its PR is not merged.`,
  }),

  // relations (cross-issue, derived by this preset) — select the source, filter with when
  rule<DefaultRoot, RelationProblem>({
    code: 'relation_target_missing', select: (m) => facts(m).relationProblems, when: (p) => p.kind === 'missing',
    message: ({ issueId, relType, target }) => `Issue ${issueId} ${relType} ${target}, which does not exist.`,
  }),
  rule<DefaultRoot, RelationProblem>({
    code: 'relation_not_reciprocal', severity: 'warning', select: (m) => facts(m).relationProblems, when: (p) => p.kind === 'reciprocal',
    message: ({ issueId, relType, target }) => relType === 'blocks'
      ? `Issue ${issueId} blocks ${target} but ${target} does not list "Blocked by: ${issueId}".`
      : `Issue ${issueId} is blocked by ${target} but ${target} does not list "Blocks: ${issueId}".`,
  }),

  // blocking graph — analyzed once by the engine, declared here over its fact types
  rule<DefaultRoot, BlockerFact>({
    code: 'ac_self_block', select: (m) => m.graph.blockerProblems, when: (b) => b.kind === 'self',
    message: (b) => `AC ${formatRef({ issue: b.issueId, ac: b.acId })} lists itself as a blocker.`,
  }),
  rule<DefaultRoot, BlockerFact>({
    code: 'ac_blocker_missing', select: (m) => m.graph.blockerProblems, when: (b) => b.kind !== 'self',
    message: (b) => `AC ${formatRef({ issue: b.issueId, ac: b.acId })} references ${b.refText}, which does not exist.`,
  }),
  rule<DefaultRoot, CycleFact>({
    code: 'ac_block_cycle', select: (m) => m.graph.cycles,
    message: ({ cycle }) => `Blocking cycle: ${cycle.join(' → ')} → ${cycle[0]} can never be satisfied.`,
  }),
  rule<DefaultRoot, CompletionFact>({
    code: 'ac_blocked_by_unpassed', select: (m) => m.graph.completionViolations,
    message: ({ nodeKey, depKey, depStatus }) => `${nodeKey} is done but depends on ${depKey} (status "${depStatus}").`,
  }),
];

// The default SDLC's PR branches: each issue's `PR:` value (a local branch name).
// Used by this preset's loadContext to ask the git world for branch heads.
export function prBranchesFrom(markdown: string): string[] {
  const parsed = DefaultRootSchema.safeParse(parseDefault(markdown));
  return parsed.success ? parsed.data.issues.map((i) => i.pr?.url).filter((u): u is string => !!u) : [];
}
function defaultPrBranches(input: PresetContextInput): string[] {
  if (input.root) return (input.root as unknown as DefaultRoot).issues.map((i) => i.pr?.url).filter((u): u is string => !!u);
  return input.bundle ? prBranchesFrom(input.bundle) : [];
}

export const DefaultPreset: Preset<DefaultRoot> = {
  name: 'default',
  schema: DefaultRootSchema,
  // this preset's observed facts: the git world (commits + PR head/merged).
  loadContext: (input) => gitWorld(input.projectRoot, defaultPrBranches(input), { verifyCommits: input.verifyCommits }),
  parse: parseDefault,
  // an AC-less issue counts as done (for the block graph's completion gate) only at the terminal state.
  isIssueDone: (i) => i.status === 'done',
  // relation reciprocity + dangling proof refs; the block graph + id aggregates are core.
  derive: deriveDefault,
  rules: DEFAULT_RULES,
  // which standard primitives this SDLC implements. (audit is NOT declared here:
  // it is a core, always-on capability — recorded automatically on any change.)
  primitives: {
    proof: true, labels: true, relations: true, linkedIssues: true, children: true,
    blocking: true, sources: false, category: false,
  },
};

export function checkDefault(markdown: string, ctx?: Context) {
  return runCheck(DefaultPreset, markdown, ctx);
}
