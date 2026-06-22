// preset-kit: the authoring API a repo-local preset rents, plus createGenericPreset (the
// in-package reference implementation `ztrack init` VENDORS records from).
//
// `ztrack init` installs `.volter/tracker/validation/preset.cjs` as REAL editable code:
// it imports the engine + this kit's genericParser/genericSchema/genericScaffold and
// declares its rules as records over the derived model (see boilerplates/presets/preset.cjs).
// createGenericPreset is the typed, tested factory those vendored records mirror — kept as
// the reference (and an alternative thin authoring style). presetInstall.test.ts proves the
// installed template stays behaviorally identical to it.

import { z } from 'zod';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { rule, type BlockerFact, type CompletionFact, type CycleFact, type DerivedModel, type Preset, type Rule } from './core/engine.ts';
import { splitIssueBundle } from './core/bundle.ts';
import { gitWorld } from './core/gitWorld.ts';
import { BlockRefSchema, formatRef } from './core/ref.ts';
import { normalizeBlockRefs, parseBlockToken, type RawBlockRef } from './core/blocking.ts';

// Re-exported so a repo-local preset's `loadContext` can gather git facts without
// reaching into ztrack internals: require('ztrack/preset-kit').gitWorld(root, branches).
export { gitWorld } from './core/gitWorld.ts';

// World annotations live behind the `@volter-ai-dev/twin` PEER dependency, so they are
// deliberately NOT re-exported here: pulling them through the authoring entry would force
// every installed preset (even a basic tracker that loads `ztrack/preset-kit`) to resolve
// `twin` just to load. A preset whose loadContext uses world annotations imports them from
// the dedicated subpath instead — `require('ztrack/world-annotations')` — where the `twin`
// dependency it actually uses is expected to be present.

// ── authoring API for repo-local presets installed by `ztrack init` ──────────
// An installed preset.cjs is REAL CODE: it rents the engine + this kit's generic
// parser/schema/scaffold and declares its rules as records over the derived model.
// These exports are that authoring surface (the parts an installed preset imports).
export { rule, definePreset, check, checkRoot, deriveCoreModel } from './core/engine.ts';
export type {
  Preset, Rule, RuleRecord, DerivedModel, Located, Finding, Severity, Context,
  BlockRef, BlockerFact, CycleFact, CompletionFact, CoreRoot,
} from './core/engine.ts';
export { formatRef, BlockRefSchema } from './core/ref.ts';

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
  descopeReason: z.string().optional(),           // preset: `reason:` justifying a descoped AC
  blockedBy: z.array(BlockRefSchema).optional(),  // primitive: nodes that gate this one
  blocks: z.array(BlockRefSchema).optional(),     // primitive: nodes this one gates
}).strict();

// A `## Waiver` block, parsed into the core Waiver shape. Present only when the issue
// carries the section; the engine validates it (reason + sign-off required, freshness).
const GenericWaiverSchema = z.object({
  reason: z.string(),
  approvedBy: z.string(),
  acFingerprint: z.string(),
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
  waiver: GenericWaiverSchema.optional(),         // core: an authority's freshness-anchored acknowledgment
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
const BLOCK_FIELD_RE = /\b(blocked-by|blocks):\s*(.+?)(?=\s+(?:status|commit|blocked-by|blocks|ac-version|reason):|\s*\[[^\]]*\]|$)/gi;
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
    // Only a descoped AC carries a `reason:`; bound the capture so it doesn't swallow a
    // trailing [E?]/[N] ref or another field into the prose (mirrors BLOCK_FIELD_RE).
    const descopeReason = status === 'descoped'
      ? /\breason:[ \t]*(.+?)[ \t]*(?=\s\[[^\]]*\]|\s+(?:status|commit|blocked-by|blocks|ac-version):|$)/i.exec(text)?.[1]?.trim()
      : undefined;
    return {
      id, type, checked, status,
      text: text.replace(/\s{2,}/g, ' ').trim(),
      sourceRefs: sourceMarkers(text),
      commitHashes: uniqSorted([...text.matchAll(COMMIT_RE)].map((m) => m[1]!.toLowerCase())),
      evidenceRefs,
      evidence: evidenceRefs.filter((ref) => evidenceById.has(ref)).map((ref) => evidenceById.get(ref)!),
      ...(descopeReason ? { descopeReason } : {}),
      ...(blockedBy.length ? { blockedBy } : {}),
      ...(blocks.length ? { blocks } : {}),
    };
  });
  // Source markers cited by the issue: the [N] refs on ACs plus any cited in the
  // identified Summary/Sources sections — read from those nodes, not the whole doc.
  const acMarkers = (issue.acceptanceCriteria as Array<{ sourceRefs: string[] }>).flatMap((ac) => ac.sourceRefs);
  const proseMarkers = sectionContentNodes(/^(Summary|Sources)$/i).flatMap((n) => sourceMarkers(nodeText(n)));
  issue.sourceMarkers = uniqSorted([...acMarkers, ...proseMarkers]);

  // A `## Waiver` block records an authority's freshness-anchored acknowledgment. Parse
  // whenever the section is present (even if a field is missing — the engine flags an
  // unreasoned/unsigned waiver); fields read only from the Waiver section's own nodes.
  if ((issue.sections as string[]).some((s) => /^waiver$/i.test(s))) {
    const wtext = sectionContentNodes(/^Waiver$/i).map(nodeText).join('\n');
    // [ \t]* (not \s*) so an empty field doesn't swallow the next line's value.
    const field = (re: RegExp): string => re.exec(wtext)?.[1]?.trim() ?? '';
    issue.waiver = {
      reason: field(/(?:^|\n)[ \t]*reason:[ \t]*(.+)/i),
      approvedBy: field(/(?:^|\n)[ \t]*by:[ \t]*(.+)/i),
      acFingerprint: field(/(?:^|\n)[ \t]*ac-version:[ \t]*(\S+)/i),
    };
  }
  return issue.id ? issue : null;
}

function parseGeneric(bundle: string): unknown {
  const issues = splitIssueBundle(bundle).map((s) => parseGenericIssue(s.body)).filter((i): i is Record<string, unknown> => i !== null);
  normalizeBlockRefs(issues as unknown as Parameters<typeof normalizeBlockRefs>[0]); // classify bare refs now the whole tracker is known
  return { issues };
}

const shaMatches = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
type GIssue = GenericRoot['issues'][number];
type GAC = GIssue['acceptanceCriteria'][number];
const isCanceled = (i: GIssue) => i.stateType.toLowerCase() === 'canceled';
const isDone = (i: GIssue) => ['done', 'completed'].includes((i.stateType || i.status).toLowerCase());
// Typed view of this preset's derived facts (the one place the open `derived` bag is narrowed).
type GenericFacts = { missingCommitHashes: Array<{ issueId: string; acId: string; sha: string }>; unknownEvidenceRefs: Array<{ issueId: string; acId: string; ref: string }> };
const facts = (m: DerivedModel<GenericRoot>): GenericFacts => m.derived as unknown as GenericFacts;

export function createGenericPreset(config: GenericPresetConfig): Preset<GenericRoot> {
  const name = config.name;
  const code = (suffix: string) => `${name}_${suffix}`;
  const codeDepth = { category: 'code' as const, depth: 2 as const };

  // Rules are declarative records over the engine's derived model. Duplicate ids and the
  // unified block graph (cycles, blocker problems, completion violations) arrive on the
  // core model; the per-commit/per-evidence-ref problems this preset checks are derived
  // below. The omnibus "checked AC evidence" rule decomposes into four named records.
  const rules: Rule<GenericRoot>[] = [
    // cross-issue: ids unique across the framed tracker root.
    rule<GenericRoot, { issueId: string }>({
      code: code('duplicate_issue_id'), select: (m) => m.duplicateIssueIds,
      message: ({ issueId }) => `Duplicate issue id ${issueId} in the tracker.`,
    }),
    // invariant: an explicit `status:` must not contradict the GFM checkbox.
    rule<GenericRoot, { issueId: string; acId: string; ac: GAC }>({
      code: code('checkbox_status_mismatch'), select: (m) => m.acs,
      when: ({ ac }) => (ac.checked && ac.status !== 'passed') || (!ac.checked && ac.status === 'passed'),
      message: ({ ac }) => `AC ${ac.id} checkbox (${ac.checked ? '[x]' : '[ ]'}) disagrees with status "${ac.status}".`,
    }),
    rule<GenericRoot, { issueId: string; issue: GIssue }>({
      code: code('case_missing_assignee'), select: (m) => m.issues,
      when: ({ issue }) => !isCanceled(issue) && issue.assignee.trim() === '',
      message: () => 'Non-canceled cases must have an assignee.',
    }),
    // checked-AC evidence/commit gates (commit existence comes from the model's context).
    rule<GenericRoot, { issueId: string; acId: string; ac: GAC }>({
      code: code('checked_ac_missing_commit_hash'), ...codeDepth, select: (m) => m.acs,
      when: ({ ac }) => (ac.checked || ac.status === 'passed') && ac.commitHashes.length === 0,
      message: ({ ac }) => `Checked AC ${ac.id} does not cite a commit hash.`,
    }),
    rule<GenericRoot, { issueId: string; acId: string; sha: string }>({
      code: code('checked_ac_commit_hash_missing'), ...codeDepth,
      select: (m) => facts(m).missingCommitHashes,
      message: ({ acId, sha }) => `Checked AC ${acId} cites missing commit ${sha}.`,
    }),
    rule<GenericRoot, { issueId: string; acId: string; ac: GAC }>({
      code: code('checked_ac_missing_evidence'), ...codeDepth, select: (m) => m.acs,
      when: ({ ac }) => (ac.checked || ac.status === 'passed') && ac.evidenceRefs.length === 0,
      message: ({ ac }) => `Checked AC ${ac.id} does not cite evidence.`,
    }),
    rule<GenericRoot, { issueId: string; acId: string; ref: string }>({
      code: code('checked_ac_unknown_evidence'), ...codeDepth,
      select: (m) => facts(m).unknownEvidenceRefs,
      message: ({ acId, ref }) => `Checked AC ${acId} cites unknown evidence ${ref}.`,
    }),
    // cross-tree blocking integrity over the unified dependency graph (engine-analyzed).
    rule<GenericRoot, BlockerFact>({
      code: code('ac_self_block'), select: (m) => m.graph.blockerProblems, when: (b) => b.kind === 'self',
      message: (b) => `AC ${formatRef({ issue: b.issueId, ac: b.acId })} lists itself as a blocker.`,
    }),
    rule<GenericRoot, BlockerFact>({
      code: code('ac_blocker_missing'), select: (m) => m.graph.blockerProblems, when: (b) => b.kind !== 'self',
      message: (b) => `AC ${formatRef({ issue: b.issueId, ac: b.acId })} references ${b.refText}, which does not exist.`,
    }),
    rule<GenericRoot, CycleFact>({
      code: code('ac_block_cycle'), select: (m) => m.graph.cycles,
      message: ({ cycle }) => `Blocking cycle: ${cycle.join(' → ')} → ${cycle[0]} can never be satisfied.`,
    }),
    rule<GenericRoot, CompletionFact>({
      code: code('ac_blocked_by_unpassed'), select: (m) => m.graph.completionViolations,
      message: ({ nodeKey, depKey, depStatus }) => `${nodeKey} is done but depends on ${depKey} (status "${depStatus}").`,
    }),
  ];

  if (config.requireSourceMarker) {
    rules.push(rule<GenericRoot, { issueId: string; issue: GIssue }>({
      code: code('case_missing_source_marker'), category: 'sourced', depth: 1, select: (m) => m.issues,
      when: ({ issue }) => issue.sourceMarkers.length === 0,
      message: () => 'Case body must cite at least one [N] source marker.',
    }));
  }

  // one record per required section, each emitting its own missing_<section> code.
  const sectionRules = (sections: string[]) => sections.map((s) =>
    rule<GenericRoot, { issueId: string; issue: GIssue }>({
      code: code(`missing_${s.toLowerCase().replace(/\s+/g, '_')}`), select: (m) => m.issues,
      when: ({ issue }) => !issue.sections.includes(s),
      message: () => `Issue must include a ## ${s} section.`,
    }));
  if (config.requireSpecSections) rules.push(...sectionRules(['Requirements', 'Acceptance Criteria']));
  if (config.requireSpeckitSections) rules.push(...sectionRules(['User Stories', 'Functional Requirements', 'Tasks']));

  if (config.requireSdlcGates) {
    rules.push(rule<GenericRoot, { issueId: string; issue: GIssue }>({
      code: code('case_missing_acceptance_criteria'), select: (m) => m.issues,
      when: ({ issue }) => !isCanceled(issue) && issue.acceptanceCriteria.length === 0,
      message: () => 'Active cases must include at least one acceptance criterion.',
    }));
    rules.push(rule<GenericRoot, { issueId: string; issue: GIssue }>({
      code: code('done_with_unpassed_acceptance_criteria'), select: (m) => m.issues,
      when: ({ issue }) => {
        if (!isDone(issue)) return false;
        // An AC is "settled" for done-ness when it passed OR was explicitly descoped (a
        // recorded scope decision — the honest alternative to waiving). `blocked` is NOT
        // settled: a done case can't carry an AC that's still waiting on other work. And a
        // done case needs at least one ACTUALLY passed AC — descoping every criterion is not
        // "done", it's a no-op (cancel it instead), and would otherwise be a free bypass.
        const acs = issue.acceptanceCriteria;
        const settled = acs.filter((ac) => ac.checked || ac.status === 'passed' || ac.status === 'descoped').length;
        const passed = acs.filter((ac) => ac.checked || ac.status === 'passed').length;
        return acs.length === 0 || settled < acs.length || passed === 0;
      },
      message: () => 'Done cases require every acceptance criterion to be passed or descoped, with at least one actually passed (descoping every criterion is not "done").',
    }));
    // Descoping is the in-the-open scope decision, so it must say why — an unjustified
    // descope is as suspect as an unreasoned waiver.
    rules.push(rule<GenericRoot, { issueId: string; acId: string; ac: GAC }>({
      code: code('descoped_ac_missing_reason'), select: (m) => m.acs,
      when: ({ ac }) => ac.status === 'descoped' && !ac.descopeReason?.trim(),
      message: ({ ac }) => `Descoped AC ${ac.id} must cite a reason (\`reason: …\`) explaining why it is out of scope.`,
    }));
  }

  // this preset's analyzed facts: per-commit and per-evidence-ref problems on checked ACs.
  const derive = (model: DerivedModel<GenericRoot>) => {
    const missingCommitHashes: Array<{ issueId: string; acId: string; sha: string }> = [];
    const unknownEvidenceRefs: Array<{ issueId: string; acId: string; ref: string }> = [];
    const existing = model.context.git?.existingCommits;
    for (const i of model.root.issues) {
      for (const ac of i.acceptanceCriteria) {
        if (!(ac.checked || ac.status === 'passed')) continue;
        if (existing) for (const sha of ac.commitHashes) if (!existing.some((c) => shaMatches(c, sha))) missingCommitHashes.push({ issueId: i.id, acId: ac.id, sha });
        const known = new Set(ac.evidence.map((e) => e.id));
        for (const ref of ac.evidenceRefs) if (!known.has(ref)) unknownEvidenceRefs.push({ issueId: i.id, acId: ac.id, ref });
      }
    }
    return { missingCommitHashes, unknownEvidenceRefs };
  };

  return {
    name,
    schema: GenericRootSchema,
    loadContext: (input) => gitWorld(input.projectRoot, [], { verifyCommits: input.verifyCommits }),
    parse: parseGeneric,
    // a zero-AC issue counts as a met blocker (for the graph completion gate) only at a done state.
    isIssueDone: isDone,
    derive,
    rules,
    scaffold: genericScaffold(config),
    primitives: { labels: true, blocking: true, sources: false, proof: false, relations: false, linkedIssues: false, children: false, category: false },
  };
}

// ── rented mechanism an installed preset imports (parser/schema/scaffold) ─────
// The generic markdown parser and root schema, and the starter-body generator, exposed
// so a repo-local preset can rent them and keep only its RULES as editable records.
export const genericParser = parseGeneric;
export const genericSchema = GenericRootSchema;
export function genericScaffold(config: GenericPresetConfig): (title: string) => string {
  return (title: string): string => {
    if (config.requireSpecSections && !config.requireSpeckitSections) {
      return `# ${title}\n\n## Summary\n\nShort statement of the feature or behavior. [1]\n\n## Requirements\n\n- The system must describe one concrete requirement. [1]\n\n## Acceptance Criteria\n\n- [ ] spec/01 status: pending Describe one observable acceptance criterion. [1]\n\n## Sources\n\n[1] Requirement:\nPaste the source text here.\n\n## Evidence\n`;
    }
    if (config.requireSpeckitSections) {
      return `# ${title}\n\n## Summary\n\nSpec Kit feature summary. [1]\n\n## User Stories\n\n- As a user, I can do something valuable.\n\n## Functional Requirements\n\n- FR-001: The system must describe one concrete behavior. [1]\n\n## Tasks\n\n- [ ] task/01 status: pending Implement the first verifiable task. [1]\n\n## Acceptance Criteria\n\n- [ ] spec/01 status: pending The feature satisfies the primary user story. [1]\n\n## Sources\n\n[1] Requirement:\nPaste the source text here.\n\n## Evidence\n`;
    }
    const marker = config.requireSourceMarker;
    return `# ${title}\n\n## Summary\n\n${marker ? 'Source-grounded summary. [1]' : 'Short statement of the work.'}\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending Describe one observable outcome.${marker ? ' [1]' : ''}\n\n${marker ? '## Sources\n\n[1] Requirement:\nPaste the source text here.\n\n' : ''}## Evidence\n`;
  };
}
