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

import { z } from 'zod';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { check as runCheck, type Context, type Finding, type Preset, type Rule } from '../core/engine.ts';

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
  return fromMarkdown(content, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Md;
}
function nodeText(n: Md): string { return typeof n.value === 'string' ? n.value : (n.children ?? []).map(nodeText).join(''); }
function itemText(item: Md): string { const p = (item.children ?? []).find((c) => c.type === 'paragraph'); return p ? nodeText(p).trim() : ''; }
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

export function parseSpeckit(bundle: string): unknown {
  const files = splitBundle(bundle).map((f) => ({ ...f, path: norm(f.path) }));
  const specFile = files.find((f) => slugFromSpec(f.path)) ?? files.find((f) => /spec\.md$/.test(f.path)) ?? files[0];
  if (!specFile) return { issues: [] };
  const slug = slugFromSpec(specFile.path) ?? (specFile.path.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'feature');
  const find = (re: RegExp) => files.find((f) => re.test(f.path));
  const tasksFile = find(/tasks\.md$/);
  const planFile = find(/plan\.md$/);
  const constitutionFile = find(/constitution\.md$/);
  const specTree = parseMd(specFile.content); // mdast

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

  const anyClar = requirements.some((r) => r.needsClarification) || successCriteria.some((c) => c.needsClarification) || acs.some((a) => a.needsClarification);
  const doneStories = acs.filter((a) => a.status === 'done').length;
  let status: string;
  if (anyClar) status = 'specifying';
  else if (!plan.present) status = 'planning';
  else if (!tasksFile) status = 'tasking';
  else if (acs.length > 0 && doneStories === acs.length) status = 'done';
  else status = 'in-progress';

  return {
    issues: [{
      id: slug, title: titleFromSpec(specTree, slug), summary: '', status,
      acceptanceCriteria: acs, slug,
      files: { spec: specFile.path, ...(planFile ? { plan: planFile.path } : {}), ...(tasksFile ? { tasks: tasksFile.path } : {}) },
      metadata, requirements, successCriteria, keyEntities, edgeCases, assumptions, clarifications, phases, plan, constitution, artifacts,
    }],
  };
}

// ── rules ────────────────────────────────────────────────────────────────────
const needsClarification: Rule<SpeckitRoot> = {
  name: 'speckit_needs_clarification',
  run: (root) => root.issues.flatMap((i): Finding[] => [
    ...i.requirements.filter((r) => r.needsClarification).map((r): Finding => ({ code: 'speckit_needs_clarification', severity: 'error', message: `${r.id} still has an unresolved [NEEDS CLARIFICATION] marker.`, issueId: i.id })),
    ...i.successCriteria.filter((c) => c.needsClarification).map((c): Finding => ({ code: 'speckit_needs_clarification', severity: 'error', message: `${c.id} still has an unresolved [NEEDS CLARIFICATION] marker.`, issueId: i.id })),
    ...i.acceptanceCriteria.filter((a) => a.needsClarification).map((a): Finding => ({ code: 'speckit_needs_clarification', severity: 'error', message: `User story ${a.id} has a scenario with an unresolved [NEEDS CLARIFICATION] marker.`, issueId: i.id, acId: a.id })),
  ]),
};
// foundational phase blocks user stories (Spec Kit: no story work until foundational is complete)
const foundationalBlocksStories: Rule<SpeckitRoot> = {
  name: 'speckit_foundational_blocks_stories',
  run: (root) => root.issues.flatMap((i) => {
    const foundationalPending = i.phases.filter((p) => p.kind === 'foundational').flatMap((p) => p.tasks).some((t) => t.status !== 'done');
    if (!foundationalPending) return [];
    return i.acceptanceCriteria.filter((a) => a.status === 'done').map((a): Finding => ({
      code: 'speckit_story_done_before_foundational', severity: 'error', message: `User story ${a.id} is done but foundational (blocking) tasks are not complete.`, issueId: i.id, acId: a.id,
    }));
  }),
};
// Constitution Check gate (from plan.md) must pass
const constitutionCheck: Rule<SpeckitRoot> = {
  name: 'speckit_constitution_check',
  run: (root) => root.issues.flatMap((i) => i.plan.constitutionGates.filter((g) => g.passed === false).map((g): Finding => ({
    code: 'speckit_constitution_gate_failed', severity: 'error', message: `Constitution Check gate failed: ${g.text}`, issueId: i.id,
  }))),
};
// only meaningful once the feature has reached /tasks (tasks.md exists)
const storyHasTasks: Rule<SpeckitRoot> = {
  name: 'speckit_story_has_tasks',
  run: (root) => root.issues.filter((i) => i.files.tasks).flatMap((i) => i.acceptanceCriteria.filter((a) => a.tasks.length === 0).map((a): Finding => ({
    code: 'speckit_story_no_tasks', severity: 'warning', message: `User story ${a.id} has no tasks in tasks.md.`, issueId: i.id, acId: a.id,
  }))),
};
const storyVerified: Rule<SpeckitRoot> = {
  name: 'speckit_story_verified',
  run: (root) => root.issues.flatMap((i) => i.acceptanceCriteria.filter((a) => a.status === 'done' && a.evidence.every((e) => !e.commit)).map((a): Finding => ({
    code: 'speckit_story_unverified', severity: 'warning', message: `User story ${a.id} is done but none of its tasks cite a commit (unverified).`, issueId: i.id, acId: a.id,
  }))),
};
const evidenceCommitExists: Rule<SpeckitRoot> = {
  name: 'speckit_evidence_commit_exists',
  run: (root, ctx) => {
    const commits = ctx.git?.existingCommits; if (!commits) return [];
    const ok = (sha: string) => commits.some((c) => c.startsWith(sha) || sha.startsWith(c));
    return root.issues.flatMap((i) => i.acceptanceCriteria.flatMap((a) => a.evidence.filter((e) => e.commit && !ok(e.commit)).map((e): Finding => ({
      code: 'speckit_evidence_commit_not_found', severity: 'error', message: `Task ${e.task} (story ${a.id}) cites commit ${e.commit}, which does not exist.`, issueId: i.id, acId: a.id, evidenceId: e.id,
    }))));
  },
};

// ── structural-existence requirements (the parts Spec Kit's process mandates) ─
const requireUserStories: Rule<SpeckitRoot> = {
  name: 'speckit_require_user_stories',
  run: (root) => root.issues.filter((i) => i.acceptanceCriteria.length === 0).map((i): Finding => ({
    code: 'speckit_no_user_stories', severity: 'error', message: `Feature ${i.id} has no user stories — the spec's testable deliverable unit.`, issueId: i.id,
  })),
};
const requireRequirements: Rule<SpeckitRoot> = {
  name: 'speckit_require_requirements',
  run: (root) => root.issues.filter((i) => i.requirements.length === 0).map((i): Finding => ({
    code: 'speckit_no_functional_requirements', severity: 'error', message: `Feature ${i.id} states no functional requirements.`, issueId: i.id,
  })),
};
const requireScenarios: Rule<SpeckitRoot> = {
  name: 'speckit_require_scenarios',
  run: (root) => root.issues.flatMap((i) => i.acceptanceCriteria.filter((a) => a.scenarios.length === 0).map((a): Finding => ({
    code: 'speckit_story_no_scenarios', severity: 'warning', message: `User story ${a.id} has no acceptance scenarios (not independently testable).`, issueId: i.id, acId: a.id,
  }))),
};
const requireSuccessCriteria: Rule<SpeckitRoot> = {
  name: 'speckit_require_success_criteria',
  run: (root) => root.issues.filter((i) => i.successCriteria.length === 0).map((i): Finding => ({
    code: 'speckit_no_success_criteria', severity: 'warning', message: `Feature ${i.id} has no measurable success criteria.`, issueId: i.id,
  })),
};
const requireConstitution: Rule<SpeckitRoot> = {
  name: 'speckit_require_constitution',
  run: (root) => root.issues.filter((i) => !i.constitution.present).map((i): Finding => ({
    code: 'speckit_no_constitution', severity: 'warning', message: `No constitution (.specify/memory/constitution.md) — the /constitution step is missing.`, issueId: i.id,
  })),
};
const requireConstitutionCheck: Rule<SpeckitRoot> = {
  name: 'speckit_require_constitution_check',
  run: (root) => root.issues.filter((i) => i.plan.present && i.plan.constitutionGates.length === 0).map((i): Finding => ({
    code: 'speckit_plan_no_constitution_check', severity: 'warning', message: `plan.md has no Constitution Check gate (mandatory in the plan template).`, issueId: i.id,
  })),
};
// once implementing (tasks exist), a plan must exist (Spec Kit: /plan precedes /tasks)
const requirePlanBeforeTasks: Rule<SpeckitRoot> = {
  name: 'speckit_require_plan_before_tasks',
  run: (root) => root.issues.filter((i) => i.files.tasks && !i.plan.present).map((i): Finding => ({
    code: 'speckit_tasks_without_plan', severity: 'error', message: `Feature ${i.id} has tasks.md but no plan.md — /plan must precede /tasks.`, issueId: i.id,
  })),
};

export const SpeckitPreset: Preset<SpeckitRoot> = {
  name: 'speckit',
  schema: SpeckitRootSchema,
  parse: parseSpeckit,
  rules: [
    needsClarification, foundationalBlocksStories, constitutionCheck, storyHasTasks, storyVerified, evidenceCommitExists,
    requireUserStories, requireRequirements, requireScenarios, requireSuccessCriteria, requireConstitution, requireConstitutionCheck, requirePlanBeforeTasks,
  ],
  // audit is core/always-on (recorded automatically via change observation), so
  // it is NOT declared here; speckit implements none of the OPT-IN primitives.
  primitives: { proof: false, category: false, labels: false, relations: false, linkedIssues: false, children: false, sources: false },
};

export function checkSpeckit(bundle: string, ctx?: Context) {
  return runCheck(SpeckitPreset, bundle, ctx);
}
