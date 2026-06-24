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

// A STANDALONE preset: imports ONLY the public mechanism from `ztrack/preset-kit`
// (no `../core/*`, no `mdast-*`, no `zod`). Its OWN schema, parser, and rules live here.
import {
  z, toMdast, nodeText, type MdNode,
  check as runCheck, rule, gitWorld, formatRef, BlockRefSchema,
  normalizeBlockRefs, parseBlockToken,
  type BlockerFact, type BlockRef, type CompletionFact, type Context, type CycleFact,
  type DerivedModel, type Finding, type IssueColumns, type IssueRecord, type Preset, type PresetContextInput, type RawBlockRef,
} from 'ztrack/preset-kit';

// ── the hard schema (core + preset-specific, all strict) ────────────────────
export const DefaultEvidenceSchema = z.object({
  id: z.string().min(1),                              // core
  image: z.string().regex(/^\S+$/, 'image must be a single whitespace-free token'), // serialized as image=<tok>, so no spaces
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
  children: z.array(z.string().min(1)).optional(),             // primitive
  // unknown `## X` body sections (not Acceptance Criteria / Waivers) are CARRIED verbatim so
  // a patch/fmt round-trip never silently drops human-authored prose. (This preset CHOOSES to
  // carry; another could reject.) Each entry is the raw `## …` section markdown.
  notes: z.array(z.string().min(1)).optional(),
}).strict();

export const DefaultRootSchema = z.object({ issues: z.array(DefaultIssueSchema) }).strict();
export type DefaultRoot = z.infer<typeof DefaultRootSchema>;

// ── mdast parse: markdown -> the schema shape (designated-position, no mining) ─
// MdNode / toMdast / nodeText are rented from the kit (shared mdast mechanism).
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

// Carve out unknown top-level `## X` sections (anything but Acceptance Criteria / the core
// Waivers section) so the known structure parses normally and the rest round-trips verbatim.
function splitNotes(body: string): { known: string; notes: string[] } {
  const known: string[] = [];
  const notes: string[] = [];
  let cur: string[] | null = null;
  for (const line of body.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      if (cur) { notes.push(cur.join('\n').trim()); cur = null; }
      const name = h[1]!.toLowerCase();
      if (/^acceptance criteria/.test(name) || /^waivers\b/.test(name)) { known.push(line); continue; }
      cur = [line]; // start carrying an unknown section
      continue;
    }
    if (cur) cur.push(line); else known.push(line);
  }
  if (cur) notes.push(cur.join('\n').trim());
  return { known: known.join('\n'), notes: notes.filter(Boolean) };
}

function parseDefaultIssue(record: IssueRecord): Record<string, unknown> {
  // Metadata comes STRUCTURED from the record's columns; only the content (summary, pr,
  // relations, ACs) is parsed out of the body markdown. id/title/status/assignee/labels are
  // never re-derived from synthesized markdown. Unknown `## X` sections are carried verbatim.
  const issue: Record<string, unknown> = {
    id: record.id, title: record.title, status: record.status || 'draft',
    assignee: record.assignee ?? '', summary: '', acceptanceCriteria: [],
    ...(record.labels?.length ? { labels: record.labels } : {}),
  };
  const { known, notes } = splitNotes(record.body);
  if (notes.length) issue.notes = notes;
  const tree = toMdast(known);
  let inAc = false;

  for (const node of tree.children ?? []) {
    if (node.type === 'heading') { inAc = /acceptance criteria/i.test(nodeText(node)); continue; }
    if (node.type === 'paragraph') {
      const text = nodeText(node);
      const summary = /^Summary:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (summary) issue.summary = summary;
      const pr = /^PR:\s*(\S+)/im.exec(text)?.[1]?.trim();
      if (pr) issue.pr = { url: pr };
      const children = /^Children:\s*(.+)$/im.exec(text)?.[1];
      if (children) issue.children = splitList(children);
      const relations: unknown[] = [];
      for (const m of text.matchAll(/^Blocks:\s*(.+)$/gim)) for (const id of splitList(m[1]!)) relations.push({ type: 'blocks', issueId: id });
      for (const m of text.matchAll(/^Blocked by:\s*(.+)$/gim)) for (const id of splitList(m[1]!)) relations.push({ type: 'blocked-by', issueId: id });
      for (const m of text.matchAll(/^Relates:\s*(.+)$/gim)) for (const id of splitList(m[1]!)) relations.push({ type: 'relates', issueId: id });
      if (relations.length) issue.relations = relations;
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
          // proof: "<explanation>" -> ev1, ev2 — match the QUOTED explanation greedily so a
          // '->' (or a quote) inside the explanation survives; fall back to an unquoted form.
          const pf = /^proof:\s*"(.*)"\s*->\s*(.+)$/i.exec(line) ?? /^proof:\s*(.+?)\s*->\s*(.+)$/i.exec(line);
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
  return issue;
}

// The root: each issue's metadata is structured (its record's columns); content is parsed
// from its body. Takes all records so bare blocking refs are classified once the whole
// tracker is known.
export function parseDefault(records: IssueRecord[]): unknown {
  const issues = records.map(parseDefaultIssue);
  normalizeBlockRefs(issues as unknown as Parameters<typeof normalizeBlockRefs>[0]);
  return { issues };
}

// ── serialize: the validated issue -> its STORED form (inverse of parse) ─────
// The metadata (id/title/status/assignee/labels) goes to the backend `columns`; only the
// content (summary, pr, relations, children, ACs) is rendered into the `body`. Mutations
// parse -> change the object -> serialize -> write {body, columns}, so the body never carries
// a duplicate copy of the metadata (no split-brain) and the columns stay authoritative.
export function serializeIssue(issue: DefaultRoot['issues'][number]): { body: string; columns: IssueColumns } {
  const out: string[] = [];
  if (issue.summary) out.push(`Summary: ${issue.summary}`);
  if (issue.pr) out.push(`PR: ${issue.pr.url}`);
  if (issue.children?.length) out.push(`Children: ${issue.children.join(', ')}`);
  const rel = (t: string) => (issue.relations ?? []).filter((r) => r.type === t).map((r) => r.issueId);
  if (rel('blocks').length) out.push(`Blocks: ${rel('blocks').join(', ')}`);
  if (rel('blocked-by').length) out.push(`Blocked by: ${rel('blocked-by').join(', ')}`);
  if (rel('relates').length) out.push(`Relates: ${rel('relates').join(', ')}`);
  if (out.length) out.push('');
  out.push('## Acceptance Criteria', '');
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
  for (const note of issue.notes ?? []) out.push('', note);
  const columns: IssueColumns = {
    title: issue.title, status: issue.status,
    ...(issue.assignee ? { assignee: issue.assignee } : {}),
    ...(issue.labels ? { labels: issue.labels } : {}),
  };
  return { body: out.join('\n') + '\n', columns };
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
  // PR is body content, so the loader's content bundle carries every `PR:` line — scan it
  // directly (no full parse, which now needs structured records).
  return [...markdown.matchAll(/^PR:\s*(\S+)/gim)].map((m) => m[1]!).filter(Boolean);
}
function defaultPrBranches(input: PresetContextInput): string[] {
  if (input.root) return (input.root as unknown as DefaultRoot).issues.map((i) => i.pr?.url).filter((u): u is string => !!u);
  return input.bundle ? prBranchesFrom(input.bundle) : [];
}

// Per-finding REMEDIATION: the exact action that turns this finding green. The agent fills the
// real values (the sha it just committed, the image path); the hint supplies the command + the
// schema shape, and points at `ztrack ac --help` / `ztrack issue view` for the full grammar.
function defaultFixHint(f: Finding): string | undefined {
  const issue = f.issueId ?? '<issue>';
  const ac = f.acId ?? '<acId>';
  const acPatch = (shape: string, note = '') => `Fix: ztrack ac patch ${issue} ${ac} --json '${shape}'${note}  (\`ztrack ac --help\` / \`ztrack issue view ${issue}\` for the AC schema)`;
  switch (f.code) {
    case 'passed_ac_missing_evidence':
      return acPatch('{"evidence":[{"id":"ev1","image":"<path>","commit":"<sha>","acVersion":1}]}');
    case 'passed_ac_missing_proof':
    case 'proof_cites_no_evidence':
    case 'proof_evidence_ref_missing':
      return acPatch('{"proof":{"explanation":"how the evidence shows this AC is met","evidenceRefs":["ev1"]}}');
    case 'evidence_commit_not_found':
    case 'evidence_sha_stale':
    case 'evidence_ac_version_stale':
      return acPatch('{"evidence":[{"id":"ev1","image":"<path>","commit":"<real-sha>","acVersion":1}]}', ' — cite a commit that exists in git (and the AC version)');
    case 'ac_checkbox_status_mismatch':
      return acPatch('{"checked":true,"status":"passed"}', ' — make the [x] checkbox and status agree (or {"checked":false,"status":"pending"})');
    case 'issue_missing_assignee':
      return `Fix: ztrack issue edit ${issue} --assignee <you>  (assignee is an issue column)`;
    case 'ready_requires_dev_ac':
      return `Fix: give ${issue} at least one acceptance criterion (a \`## Acceptance Criteria\` item), or move it back to draft`;
    case 'review_requires_pr':
      return `Fix: add a \`PR: <url>\` line to ${issue} before in-review`;
    case 'review_requires_all_acs_passed':
      return `Fix: every AC of ${issue} must be passed-with-evidence (ztrack ac patch …) before in-review`;
    case 'done_requires_merged_pr':
      return `Fix: ${issue} can move to done only once its PR is merged`;
    default:
      return undefined; // fall through to the core universal floor (inspect + waiver escape)
  }
}

export const DefaultPreset: Preset<DefaultRoot> = {
  name: 'default',
  fixHint: defaultFixHint,
  schema: DefaultRootSchema,
  // this preset's observed facts: the git world (commits + PR head/merged).
  loadContext: (input) => gitWorld(input.projectRoot, defaultPrBranches(input), { verifyCommits: input.verifyCommits }),
  parse: parseDefault,
  serialize: serializeIssue, // issue -> { body, columns }; the inverse of parse
  // an AC-less issue counts as done (for the block graph's completion gate) only at the terminal state.
  isIssueDone: (i) => i.status === 'done',
  // relation reciprocity + dangling proof refs; the block graph + id aggregates are core.
  derive: deriveDefault,
  rules: DEFAULT_RULES,
  // `ztrack issue scaffold` starter: a draft issue with one pending dev AC (green to begin —
  // nothing is claimed yet). Fill in the work, then mark it passed + cite evidence + proof.
  scaffold: (_title) => `Summary: One or two sentences describing the work.\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 Describe one observable, testable outcome.\n  - status: pending\n\n<!-- To mark an AC done: check the [x] box, set status: passed, and cite real proof —\n  - [x] dev/01 v1 …\n    - status: passed\n    - evidence ev1: image=<screenshot-or-artifact> commit=<real-git-sha> acv=1\n    - proof: "how the evidence shows this AC is met" -> ev1\nThe commit must EXIST in git (verified by default). \`ztrack ac patch <issue> dev/01 --json …\` writes this for you; \`ztrack ac --help\` shows the schema. -->\n`,
  // which standard primitives this SDLC implements. (audit is NOT declared here:
  // it is a core, always-on capability — recorded automatically on any change.)
  primitives: {
    proof: true, labels: true, relations: true, children: true,
    blocking: true, sources: false, category: false,
  },
};

export function checkDefault(records: IssueRecord[], ctx?: Context) {
  return runCheck(DefaultPreset, records, ctx);
}

// The installed entrypoint: the resolver reads the preset off `default`.
export default DefaultPreset;
