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
import { check as runCheck, type BlockRef, type Context, type Finding, type Preset, type PresetContextInput, type Rule } from '../core/engine.ts';
import { splitIssueBundle } from '../core/bundle.ts';
import { gitWorld } from '../core/gitWorld.ts';
import { BlockRefSchema, formatRef } from '../core/ref.ts';
import { blockCycles, blockerRefProblems, completionViolations, nodeIndex, normalizeBlockRefs, parseBlockToken, type RawBlockRef } from '../core/blocking.ts';

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

// ── rules: pure, over the typed root + git-world context ─────────────────────
const STATE_RANK: Record<DefaultRoot['issues'][number]['status'], number> = {
  draft: 0, ready: 1, 'in-progress': 2, 'in-review': 3, done: 4,
};

const issueMustBeAssigned: Rule<DefaultRoot> = {
  name: 'issue_must_be_assigned',
  run: ({ root }) => root.issues.filter((i) => i.assignee.trim() === '').map((i): Finding => ({
    code: 'issue_missing_assignee', severity: 'error', message: `Issue ${i.id} has no assignee.`, issueId: i.id,
  })),
};

const acCheckboxMatchesStatus: Rule<DefaultRoot> = {
  name: 'ac_checkbox_matches_status',
  run: ({ root }) => root.issues.flatMap((i) => i.acceptanceCriteria
    .filter((ac) => (ac.checked && ac.status !== 'passed') || (!ac.checked && ac.status === 'passed'))
    .map((ac): Finding => ({
      code: 'ac_checkbox_status_mismatch', severity: 'error',
      message: `AC ${ac.id} checkbox (${ac.checked ? '[x]' : '[ ]'}) disagrees with status "${ac.status}".`,
      issueId: i.id, acId: ac.id,
    }))),
};

const uniqueAcIds: Rule<DefaultRoot> = {
  name: 'unique_ac_ids',
  run: ({ root }) => root.issues.flatMap((i) => {
    const seen = new Set<string>(); const dups: Finding[] = [];
    for (const ac of i.acceptanceCriteria) {
      if (seen.has(ac.id)) dups.push({ code: 'duplicate_ac_id', severity: 'error', message: `Duplicate AC id ${ac.id}.`, issueId: i.id, acId: ac.id });
      seen.add(ac.id);
    }
    return dups;
  }),
};

const passedAcNeedsEvidence: Rule<DefaultRoot> = {
  name: 'passed_ac_needs_evidence',
  run: ({ root }) => root.issues.flatMap((i) => i.acceptanceCriteria
    .filter((ac) => ac.status === 'passed' && ac.evidence.length === 0)
    .map((ac): Finding => ({
      code: 'passed_ac_missing_evidence', severity: 'error',
      message: `AC ${ac.id} is passed but has no image evidence.`, issueId: i.id, acId: ac.id,
    }))),
};

// evidence without proof + explanation is incomplete: a passed AC must explain
// how its evidence demonstrates the criterion, and the proof must cite real evidence.
const passedAcNeedsProof: Rule<DefaultRoot> = {
  name: 'passed_ac_needs_proof',
  run: ({ root }) => root.issues.flatMap((i) => i.acceptanceCriteria.flatMap((ac): Finding[] => {
    if (ac.status !== 'passed') return [];
    if (!ac.proof || ac.proof.explanation.trim() === '') {
      return [{ code: 'passed_ac_missing_proof', severity: 'error', message: `AC ${ac.id} is passed but has no proof explaining how its evidence demonstrates it.`, issueId: i.id, acId: ac.id }];
    }
    const evIds = new Set(ac.evidence.map((e) => e.id));
    const dangling = ac.proof.evidenceRefs.filter((r) => !evIds.has(r));
    if (ac.proof.evidenceRefs.length === 0) {
      return [{ code: 'proof_cites_no_evidence', severity: 'error', message: `AC ${ac.id} proof cites no evidence.`, issueId: i.id, acId: ac.id }];
    }
    return dangling.map((r): Finding => ({ code: 'proof_evidence_ref_missing', severity: 'error', message: `AC ${ac.id} proof references evidence "${r}", which does not exist on the AC.`, issueId: i.id, acId: ac.id }));
  })),
};

// shas may be short (7+) or full (40); a match is either being a prefix of the other
const shaMatches = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

const evidenceCommitExists: Rule<DefaultRoot> = {
  name: 'evidence_commit_exists',
  run: ({ root, context: ctx }) => {
    const commits = ctx.git?.existingCommits;
    if (!commits) return []; // git world unavailable -> cannot verify
    return root.issues.flatMap((i) => i.acceptanceCriteria.flatMap((ac) => ac.evidence
      .filter((ev) => !commits.some((c) => shaMatches(c, ev.commit)))
      .map((ev): Finding => ({
        code: 'evidence_commit_not_found', severity: 'error',
        message: `Evidence ${ev.id} cites commit ${ev.commit}, which does not exist.`, issueId: i.id, acId: ac.id, evidenceId: ev.id,
      }))));
  },
};

const evidenceShaFresh: Rule<DefaultRoot> = {
  name: 'evidence_sha_fresh',
  run: ({ root, context: ctx }) => root.issues.flatMap((i) => {
    const evCount = i.acceptanceCriteria.reduce((n, ac) => n + ac.evidence.length, 0);
    if (evCount === 0 || !i.pr) return [];
    const head = ctx.git?.prs?.[i.pr.url]?.headSha;
    if (!head) return [{ code: 'current_head_unknown', severity: 'error', message: `Issue ${i.id} has evidence but the PR head sha is unknown.`, issueId: i.id }];
    return i.acceptanceCriteria.flatMap((ac) => ac.evidence
      .filter((ev) => !shaMatches(ev.commit, head))
      .map((ev): Finding => ({
        code: 'evidence_sha_stale', severity: 'error',
        message: `Evidence ${ev.id} was captured at ${ev.commit}, not the current head ${head}.`, issueId: i.id, acId: ac.id, evidenceId: ev.id,
      })));
  }),
};

const evidenceAcVersionFresh: Rule<DefaultRoot> = {
  name: 'evidence_ac_version_fresh',
  run: ({ root }) => root.issues.flatMap((i) => i.acceptanceCriteria.flatMap((ac) => ac.evidence
    .filter((ev) => ev.acVersion !== ac.version)
    .map((ev): Finding => ({
      code: 'evidence_ac_version_stale', severity: 'error',
      message: `Evidence ${ev.id} is for AC ${ac.id} v${ev.acVersion}, but the AC is now v${ac.version}.`, issueId: i.id, acId: ac.id, evidenceId: ev.id,
    })))),
};

const stateGates: Rule<DefaultRoot> = {
  name: 'state_gates',
  run: ({ root, context: ctx }) => root.issues.flatMap((i) => {
    const out: Finding[] = [];
    const rank = STATE_RANK[i.status];
    if (rank >= STATE_RANK.ready && i.acceptanceCriteria.length === 0) {
      out.push({ code: 'ready_requires_dev_ac', severity: 'error', message: `Issue ${i.id} is "${i.status}" but has no dev ACs.`, issueId: i.id });
    }
    if (rank >= STATE_RANK['in-review']) {
      if (!i.pr) out.push({ code: 'review_requires_pr', severity: 'error', message: `Issue ${i.id} is "${i.status}" but has no PR.`, issueId: i.id });
      if (i.acceptanceCriteria.some((ac) => ac.status !== 'passed')) {
        out.push({ code: 'review_requires_all_acs_passed', severity: 'error', message: `Issue ${i.id} is "${i.status}" but not all ACs are passed.`, issueId: i.id });
      }
    }
    if (i.status === 'done' && i.pr && ctx.git?.prs?.[i.pr.url]?.merged !== true) {
      out.push({ code: 'done_requires_merged_pr', severity: 'error', message: `Issue ${i.id} is done but its PR is not merged.`, issueId: i.id });
    }
    return out;
  }),
};

// ── cross-issue rules (the root is the whole tracker) ───────────────────────
const uniqueIssueIds: Rule<DefaultRoot> = {
  name: 'unique_issue_ids',
  run: ({ root }) => {
    const seen = new Set<string>(); const dups: Finding[] = [];
    for (const i of root.issues) {
      if (seen.has(i.id)) dups.push({ code: 'duplicate_issue_id', severity: 'error', message: `Duplicate issue id ${i.id}.`, issueId: i.id });
      seen.add(i.id);
    }
    return dups;
  },
};

// relations must point at issues that exist, and `blocks`/`blocked-by` must be
// reciprocal across the tracker (a consistency check only expressible cross-issue).
const relationsConsistent: Rule<DefaultRoot> = {
  name: 'relations_consistent',
  run: ({ root }) => {
    const ids = new Set(root.issues.map((i) => i.id));
    const out: Finding[] = [];
    const has = (id: string, type: string, target: string) =>
      (root.issues.find((i) => i.id === id)?.relations ?? []).some((r) => r.type === type && r.issueId === target);
    for (const i of root.issues) {
      for (const r of i.relations ?? []) {
        if (!ids.has(r.issueId)) {
          out.push({ code: 'relation_target_missing', severity: 'error', message: `Issue ${i.id} ${r.type} ${r.issueId}, which does not exist.`, issueId: i.id });
          continue;
        }
        if (r.type === 'blocks' && !has(r.issueId, 'blocked-by', i.id)) {
          out.push({ code: 'relation_not_reciprocal', severity: 'warning', message: `Issue ${i.id} blocks ${r.issueId} but ${r.issueId} does not list "Blocked by: ${i.id}".`, issueId: i.id });
        }
        if (r.type === 'blocked-by' && !has(r.issueId, 'blocks', i.id)) {
          out.push({ code: 'relation_not_reciprocal', severity: 'warning', message: `Issue ${i.id} is blocked by ${r.issueId} but ${r.issueId} does not list "Blocks: ${i.id}".`, issueId: i.id });
        }
      }
    }
    return out;
  },
};

// Blocking integrity over the UNIFIED dependency graph (issues + ACs, both edge
// directions, and the issue-level `relations` blocks/blocked-by). A blocker must name a
// real node, can't be the AC itself; the graph must be acyclic; and a done node can't
// depend on an unfinished one.
const acBlockersResolve: Rule<DefaultRoot> = {
  name: 'ac_blockers_resolve',
  run: ({ root }) => blockerRefProblems(root).map((p): Finding => ({
    code: p.kind === 'self' ? 'ac_self_block' : 'ac_blocker_missing', severity: 'error', issueId: p.issueId, acId: p.acId,
    message: p.kind === 'self'
      ? `AC ${formatRef({ issue: p.issueId, ac: p.acId })} lists itself as a blocker.`
      : `AC ${formatRef({ issue: p.issueId, ac: p.acId })} references ${formatRef(p.ref)}, which does not exist.`,
  })),
};

const acBlockNoCycle: Rule<DefaultRoot> = {
  name: 'ac_block_no_cycle',
  run: ({ root }) => blockCycles(root).map((cycle): Finding => {
    const head = nodeIndex(root).get(cycle[0]!)!;
    return { code: 'ac_block_cycle', severity: 'error', message: `Blocking cycle: ${cycle.join(' → ')} → ${cycle[0]} can never be satisfied.`, issueId: head.issue.id, ...(head.ac ? { acId: head.ac.id } : {}) };
  }),
};

const acNotBlockedByUnpassed: Rule<DefaultRoot> = {
  name: 'ac_not_blocked_by_unpassed',
  run: ({ root }) => completionViolations(root, { isIssueDone: (i) => i.status === 'done' }).map(({ node, dep }): Finding => ({
    code: 'ac_blocked_by_unpassed', severity: 'error', issueId: node.issue.id, ...(node.ac ? { acId: node.ac.id } : {}),
    message: `${node.key} is done but depends on ${dep.key} (status "${dep.kind === 'ac' ? dep.ac!.status : 'incomplete'}").`,
  })),
};

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
  rules: [
    issueMustBeAssigned,
    acCheckboxMatchesStatus,
    uniqueAcIds,
    uniqueIssueIds,
    relationsConsistent,
    acBlockersResolve,
    acBlockNoCycle,
    acNotBlockedByUnpassed,
    passedAcNeedsEvidence,
    passedAcNeedsProof,
    evidenceCommitExists,
    evidenceShaFresh,
    evidenceAcVersionFresh,
    stateGates,
  ],
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
