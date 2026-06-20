// preset-kit: createGenericPreset — the editable, configurable core Preset that
// `ztrack init` installs. It is a REAL core preset (one strict Zod schema, mdast
// parse, pure rules over the validated ValidationInput) — not a snapshot runtime.
//
// The repo-local `.volter/tracker/validation/preset.cjs` is just:
//   module.exports = require('ztrack/preset-kit').createGenericPreset({ ... });
// so a project keeps an editable entrypoint with zero build step while still
// running the single validation pipeline.

import { z } from 'zod';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { CoreIssue, Finding, Preset, Rule } from './core/engine.ts';
import { splitIssueBundle } from './core/bundle.ts';
import { gitWorld } from './core/gitWorld.ts';
import { BlockRefSchema, formatRef } from './core/ref.ts';
import { blockCycles, blockerRefProblems, completionViolations, nodeIndex, normalizeBlockRefs, parseBlockToken, type RawBlockRef } from './core/blocking.ts';

// Re-exported so a repo-local preset's `loadContext` can gather git facts without
// reaching into ztrack internals: require('ztrack/preset-kit').gitWorld(root, branches).
export { gitWorld } from './core/gitWorld.ts';

// World annotations are part of a preset's loadContext surface too (e.g. a
// loadContext that filters world events by annotation exemption), so expose the
// reader/writer API here alongside gitWorld rather than forcing internal imports.
export {
  listAnnotations,
  isAnnotationExemptEvent,
  addAnnotation,
  createAnnotation,
  validateWorldAnnotations,
  type WorldAnnotation,
} from './worldAnnotations.ts';

export interface GenericPresetConfig {
  name: string;
  requireSourceMarker?: boolean;
  requireSdlcGates?: boolean;
  requireSpecSections?: boolean;
  requireSpeckitSections?: boolean;
}

// ── the strict schema (core shape: issues[].acceptanceCriteria[].evidence[]) ──
// Evidence carries the typed fields the audit/attestation surfaces read — all
// optional strings (a strict shape, not a Record<string,unknown> grab-bag).
const GenericEvidenceSchema = z.object({
  id: z.string().min(1),                 // core
  type: z.string(),                      // preset
  ac: z.array(z.string()).optional(),
  sha: z.string().optional(),
  head: z.string().optional(),
  repo: z.string().optional(),
  number: z.string().optional(),
  state: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  blob: z.string().optional(),
  status: z.string().optional(),
  justification: z.string().optional(),
  mergeCommit: z.string().optional(),
  result: z.string().optional(),
  summary: z.string().optional(),
}).strict();
type GenericEvidence = z.infer<typeof GenericEvidenceSchema>;

const GenericAcStatusSchema = z.enum(['pending', 'passed', 'failed', 'stale', 'blocked', 'descoped']);
const GenericAcSchema = z.object({
  id: z.string().min(1),                         // core
  status: GenericAcStatusSchema,                  // core (narrowed)
  evidence: z.array(GenericEvidenceSchema),       // core (evidence cited by this AC)
  checked: z.boolean(),                           // preset: the GFM checkbox
  text: z.string(),                               // preset
  type: z.string(),                               // preset: ac/dev/case/ext/proc
  sourceRefs: z.array(z.string()),                // preset: [N] markers cited
  commitHashes: z.array(z.string()),              // preset: commit: <sha> citations
  evidenceRefs: z.array(z.string()),              // preset: [E?] ids cited
  blockedBy: z.array(BlockRefSchema).optional(),  // primitive: nodes that gate this one
  blocks: z.array(BlockRefSchema).optional(),     // primitive: nodes this one gates
}).strict();

const GenericIssueSchema = z.object({
  id: z.string().min(1),                          // core
  title: z.string(),                              // core
  summary: z.string(),                            // core
  status: z.string(),                             // core: the backend state
  acceptanceCriteria: z.array(GenericAcSchema),   // core
  stateType: z.string(),                          // preset
  assignee: z.string(),                           // preset
  labels: z.array(z.string()),                    // primitive
  sourceMarkers: z.array(z.string()),             // preset: [N] markers present in the body
  sections: z.array(z.string()),                  // preset: ## section titles present
}).strict();

const GenericRootSchema = z.object({ issues: z.array(GenericIssueSchema) }).strict();
type GenericRoot = z.infer<typeof GenericRootSchema>;

// ── mdast parse: structure from the AST; regex only for field content in a node ─
type MdNode = { type: string; depth?: number; checked?: boolean | null; children?: MdNode[]; value?: string };
const SOURCE_RE = /(?<![A-Za-z])\[(?:source\s*)?(\d+)\]/gi;
const EVIDENCE_REF_RE = /\[(E\d+)\]/g;
const COMMIT_RE = /\bcommit[:\s]+([0-9a-f]{7,40})\b/gi;
const STATUS_RE = /\bstatus:\s*(pending|passed|failed|stale|blocked|descoped)\b/i;
// AC blocking, authored inline on the checkbox line: `blocked-by: <refs>` / `blocks:
// <refs>`, each a comma list of AC refs (bare = this issue, `issue:ac` = cross-issue).
// The value runs to the next known field, a [marker], or end of line.
const BLOCK_FIELD_RE = /\b(blocked-by|blocks):\s*(.+?)(?=\s+(?:status|commit|blocked-by|blocks|ac-version):|\s*\[[^\]]*\]|$)/gi;
const AC_ID_RE = /^\s*(AC[- ]?|case\/|dev\/|ext\/|proc\/)(\d{1,3})\b/i;
const EV_ENTRY_RE = /^\s*\[(E\d+)\]\s+(.+)$/;
const FIELD_RE = /\b([a-z][a-z0-9-]*)\s*:\s*(.+?)(?=\s+[a-z][a-z0-9-]*\s*:|$)/gi;

function nodeText(node: MdNode): string {
  return typeof node.value === 'string' ? node.value : (node.children ?? []).map(nodeText).join('');
}
function firstLine(node: MdNode): string {
  const p = (node.children ?? []).find((c) => c.type === 'paragraph');
  const text = p ? nodeText(p) : nodeText(node);
  return (text.trim().split('\n')[0] ?? '').trim();
}
function splitIdTitle(headingText: string): { id: string; title: string } {
  const m = /^(\S+):\s*(.+)$/.exec(headingText.trim());
  return m ? { id: m[1]!, title: m[2]!.trim() } : { id: headingText.trim(), title: headingText.trim() };
}
function parseAcId(text: string): { id: string; type: string } {
  const m = AC_ID_RE.exec(text);
  if (!m) return { id: text.trim().split(/\s+/, 1)[0] || 'AC', type: 'ac' };
  const prefix = m[1]!.toLowerCase();
  const num = String(Number(m[2])).padStart(2, '0');
  if (prefix.endsWith('/')) return { id: `${prefix.slice(0, -1)}/${num}`, type: prefix.slice(0, -1) };
  return { id: `AC-${num}`, type: 'ac' };
}
function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
function sourceMarkers(text: string): string[] {
  return uniqSorted([...text.matchAll(SOURCE_RE)].map((m) => m[1]!));
}
// Parse inline `blocked-by:`/`blocks:` tokens against the issue they were authored in.
// Tokens stay RAW (bare vs qualified) until the whole tracker is known; see
// normalizeBlockRefs, called once after every issue is parsed.
function parseAcBlocking(text: string, issueId: string): { blockedBy: RawBlockRef[]; blocks: RawBlockRef[] } {
  const blockedBy: RawBlockRef[] = [];
  const blocks: RawBlockRef[] = [];
  for (const m of text.matchAll(BLOCK_FIELD_RE)) {
    const refs = m[2]!.split(',').map((s) => s.trim()).filter(Boolean)
      .map((t) => parseBlockToken(t, issueId)).filter((r): r is RawBlockRef => r !== null);
    if (m[1]!.toLowerCase() === 'blocks') blocks.push(...refs);
    else blockedBy.push(...refs);
  }
  return { blockedBy, blocks };
}

function parseGenericIssue(markdown: string): Record<string, unknown> | null {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as MdNode;
  const issue: Record<string, unknown> = {
    id: '', title: '', summary: '', status: 'open', stateType: 'open', assignee: '',
    labels: [], sourceMarkers: [], sections: [], acceptanceCriteria: [],
  };
  const buildEvidence = (id: string, rest: string): GenericEvidence => {
    // `justification`/`summary` are free text (may contain colons/URLs) and are
    // written last, so capture them to end-of-line; parse the structured key:value
    // fields only from the prefix before them (FIELD_RE would otherwise truncate a
    // value at the next `word:` token).
    const free = /\b(justification|summary):\s*(.*)$/i.exec(rest);
    const structured = free ? rest.slice(0, free.index) : rest;
    const f = Object.fromEntries([...structured.matchAll(FIELD_RE)].map((m) => [m[1]!.toLowerCase(), m[2]!.trim()]));
    const opt = (key: string) => (f[key] ? { [key]: f[key] } : {});
    return {
      id, type: f.type || 'evidence',
      ...(f.ac ? { ac: f.ac.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      ...opt('sha'), ...opt('head'), ...opt('repo'), ...opt('number'), ...opt('state'),
      ...opt('path'), ...opt('url'), ...opt('blob'), ...opt('status'),
      ...opt('result'),
      ...(free ? { [free[1]!.toLowerCase()]: free[2]!.trim() } : {}),
      ...(f['merge-commit'] ? { mergeCommit: f['merge-commit'] } : {}),
    } as GenericEvidence;
  };

  // GFM checkboxes are acceptance criteria — discovered STRUCTURALLY (the record
  // is the `listItem` node), anywhere in the body.
  const checkboxes: MdNode[] = [];
  const collectCheckboxes = (node: MdNode) => {
    for (const child of node.children ?? []) {
      if (child.type === 'listItem' && typeof child.checked === 'boolean') checkboxes.push(child);
      collectCheckboxes(child);
    }
  };

  // The nodes under a top-level `## <title>` section, up to the next heading —
  // mdast structure identifies the section; we don't line-scan the whole doc.
  const sectionContentNodes = (titleRe: RegExp): MdNode[] => {
    const out: MdNode[] = [];
    let inSection = false;
    for (const node of tree.children ?? []) {
      if (node.type === 'heading') { inSection = (node.depth ?? 0) >= 2 && titleRe.test(nodeText(node).trim()); continue; }
      if (inSection) out.push(node);
    }
    return out;
  };

  for (const node of tree.children ?? []) {
    if (node.type === 'heading' && node.depth === 1) {
      // Only the FIRST H1 is the issue id/title (the loader frames it). A second
      // `#` heading inside the body is ordinary content, not a new id.
      if (!issue.id) { const { id, title } = splitIdTitle(nodeText(node)); issue.id = id; issue.title = title; }
      continue;
    }
    if (node.type === 'heading') { (issue.sections as string[]).push(nodeText(node).trim()); continue; }
    if (node.type === 'paragraph') {
      const text = nodeText(node);
      const status = /^Status:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (status) issue.status = status;
      const stateType = /^StateType:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (stateType) issue.stateType = stateType;
      const assignee = /^Assignee:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (assignee) issue.assignee = assignee;
      const labels = /^Labels:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (labels) issue.labels = labels.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  collectCheckboxes(tree);

  // Evidence records live in the identified `## Evidence` section. Canonical form
  // is one `- [En] …` GFM list item per record (node-structural); we recurse into
  // nested lists, and for a legacy bare `[En]` paragraph read each `[En]` line.
  const evidenceEntries: GenericEvidence[] = [];
  const collectEvidence = (nodes: MdNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'list') { collectEvidence(node.children ?? []); continue; }
      if (node.type === 'listItem') {
        const m = EV_ENTRY_RE.exec(firstLine(node));
        if (m) evidenceEntries.push(buildEvidence(m[1]!, m[2]!));
        else collectEvidence(node.children ?? []); // a grouping item — descend
        continue;
      }
      if (node.type === 'paragraph') {
        for (const line of nodeText(node).split('\n')) {
          const m = EV_ENTRY_RE.exec(line);
          if (m) evidenceEntries.push(buildEvidence(m[1]!, m[2]!));
        }
      }
    }
  };
  collectEvidence(sectionContentNodes(/^Evidence$/i));

  const evidenceById = new Map(evidenceEntries.map((e) => [e.id, e]));
  issue.acceptanceCriteria = checkboxes.map((item) => {
    const text = firstLine(item);
    const { id, type } = parseAcId(text);
    const checked = item.checked === true;
    const status = STATUS_RE.exec(text)?.[1]?.toLowerCase() ?? (checked ? 'passed' : 'pending');
    const evidenceRefs = uniqSorted([...text.matchAll(EVIDENCE_REF_RE)].map((m) => m[1]!));
    const { blockedBy, blocks } = parseAcBlocking(text, issue.id as string);
    return {
      id, type, checked, status,
      text: text.replace(/\s{2,}/g, ' ').trim(),
      sourceRefs: sourceMarkers(text),
      commitHashes: uniqSorted([...text.matchAll(COMMIT_RE)].map((m) => m[1]!.toLowerCase())),
      evidenceRefs,
      evidence: evidenceRefs.filter((ref) => evidenceById.has(ref)).map((ref) => evidenceById.get(ref)!),
      ...(blockedBy.length ? { blockedBy } : {}),
      ...(blocks.length ? { blocks } : {}),
    };
  });
  // Source markers cited by the issue: the [N] refs on ACs plus any cited in the
  // identified Summary/Sources sections — read from those nodes, not the whole doc.
  const acMarkers = (issue.acceptanceCriteria as Array<{ sourceRefs: string[] }>).flatMap((ac) => ac.sourceRefs);
  const proseMarkers = sectionContentNodes(/^(Summary|Sources)$/i).flatMap((n) => sourceMarkers(nodeText(n)));
  issue.sourceMarkers = uniqSorted([...acMarkers, ...proseMarkers]);
  return issue.id ? issue : null;
}

function parseGeneric(bundle: string): unknown {
  const issues = splitIssueBundle(bundle).map((s) => parseGenericIssue(s.body)).filter((i): i is Record<string, unknown> => i !== null);
  normalizeBlockRefs(issues as unknown as Parameters<typeof normalizeBlockRefs>[0]); // classify bare refs now the whole tracker is known
  return { issues };
}

const shaMatches = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
const isCanceled = (i: GenericRoot['issues'][number]) => i.stateType.toLowerCase() === 'canceled';
const isDone = (i: GenericRoot['issues'][number]) => ['done', 'completed'].includes((i.stateType || i.status).toLowerCase());

export function createGenericPreset(config: GenericPresetConfig): Preset<GenericRoot> {
  const name = config.name;
  const code = (suffix: string) => `${name}_${suffix}`;
  // for the blocking graph: a zero-AC issue counts as a met blocker only when its
  // backend state is a done state.
  const isIssueDone = (issue: CoreIssue): boolean => isDone(issue as unknown as GenericRoot['issues'][number]);

  const rules: Rule<GenericRoot>[] = [];

  // cross-issue (root) rule: the root is multi-issue (the loader frames the whole
  // tracker), so ids must be unique across it — a check only expressible here.
  rules.push({
    name: code('duplicate_issue_id'),
    run: ({ root }) => {
      const seen = new Set<string>(); const out: Finding[] = [];
      for (const i of root.issues) {
        if (seen.has(i.id)) out.push({ code: code('duplicate_issue_id'), severity: 'error', issueId: i.id, message: `Duplicate issue id ${i.id} in the tracker.` });
        seen.add(i.id);
      }
      return out;
    },
  });

  if (config.requireSourceMarker) {
    rules.push({
      name: code('case_missing_source_marker'), category: 'sourced', depth: 1,
      run: ({ root }) => root.issues.filter((i) => i.sourceMarkers.length === 0).map((i): Finding => ({
        code: code('case_missing_source_marker'), severity: 'error', issueId: i.id,
        message: 'Case body must cite at least one [N] source marker.',
      })),
    });
  }

  // invariant: an explicit `status:` must not contradict the GFM checkbox.
  rules.push({
    name: code('checkbox_status_mismatch'),
    run: ({ root }) => root.issues.flatMap((i) => i.acceptanceCriteria
      .filter((ac) => (ac.checked && ac.status !== 'passed') || (!ac.checked && ac.status === 'passed'))
      .map((ac): Finding => ({ code: code('checkbox_status_mismatch'), severity: 'error', issueId: i.id, acId: ac.id, message: `AC ${ac.id} checkbox (${ac.checked ? '[x]' : '[ ]'}) disagrees with status "${ac.status}".` }))),
  });

  rules.push({
    name: code('case_missing_assignee'),
    run: ({ root }) => root.issues.filter((i) => !isCanceled(i) && i.assignee.trim() === '').map((i): Finding => ({
      code: code('case_missing_assignee'), severity: 'error', issueId: i.id,
      message: 'Non-canceled cases must have an assignee.',
    })),
  });

  const sectionRule = (suffix: string, sections: string[]) => ({
    name: code(suffix),
    run: ({ root }: { root: GenericRoot }) => root.issues.flatMap((i): Finding[] =>
      sections.filter((s) => !i.sections.includes(s)).map((s): Finding => ({
        code: code(`missing_${s.toLowerCase().replace(/\s+/g, '_')}`), severity: 'error', issueId: i.id,
        message: `Issue must include a ## ${s} section.`,
      }))),
  });
  if (config.requireSpecSections) rules.push(sectionRule('spec_sections', ['Requirements', 'Acceptance Criteria']));
  if (config.requireSpeckitSections) rules.push(sectionRule('speckit_sections', ['User Stories', 'Functional Requirements', 'Tasks']));

  if (config.requireSdlcGates) {
    rules.push({
      name: code('case_missing_acceptance_criteria'),
      run: ({ root }) => root.issues.filter((i) => !isCanceled(i) && i.acceptanceCriteria.length === 0).map((i): Finding => ({
        code: code('case_missing_acceptance_criteria'), severity: 'error', issueId: i.id,
        message: 'Active cases must include at least one acceptance criterion.',
      })),
    });
    rules.push({
      name: code('done_with_unpassed_acceptance_criteria'),
      run: ({ root }) => root.issues.filter((i) => isDone(i)).flatMap((i): Finding[] => {
        const passed = i.acceptanceCriteria.filter((ac) => ac.checked || ac.status === 'passed').length;
        return i.acceptanceCriteria.length === 0 || passed < i.acceptanceCriteria.length
          ? [{ code: code('done_with_unpassed_acceptance_criteria'), severity: 'error', issueId: i.id, message: 'Done cases require every acceptance criterion to be passed.' }]
          : [];
      }),
    });
  }

  // checked-AC evidence/commit gates (pure: commit existence comes from ctx.git)
  rules.push({
    name: code('checked_ac_evidence'), category: 'code', depth: 2,
    run: ({ root, context }) => {
      const existing = context.git?.existingCommits;
      return root.issues.flatMap((i) => i.acceptanceCriteria
        .filter((ac) => ac.checked || ac.status === 'passed')
        .flatMap((ac): Finding[] => {
          const out: Finding[] = [];
          if (ac.commitHashes.length === 0) out.push({ code: code('checked_ac_missing_commit_hash'), severity: 'error', issueId: i.id, acId: ac.id, message: `Checked AC ${ac.id} does not cite a commit hash.` });
          if (existing) {
            for (const sha of ac.commitHashes) {
              if (!existing.some((c) => shaMatches(c, sha))) out.push({ code: code('checked_ac_commit_hash_missing'), severity: 'error', issueId: i.id, acId: ac.id, message: `Checked AC ${ac.id} cites missing commit ${sha}.` });
            }
          }
          if (ac.evidenceRefs.length === 0) out.push({ code: code('checked_ac_missing_evidence'), severity: 'error', issueId: i.id, acId: ac.id, message: `Checked AC ${ac.id} does not cite evidence.` });
          const known = new Set(ac.evidence.map((e) => e.id));
          for (const ref of ac.evidenceRefs) {
            if (!known.has(ref)) out.push({ code: code('checked_ac_unknown_evidence'), severity: 'error', issueId: i.id, acId: ac.id, message: `Checked AC ${ac.id} cites unknown evidence ${ref}.` });
          }
          return out;
        }));
    },
  });

  // cross-tree blocking integrity over the UNIFIED dependency graph (AC + issue nodes,
  // both `blocked-by`/`blocks` directions). Referent + self checks run over the authored
  // refs; cycle + completion gates run over the graph.
  rules.push({
    name: code('ac_blocker_missing'),
    run: ({ root }) => blockerRefProblems(root).map((p): Finding => ({
      code: p.kind === 'self' ? code('ac_self_block') : code('ac_blocker_missing'),
      severity: 'error', issueId: p.issueId, acId: p.acId,
      message: p.kind === 'self'
        ? `AC ${formatRef({ issue: p.issueId, ac: p.acId })} lists itself as a blocker.`
        : `AC ${formatRef({ issue: p.issueId, ac: p.acId })} references ${formatRef(p.ref)}, which does not exist.`,
    })),
  });
  rules.push({
    name: code('ac_block_cycle'),
    run: ({ root }) => blockCycles(root).map((cycle): Finding => {
      const head = nodeIndex(root).get(cycle[0]!)!;
      return { code: code('ac_block_cycle'), severity: 'error', issueId: head.issue.id, ...(head.ac ? { acId: head.ac.id } : {}), message: `Blocking cycle: ${cycle.join(' → ')} → ${cycle[0]} can never be satisfied.` };
    }),
  });
  rules.push({
    name: code('ac_blocked_by_unpassed'),
    run: ({ root }) => completionViolations(root, { isIssueDone }).map(({ node, dep }): Finding => ({
      code: code('ac_blocked_by_unpassed'), severity: 'error', issueId: node.issue.id, ...(node.ac ? { acId: node.ac.id } : {}),
      message: `${node.key} is done but depends on ${dep.key} (status "${dep.kind === 'ac' ? dep.ac!.status : 'incomplete'}").`,
    })),
  });

  const scaffold = (title: string): string => {
    if (config.requireSpecSections && !config.requireSpeckitSections) {
      return `# ${title}\n\n## Summary\n\nShort statement of the feature or behavior. [1]\n\n## Requirements\n\n- The system must describe one concrete requirement. [1]\n\n## Acceptance Criteria\n\n- [ ] spec/01 status: pending Describe one observable acceptance criterion. [1]\n\n## Sources\n\n[1] Requirement:\nPaste the source text here.\n\n## Evidence\n`;
    }
    if (config.requireSpeckitSections) {
      return `# ${title}\n\n## Summary\n\nSpec Kit feature summary. [1]\n\n## User Stories\n\n- As a user, I can do something valuable.\n\n## Functional Requirements\n\n- FR-001: The system must describe one concrete behavior. [1]\n\n## Tasks\n\n- [ ] task/01 status: pending Implement the first verifiable task. [1]\n\n## Acceptance Criteria\n\n- [ ] spec/01 status: pending The feature satisfies the primary user story. [1]\n\n## Sources\n\n[1] Requirement:\nPaste the source text here.\n\n## Evidence\n`;
    }
    const marker = config.requireSourceMarker;
    return `# ${title}\n\n## Summary\n\n${marker ? 'Source-grounded summary. [1]' : 'Short statement of the work.'}\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending Describe one observable outcome.${marker ? ' [1]' : ''}\n\n${marker ? '## Sources\n\n[1] Requirement:\nPaste the source text here.\n\n' : ''}## Evidence\n`;
  };

  return {
    name,
    schema: GenericRootSchema,
    loadContext: (input) => gitWorld(input.projectRoot, [], { verifyCommits: input.verifyCommits }),
    parse: parseGeneric,
    rules,
    scaffold,
    primitives: { labels: true, blocking: true, sources: false, proof: false, relations: false, linkedIssues: false, children: false, category: false },
  };
}
