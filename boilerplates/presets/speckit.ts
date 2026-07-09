// The speckit SDLC (GitHub Spec Kit) as a CORE-contract preset — IDIOMATIC and
// aiming to capture as much of the real Spec Kit process as the artifacts encode.
//
// A feature is multi-file (specs/<slug>/{spec,plan,tasks,research,data-model,
// quickstart}.md + contracts/* + the shared .specify/memory/constitution.md),
// bundled for the single-string core parse via `===FILE <path>===` markers.
//
// Captured (all parseable from the real Spec Kit templates):
//   spec.md   — metadata (Feature Branch/Status/Created/Input), user stories
//               (Priority Pn) + Given/When/Then scenarios, FR-### / SC-###,
//               Key Entities, Edge Cases, Assumptions, Clarifications log,
//               [NEEDS CLARIFICATION] markers.
//   tasks.md  — `## Phase N:` structure: Setup, Foundational (blocking), per-User
//               Story (🎯 MVP), Polish; tasks `- [ ] T012 [P] [US1] … (depends on
//               Txx)`; completion = checkbox.
//   plan.md   — Technical Context fields, Constitution Check gate, Complexity.
//   constitution.md — governing principles.
//   design artifacts — presence of research.md / data-model.md / quickstart.md /
//               contracts/*.
//
// Mapping: feature -> issue. **AC unit = USER STORY** (prioritized, independently
// testable); done when all its tasks are checked. FR/SC/entities/edge-cases/etc.
// are spec-level fields. Status follows the command pipeline
// (specifying/planning/tasking/in-progress/done).
//
// VERIFICATION LAYER (explicit extension beyond stock Spec Kit): a task may cite
// `(commit: <sha>)`; those are the story's evidence and are checked for existence.

// A STANDALONE preset: imports ONLY the public mechanism from `ztrack/preset-kit`.
import {
  z, toMdast, check as runCheck, rule, gitWorld,
  type Context, type DerivedModel, type IssueRecord, type Preset, type Rule, type VisualizerSpec,
} from 'ztrack/preset-kit';

// ── hard schema (core + speckit-specific, all strict) ───────────────────────
export const SpeckitEvidenceSchema = z.object({
  id: z.string().min(1), task: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
}).strict();
export const SpeckitScenarioSchema = z.object({ id: z.string().min(1), text: z.string().min(1), needsClarification: z.boolean() }).strict();
export const SpeckitTaskSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), status: z.enum(['pending', 'done']), parallel: z.boolean(),
  storyId: z.string().min(1).optional(), commit: z.string().regex(/^[0-9a-f]{7,40}$/).optional(), dependsOn: z.array(z.string().min(1)),
}).strict();
export const SpeckitPhaseKindSchema = z.enum(['setup', 'foundational', 'story', 'polish', 'other']);
export const SpeckitPhaseSchema = z.object({
  name: z.string().min(1), kind: SpeckitPhaseKindSchema, storyId: z.string().min(1).optional(),
  priority: z.string().min(1).optional(), mvp: z.boolean(), tasks: z.array(SpeckitTaskSchema),
}).strict();

export const SpeckitAcStatusSchema = z.enum(['pending', 'done']);
export const SpeckitAcSchema = z.object({  // a user story = the testable AC unit
  id: z.string().min(1), status: SpeckitAcStatusSchema, evidence: z.array(SpeckitEvidenceSchema),
  text: z.string().min(1), priority: z.string().min(1).optional(), mvp: z.boolean(),
  needsClarification: z.boolean(), scenarios: z.array(SpeckitScenarioSchema), tasks: z.array(SpeckitTaskSchema),
}).strict();

export const SpeckitRequirementSchema = z.object({ id: z.string().min(1), text: z.string().min(1), needsClarification: z.boolean() }).strict();
export const SpeckitEntitySchema = z.object({ name: z.string().min(1), description: z.string() }).strict();
export const SpeckitClarificationSchema = z.object({ text: z.string().min(1) }).strict();
export const SpeckitFieldSchema = z.object({ field: z.string().min(1), value: z.string().min(1) }).strict();
export const SpeckitGateSchema = z.object({ text: z.string().min(1), passed: z.boolean().optional() }).strict();
export const SpeckitPlanSchema = z.object({
  present: z.boolean(), technicalContext: z.array(SpeckitFieldSchema), constitutionGates: z.array(SpeckitGateSchema), complexity: z.array(z.string().min(1)),
}).strict();
export const SpeckitConstitutionSchema = z.object({ present: z.boolean(), principles: z.array(z.string().min(1)) }).strict();
export const SpeckitArtifactsSchema = z.object({ research: z.boolean(), dataModel: z.boolean(), quickstart: z.boolean(), contracts: z.array(z.string().min(1)) }).strict();

export const SpeckitIssueStatusSchema = z.enum(['specifying', 'planning', 'tasking', 'in-progress', 'done']);
export const SpeckitIssueSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), summary: z.string(), status: SpeckitIssueStatusSchema,
  acceptanceCriteria: z.array(SpeckitAcSchema),                 // = user stories
  slug: z.string().min(1),
  files: z.object({ spec: z.string().min(1), plan: z.string().min(1).optional(), tasks: z.string().min(1).optional() }).strict(),
  metadata: z.object({ featureBranch: z.string().optional(), status: z.string().optional(), created: z.string().optional(), input: z.string().optional() }).strict(),
  requirements: z.array(SpeckitRequirementSchema),
  successCriteria: z.array(SpeckitRequirementSchema),
  keyEntities: z.array(SpeckitEntitySchema),
  edgeCases: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
  clarifications: z.array(SpeckitClarificationSchema),
  phases: z.array(SpeckitPhaseSchema),                          // non-story phases (setup/foundational/polish/other)
  plan: SpeckitPlanSchema,
  constitution: SpeckitConstitutionSchema,
  artifacts: SpeckitArtifactsSchema,
}).strict();

export const SpeckitRootSchema = z.object({ issues: z.array(SpeckitIssueSchema) }).strict();
export type SpeckitRoot = z.infer<typeof SpeckitRootSchema>;

// ── bundle ───────────────────────────────────────────────────────────────────
export function buildSpeckitBundle(files: Array<{ path: string; content: string }>): string {
  return files.map((f) => `===FILE ${f.path}===\n${f.content}`).join('\n');
}
function splitBundle(bundle: string): Array<{ path: string; content: string }> {
  if (!/^===FILE .+===$/m.test(bundle)) return [{ path: 'spec.md', content: bundle }];
  const out: Array<{ path: string; content: string }> = [];
  let cur: { path: string; content: string[] } | null = null;
  for (const line of bundle.split('\n')) {
    const m = /^===FILE (.+)===$/.exec(line);
    if (m) { if (cur) out.push({ path: cur.path, content: cur.content.join('\n') }); cur = { path: m[1]!.trim(), content: [] }; }
    else if (cur) cur.content.push(line);
  }
  if (cur) out.push({ path: cur.path, content: cur.content.join('\n') });
  return out;
}
const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\/+/, '');
const slugFromSpec = (p: string) => /^specs\/([^/]+)\/spec\.md$/.exec(norm(p))?.[1] ?? null;
const hasClarification = (t: string) => /\[NEEDS CLARIFICATION(?::|\])/i.test(t);

// ── mdast parsing: structure from the AST (headings, lists, GFM checkboxes);
// regex ONLY for designated field content within a node's text — the same
// pattern the default preset uses. Note mdast yields SEMANTIC text, so bold/code
// markers (**…**, `…`) are already stripped from node text. ────────────────────
type Md = { type: string; depth?: number; checked?: boolean | null; children?: Md[]; value?: string };
function parseMd(content: string): Md {
  return toMdast(content) as Md;
}
function nodeText(n: Md): string { return typeof n.value === 'string' ? n.value : (n.children ?? []).map(nodeText).join(''); }
// First line of the item's paragraph: the single-line task/story regexes can't span a
// soft-wrapped continuation line, which would otherwise drop the whole item.
function itemText(item: Md): string { const p = (item.children ?? []).find((c) => c.type === 'paragraph'); return p ? (nodeText(p).trim().split('\n')[0] ?? '') : ''; }
// list items whose nearest enclosing heading (ancestor chain by depth) matches `re`
function listItemsUnder(tree: Md, re: RegExp): Md[] {
  const out: Md[] = []; const stack: Array<{ d: number; t: string }> = [];
  for (const node of tree.children ?? []) {
    if (node.type === 'heading') { const d = node.depth ?? 1; while (stack.length && stack[stack.length - 1]!.d >= d) stack.pop(); stack.push({ d, t: nodeText(node).trim() }); continue; }
    if (node.type === 'list' && stack.some((s) => re.test(s.t))) for (const it of node.children ?? []) if (it.type === 'listItem') out.push(it);
  }
  return out;
}
const textsUnder = (tree: Md, re: RegExp) => listItemsUnder(tree, re).map(itemText).filter((t) => t && !/^\[.*\]$/.test(t));
// block nodes (paragraphs, tables, lists) whose nearest enclosing heading matches `re`
function nodesUnder(tree: Md, re: RegExp): Md[] {
  const out: Md[] = []; const stack: Array<{ d: number; t: string }> = [];
  for (const node of tree.children ?? []) {
    if (node.type === 'heading') { const d = node.depth ?? 1; while (stack.length && stack[stack.length - 1]!.d >= d) stack.pop(); stack.push({ d, t: nodeText(node).trim() }); continue; }
    if (stack.some((s) => re.test(s.t))) out.push(node);
  }
  return out;
}
const tableCells = (row: Md) => (row.children ?? []).filter((c) => c.type === 'tableCell').map((c) => nodeText(c).trim());
const headingsAtDepth = (tree: Md, depth: number) => (tree.children ?? []).filter((n) => n.type === 'heading' && (n.depth ?? 0) === depth).map((n) => nodeText(n).trim());
const paragraphsText = (tree: Md) => (tree.children ?? []).filter((n) => n.type === 'paragraph').map(nodeText).join('\n');

function extractRequirements(tree: Md, label: 'FR' | 'SC') {
  const sectionRe = label === 'FR' ? /functional requirements/i : /success criteria|measurable outcomes/i;
  const idRe = new RegExp(`^(${label}-\\d+):\\s*(.+)$`, 'i'); // ** already stripped by mdast
  return textsUnder(tree, sectionRe).flatMap((t) => { const m = idRe.exec(t); return m ? [{ id: m[1]!.toUpperCase(), text: m[2]!.trim(), needsClarification: hasClarification(m[2]!) }] : []; });
}
function extractEntities(tree: Md) {
  return textsUnder(tree, /key entities/i).flatMap((t) => { const m = /^(.+?):\s*(.*)$/.exec(t); return m ? [{ name: m[1]!.trim(), description: m[2]!.trim() }] : []; });
}
function classifyPhase(title: string): { kind: z.infer<typeof SpeckitPhaseKindSchema>; storyId?: string; priority?: string; mvp: boolean } {
  const mvp = /🎯|\bMVP\b/.test(title);
  const us = /user story\s+(\d+)/i.exec(title);
  if (us) return { kind: 'story', storyId: `US${us[1]}`, priority: /\(priority:\s*([^)]+)\)/i.exec(title)?.[1]?.trim(), mvp };
  if (/setup/i.test(title)) return { kind: 'setup', mvp };
  if (/foundational|blocking/i.test(title)) return { kind: 'foundational', mvp };
  if (/polish|cross-cutting/i.test(title)) return { kind: 'polish', mvp };
  return { kind: 'other', mvp };
}
function parseTaskItem(item: Md): z.infer<typeof SpeckitTaskSchema> | null {
  if (item.checked !== true && item.checked !== false) return null; // a task IS a GFM checkbox item; prose bullets are not tasks
  const txt = itemText(item); const m = /^(T\d+)\s+(.+)$/i.exec(txt); if (!m) return null;
  const rest = m[2]!;
  const storyId = /\[(US\d+)\]/i.exec(rest)?.[1]?.toUpperCase();
  const commit = /\(commit:\s*([0-9a-fA-F]{7,40})\)/i.exec(rest)?.[1]?.toLowerCase();
  const dependsOn = (/\(depends on\s+([^)]+)\)/i.exec(rest)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const title = rest.replace(/\[P\]/gi, '').replace(/\[US\d+\]/gi, '').replace(/\(commit:\s*[0-9a-fA-F]{7,40}\)/gi, '').replace(/\(depends on\s+[^)]+\)/gi, '').replace(/\s+/g, ' ').trim();
  return { id: m[1]!.toUpperCase(), title: title || m[1]!, status: item.checked === true ? 'done' : 'pending', parallel: /\[P\]/i.test(rest), ...(storyId ? { storyId } : {}), ...(commit ? { commit } : {}), dependsOn };
}
function extractPhases(tree: Md) {
  const phases: Array<z.infer<typeof SpeckitPhaseSchema>> = [];
  let cur: z.infer<typeof SpeckitPhaseSchema> | null = null;
  for (const node of tree.children ?? []) {
    if (node.type === 'heading' && (node.depth ?? 0) === 2) { const t = nodeText(node).trim(); const c = classifyPhase(t); cur = { name: t, kind: c.kind, ...(c.storyId ? { storyId: c.storyId } : {}), ...(c.priority ? { priority: c.priority } : {}), mvp: c.mvp, tasks: [] }; phases.push(cur); continue; }
    if (node.type === 'heading') continue;
    if (node.type === 'list') { if (!cur) { cur = { name: 'Tasks', kind: 'other', mvp: false, tasks: [] }; phases.push(cur); } for (const it of node.children ?? []) if (it.type === 'listItem') { const t = parseTaskItem(it); if (t) cur.tasks.push(t); } }
  }
  return phases;
}
function extractStories(tree: Md) {
  const stories: Array<{ id: string; title: string; priority?: string; scenarios: Array<z.infer<typeof SpeckitScenarioSchema>> }> = [];
  let cur: (typeof stories)[number] | null = null; let sIdx = 1;
  for (const node of tree.children ?? []) {
    if (node.type === 'heading') {
      const d = node.depth ?? 0; const h = /^User Story\s+(\d+)\s*-\s*(.+?)(?:\s+\(Priority:\s*([^)]+)\))?$/i.exec(nodeText(node).trim());
      if (h && d <= 3) { cur = { id: `US${h[1]}`, title: h[2]!.trim(), ...(h[3] ? { priority: h[3].trim() } : {}), scenarios: [] }; stories.push(cur); sIdx = 1; }
      else if (d <= 3) cur = null;
      continue;
    }
    if (cur && node.type === 'list') for (const it of node.children ?? []) if (it.type === 'listItem') {
      const txt = itemText(it);
      if (/\bGiven\b.+\bWhen\b.+\bThen\b/i.test(txt)) { cur.scenarios.push({ id: `${cur.id}-S${String(sIdx).padStart(2, '0')}`, text: txt, needsClarification: hasClarification(txt) }); sIdx += 1; }
    }
  }
  return stories;
}
function metaField(tree: Md, label: string): string | undefined {
  const m = new RegExp(`^${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}:\\s*(.+?)\\s*$`, 'im').exec(paragraphsText(tree));
  const v = m?.[1]?.trim();
  if (!v || /^\[.*\]$/.test(v)) return undefined; // skip template placeholders like [DATE]
  return v;
}
function extractPlan(tree: Md | undefined) {
  if (!tree) return { present: false, technicalContext: [], constitutionGates: [], complexity: [] };
  // Technical Context: real spec-kit uses bold-field PARAGRAPHS; templates may use list items
  const tcTexts = [...nodesUnder(tree, /technical context/i).filter((n) => n.type === 'paragraph').map(nodeText), ...textsUnder(tree, /technical context/i)];
  const technicalContext = tcTexts.flatMap((raw) => { const t = raw.trim().replace(/\s+/g, ' '); const m = /^([^:]+):\s*(.+)$/.exec(t); return m && m[2]!.trim() && !/^\[.*\]$/.test(m[2]!.trim()) ? [{ field: m[1]!.trim(), value: m[2]!.trim() }] : []; });
  // Constitution Check: real spec-kit uses a GFM TABLE (Status column ✅ PASS / ❌ FAIL); templates may use checkbox list items
  const gates: Array<{ text: string; passed?: boolean }> = [];
  const table = nodesUnder(tree, /constitution check/i).find((n) => n.type === 'table');
  if (table) {
    const rows = (table.children ?? []).filter((r) => r.type === 'tableRow');
    const header = rows.length ? tableCells(rows[0]!).map((c) => c.toLowerCase()) : [];
    const statusIdx = header.findIndex((c) => /status|result/.test(c));
    for (const row of rows.slice(1)) {
      const c = tableCells(row); const status = statusIdx >= 0 ? (c[statusIdx] ?? '') : c.join(' ');
      gates.push({ text: c[0] || 'gate', passed: /pass|✅/i.test(status) && !/fail|❌/i.test(status) });
    }
  }
  for (const it of listItemsUnder(tree, /constitution check/i)) { const text = itemText(it); gates.push(it.checked === true ? { text, passed: true } : it.checked === false ? { text, passed: false } : { text }); }
  const complexity = textsUnder(tree, /complexity tracking/i);
  return { present: true, technicalContext, constitutionGates: gates, complexity };
}
function extractConstitution(tree: Md | undefined) {
  if (!tree) return { present: false, principles: [] };
  // principles are ### headings under the "## Core Principles" section; other ##
  // sections (Governance, Additional Constraints, …) are NOT principles
  const principles: string[] = []; let inCore = false;
  for (const node of tree.children ?? []) {
    if (node.type !== 'heading') continue;
    const d = node.depth ?? 0; const t = nodeText(node).trim();
    if (d === 2) { inCore = /core principles/i.test(t); continue; }
    if (d === 3 && inCore) principles.push(t);
  }
  return { present: true, principles };
}
function titleFromSpec(tree: Md, slug: string): string {
  const t = (headingsAtDepth(tree, 1)[0] ?? '').replace(/^Feature Specification:\s*/i, '').trim();
  return t && t !== '[FEATURE NAME]' ? t : slug;
}

// One speckit feature = one IssueRecord. The feature's id/title/status come STRUCTURED from the
// record's fields; the multi-file `===FILE===` content (spec.md, tasks.md, plan.md, …) lives in
// `record.body`. File-derived metadata (Feature Branch/Created/Input + the spec's own Status text)
// is parsed from the body and kept in `metadata`, but the issue's LIFECYCLE status is the record's.
function parseOneFeature(record: IssueRecord): Record<string, unknown> {
  const files = splitBundle(record.body).map((f) => ({ ...f, path: norm(f.path) }));
  const specFile = files.find((f) => slugFromSpec(f.path)) ?? files.find((f) => /spec\.md$/.test(f.path)) ?? files[0];
  const slug = (specFile && slugFromSpec(specFile.path)) ?? record.id;
  const find = (re: RegExp) => files.find((f) => re.test(f.path));
  const tasksFile = find(/tasks\.md$/);
  const planFile = find(/plan\.md$/);
  const constitutionFile = find(/constitution\.md$/);
  const specTree = specFile ? parseMd(specFile.content) : parseMd(''); // mdast

  const requirements = extractRequirements(specTree, 'FR');
  const successCriteria = extractRequirements(specTree, 'SC');
  const stories = extractStories(specTree);
  const allPhases = tasksFile ? extractPhases(parseMd(tasksFile.content)) : [];
  const allTasks = allPhases.flatMap((p) => p.tasks);
  const keyEntities = extractEntities(specTree);
  const edgeCases = textsUnder(specTree, /edge cases/i);
  const assumptions = textsUnder(specTree, /assumptions/i);
  const clarifications = textsUnder(specTree, /^clarifications/i).map((text) => ({ text }));

  // story ACs (join spec stories with their [US#] tasks; mvp from the story phase)
  const acs = stories.map((story) => {
    const tasks = allTasks.filter((t) => t.storyId === story.id);
    const phase = allPhases.find((p) => p.kind === 'story' && p.storyId === story.id);
    const done = tasks.length > 0 && tasks.every((t) => t.status === 'done');
    const evidence = tasks.filter((t) => t.status === 'done').map((t) => ({ id: `${story.id}/${t.id}`, task: t.id, ...(t.commit ? { commit: t.commit } : {}) }));
    return {
      id: story.id, status: done ? 'done' : 'pending', evidence, text: story.title,
      ...(story.priority ? { priority: story.priority } : {}), mvp: phase?.mvp ?? false,
      needsClarification: story.scenarios.some((s) => s.needsClarification), scenarios: story.scenarios, tasks,
    };
  });
  const phases = allPhases.filter((p) => p.kind !== 'story'); // non-story phases shown separately

  const metadata = {
    ...(metaField(specTree, 'Feature Branch') ? { featureBranch: metaField(specTree, 'Feature Branch') } : {}),
    ...(metaField(specTree, 'Status') ? { status: metaField(specTree, 'Status') } : {}),
    ...(metaField(specTree, 'Created') ? { created: metaField(specTree, 'Created') } : {}),
    ...(metaField(specTree, 'Input') ? { input: metaField(specTree, 'Input') } : {}),
  };
  const plan = extractPlan(planFile ? parseMd(planFile.content) : undefined);
  const constitution = extractConstitution(constitutionFile ? parseMd(constitutionFile.content) : undefined);
  const artifacts = {
    research: !!find(/research\.md$/), dataModel: !!find(/data-model\.md$/), quickstart: !!find(/quickstart\.md$/),
    contracts: files.filter((f) => /\/contracts\//.test(f.path)).map((f) => f.path),
  };

  // The lifecycle status is the record's column value; fall back to the command pipeline derived
  // from the artifacts when the record carries no explicit status.
  const anyClar = requirements.some((r) => r.needsClarification) || successCriteria.some((c) => c.needsClarification) || acs.some((a) => a.needsClarification);
  const doneStories = acs.filter((a) => a.status === 'done').length;
  let status: string;
  if (record.status) status = record.status;
  else if (anyClar) status = 'specifying';
  else if (!plan.present) status = 'planning';
  else if (!tasksFile) status = 'tasking';
  else if (acs.length > 0 && doneStories === acs.length) status = 'done';
  else status = 'in-progress';

  return {
    id: record.id, title: record.title || (specFile ? titleFromSpec(specTree, slug) : slug), summary: '', status,
    acceptanceCriteria: acs, slug,
    files: { spec: specFile?.path ?? 'spec.md', ...(planFile ? { plan: planFile.path } : {}), ...(tasksFile ? { tasks: tasksFile.path } : {}) },
    metadata, requirements, successCriteria, keyEntities, edgeCases, assumptions, clarifications, phases, plan, constitution, artifacts,
  };
}

// The root: each record is ONE feature. Metadata (id/title/status) is structured; the rest is
// parsed from the record's `===FILE===` body bundle.
export function parseSpeckit(records: IssueRecord[]): unknown {
  return { issues: records.map(parseOneFeature) };
}

// ── rules: declarative records over the engine's derived model ───────────────
// Duplicate ids come from the core model; the cross-collection analyses (clarification
// markers across requirements/success-criteria/stories, the foundational-phase gate, and
// failed constitution gates) are derived here. The rest are per-item scope + predicate.
type SIssue = SpeckitRoot['issues'][number];
type SAC = SIssue['acceptanceCriteria'][number];
type SEvidence = SAC['evidence'][number];

const shaMatches = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

// This preset's derived facts; `facts(m)` is the one place the open `derived` bag is narrowed.
type SpeckitFacts = {
  clarReqs: Array<{ issueId: string; refId: string }>;
  clarSC: Array<{ issueId: string; refId: string }>;
  clarStories: Array<{ issueId: string; acId: string }>;
  foundationalViolations: Array<{ issueId: string; acId: string }>;
  constitutionGateFailures: Array<{ issueId: string; text: string }>;
};
const facts = (m: DerivedModel<SpeckitRoot>): SpeckitFacts => m.derived as unknown as SpeckitFacts;

function deriveSpeckit(model: DerivedModel<SpeckitRoot>): SpeckitFacts {
  const clarReqs: Array<{ issueId: string; refId: string }> = [];
  const clarSC: Array<{ issueId: string; refId: string }> = [];
  const clarStories: Array<{ issueId: string; acId: string }> = [];
  const foundationalViolations: Array<{ issueId: string; acId: string }> = [];
  const constitutionGateFailures: Array<{ issueId: string; text: string }> = [];
  for (const i of model.root.issues) {
    for (const r of i.requirements) if (r.needsClarification) clarReqs.push({ issueId: i.id, refId: r.id });
    for (const c of i.successCriteria) if (c.needsClarification) clarSC.push({ issueId: i.id, refId: c.id });
    for (const a of i.acceptanceCriteria) if (a.needsClarification) clarStories.push({ issueId: i.id, acId: a.id });
    const foundationalPending = i.phases.filter((p) => p.kind === 'foundational').flatMap((p) => p.tasks).some((t) => t.status !== 'done');
    if (foundationalPending) for (const a of i.acceptanceCriteria) if (a.status === 'done') foundationalViolations.push({ issueId: i.id, acId: a.id });
    for (const g of i.plan.constitutionGates) if (g.passed === false) constitutionGateFailures.push({ issueId: i.id, text: g.text });
  }
  return { clarReqs, clarSC, clarStories, foundationalViolations, constitutionGateFailures };
}

const SPECKIT_RULES: Rule<SpeckitRoot>[] = [
  // [NEEDS CLARIFICATION] markers across requirements, success criteria, and stories.
  rule<SpeckitRoot, { issueId: string; refId: string }>({
    code: 'speckit_needs_clarification', select: (m) => facts(m).clarReqs,
    message: ({ refId }) => `${refId} still has an unresolved [NEEDS CLARIFICATION] marker.`,
  }),
  rule<SpeckitRoot, { issueId: string; refId: string }>({
    code: 'speckit_needs_clarification', select: (m) => facts(m).clarSC,
    message: ({ refId }) => `${refId} still has an unresolved [NEEDS CLARIFICATION] marker.`,
  }),
  rule<SpeckitRoot, { issueId: string; acId: string }>({
    code: 'speckit_needs_clarification', select: (m) => facts(m).clarStories,
    message: ({ acId }) => `User story ${acId} has a scenario with an unresolved [NEEDS CLARIFICATION] marker.`,
  }),
  // foundational phase blocks user stories (no story work until foundational is complete).
  rule<SpeckitRoot, { issueId: string; acId: string }>({
    code: 'speckit_story_done_before_foundational', select: (m) => facts(m).foundationalViolations,
    message: ({ acId }) => `User story ${acId} is done but foundational (blocking) tasks are not complete.`,
  }),
  // Constitution Check gate (from plan.md) must pass.
  rule<SpeckitRoot, { issueId: string; text: string }>({
    code: 'speckit_constitution_gate_failed', select: (m) => facts(m).constitutionGateFailures,
    message: ({ text }) => `Constitution Check gate failed: ${text}`,
  }),
  // only meaningful once the feature has reached /tasks (tasks.md exists).
  rule<SpeckitRoot, { issueId: string; acId: string; issue: SIssue; ac: SAC }>({
    code: 'speckit_story_no_tasks', severity: 'warning', select: (m) => m.acs,
    when: ({ issue, ac }) => !!issue.files.tasks && ac.tasks.length === 0,
    message: ({ ac }) => `User story ${ac.id} has no tasks in tasks.md.`,
  }),
  rule<SpeckitRoot, { issueId: string; acId: string; ac: SAC }>({
    code: 'speckit_story_unverified', severity: 'warning', select: (m) => m.acs,
    when: ({ ac }) => ac.status === 'done' && ac.evidence.every((e) => !e.commit),
    message: ({ ac }) => `User story ${ac.id} is done but none of its tasks cite a commit (unverified).`,
  }),
  rule<SpeckitRoot, { issueId: string; acId: string; evidenceId: string; ac: SAC; ev: SEvidence }>({
    code: 'speckit_evidence_commit_not_found', select: (m) => m.evidence,
    when: ({ ev }, m) => { const c = m.context.git?.existingCommits; return !!c && !!ev.commit && !c.some((x) => shaMatches(x, ev.commit!)); },
    message: ({ ac, ev }) => `Task ${ev.task} (story ${ac.id}) cites commit ${ev.commit}, which does not exist.`,
    subject: ({ ev }) => ev.commit ?? '',  // the missing sha — a `ref:` waiver pins to exactly this occurrence
  }),
  // cross-issue: feature ids unique across the framed root.
  rule<SpeckitRoot, { issueId: string }>({
    code: 'speckit_duplicate_feature_id', select: (m) => m.duplicateIssueIds,
    message: ({ issueId }) => `Duplicate feature id ${issueId} in the root.`,
  }),
  rule<SpeckitRoot, { issueId: string; acId: string }>({
    code: 'speckit_duplicate_ac_id', select: (m) => m.duplicateAcIds,
    message: ({ issueId, acId }) => `Duplicate user-story id ${acId} in feature ${issueId}.`,
  }),
  // structural-existence requirements (the parts Spec Kit's process mandates).
  rule<SpeckitRoot, { issueId: string; issue: SIssue }>({
    code: 'speckit_no_user_stories', select: (m) => m.issues,
    when: ({ issue }) => issue.acceptanceCriteria.length === 0,
    message: ({ issue }) => `Feature ${issue.id} has no user stories — the spec's testable deliverable unit.`,
  }),
  rule<SpeckitRoot, { issueId: string; issue: SIssue }>({
    code: 'speckit_no_functional_requirements', select: (m) => m.issues,
    when: ({ issue }) => issue.requirements.length === 0,
    message: ({ issue }) => `Feature ${issue.id} states no functional requirements.`,
  }),
  rule<SpeckitRoot, { issueId: string; acId: string; ac: SAC }>({
    code: 'speckit_story_no_scenarios', severity: 'warning', select: (m) => m.acs,
    when: ({ ac }) => ac.scenarios.length === 0,
    message: ({ ac }) => `User story ${ac.id} has no acceptance scenarios (not independently testable).`,
  }),
  rule<SpeckitRoot, { issueId: string; issue: SIssue }>({
    code: 'speckit_no_success_criteria', severity: 'warning', select: (m) => m.issues,
    when: ({ issue }) => issue.successCriteria.length === 0,
    message: ({ issue }) => `Feature ${issue.id} has no measurable success criteria.`,
  }),
  rule<SpeckitRoot, { issueId: string; issue: SIssue }>({
    code: 'speckit_no_constitution', severity: 'warning', select: (m) => m.issues,
    when: ({ issue }) => !issue.constitution.present,
    message: () => `No constitution (.specify/memory/constitution.md) — the /constitution step is missing.`,
  }),
  rule<SpeckitRoot, { issueId: string; issue: SIssue }>({
    code: 'speckit_plan_no_constitution_check', severity: 'warning', select: (m) => m.issues,
    when: ({ issue }) => issue.plan.present && issue.plan.constitutionGates.length === 0,
    message: () => `plan.md has no Constitution Check gate (mandatory in the plan template).`,
  }),
  // once implementing (tasks exist), a plan must exist (/plan precedes /tasks).
  rule<SpeckitRoot, { issueId: string; issue: SIssue }>({
    code: 'speckit_tasks_without_plan', select: (m) => m.issues,
    when: ({ issue }) => !!issue.files.tasks && !issue.plan.present,
    message: ({ issue }) => `Feature ${issue.id} has tasks.md but no plan.md — /plan must precede /tasks.`,
  }),
];

// ── the dashboard's vocabulary (VIZ-2), as plain data ────────────────────────────────────────
// Minimal by design: speckit's issue panels (stories, requirements, phases/tasks, plan gates,
// artifacts — everything SpeckitIssueSchema carries beyond the AC unit) are irreducible RENDER
// logic, not field references, so they stay CODE on the shared code-extension contract
// (VIZ-4/VIZ-13), not this data contract. This block supplies only what the vocabulary CAN
// express: the status column order and what an AC unit is called here (a user story, not a "dev
// AC"). Installed into your repo verbatim: keep statusOrder in sync with SpeckitIssueStatusSchema
// above (`boilerplates/presets/visualizerVocabulary.test.ts` checks that).
const SPECKIT_VISUALIZER: VisualizerSpec = {
  statusOrder: ['specifying', 'planning', 'tasking', 'in-progress', 'done'], // must equal SpeckitIssueStatusSchema above
  acUnitLabel: 'User Stories',
  // no assignee/pr/acText/acProof/acEvidence: this preset's richer shape (stories, tasks,
  // FR/SC, plan gates) is rendered by the code seam (VIZ-4/VIZ-13), not this data mapping.
};

export const SpeckitPreset: Preset<SpeckitRoot> = {
  name: 'speckit',
  schema: SpeckitRootSchema,
  visualizer: SPECKIT_VISUALIZER,
  // observed facts: commit existence for task verification (no PR model).
  loadContext: (input) => gitWorld(input.projectRoot, [], { verifyCommits: input.verifyCommits }),
  // `ztrack issue scaffold` starter — a minimal Spec-Kit feature shape (real features usually
  // come from Spec-Kit tooling). Fill in stories/requirements/tasks; cite `(commit: <sha>)` on tasks.
  scaffold: (title) => `# ${title}\n\n**Status**: Draft\n\n## User Scenarios & Testing\n\n### User Story 1 - Describe it (Priority: P1)\n\nAs a user, I can do something valuable.\n\n## Requirements\n\n### Functional Requirements\n\n- **FR-001**: The system MUST do something concrete.\n\n## Tasks\n\n## Phase 1: User Story 1 (Priority: P1)\n\n- [ ] T001 [US1] Implement the first task.\n`,
  parse: parseSpeckit,
  derive: deriveSpeckit,
  rules: SPECKIT_RULES,
  // audit is core/always-on (recorded automatically via change observation), so
  // it is NOT declared here; speckit implements none of the OPT-IN primitives.
  primitives: { proof: false, category: false, labels: false, relations: false, children: false, sources: false },
};

// The installed entrypoint: the resolver reads the preset off `default`.
export default SpeckitPreset;

export function checkSpeckit(records: IssueRecord[], ctx?: Context) {
  return runCheck(SpeckitPreset, records, ctx);
}
