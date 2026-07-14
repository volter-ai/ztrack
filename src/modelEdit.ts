// The architecture's only sanctioned writer is a preset's `serialize` (the declared inverse
// of `parse`). A "mutation" is therefore not a subsystem — it is exactly:
//
//     parse(records) -> edit the typed model -> serialize -> { body, columns }
//
// This module holds that one grammar-FREE operation over a single issue's structured record.
// It overlays a typed fragment onto the issue (or one AC, by id), re-validates against the
// preset's hard schema, and renders it back to its STORED form: the content `body` plus the
// metadata `columns`. No preset grammar lives here: the patch is the SCHEMA shape, never
// markdown, and only the preset turns it back into text + columns.
//
// One core concern the preset's serialize does NOT cover: the universal `## Waivers` section.
// Waivers are core-parsed (not part of any preset schema), so serialize drops them — the CORE
// carries that section verbatim across a model round-trip here.
import { liftDiagnostics } from './core/engine.ts';
import type { CoreRoot, IssueColumns, IssueRecord, Preset } from './core/engine.ts';
import { describePatchIssue } from './zodPatchErrors.ts';

export type ModelPatch = {
  acId?: string;                  // target one AC by id; omit to overlay the issue itself
  patch: Record<string, unknown>; // schema-shaped fields, overlaid per top-level key (arrays replace)
};

export type ModelEditResult = { body: string; columns: IssueColumns; changed: boolean };

// The universal `## Waivers` section (see engine.parseWaivers) — carried verbatim, since it is
// core markdown outside the preset schema.
const WAIVERS_SECTION_RE = /(?:^|\n)(##\s+waivers\b[\s\S]*?)(?=\n#{1,6}\s|$)/i;
function extractWaiversSection(body: string): string | null {
  const m = WAIVERS_SECTION_RE.exec(body);
  return m ? m[1]!.trim() : null;
}
function withWaivers(serialized: string, waiversSection: string | null): string {
  if (!waiversSection) return serialized;
  return `${serialized.replace(/\n+$/, '')}\n\n${waiversSection}\n`;
}

function requireWritable(preset: Preset<CoreRoot>): void {
  if (!preset.serialize) {
    throw new Error(`the '${preset.name}' preset is read-only (it adapts an external source-of-truth and defines no serialize); its issues cannot be written through ztrack — edit the source it reads instead.`);
  }
}

function parseOneIssue(preset: Preset<CoreRoot>, record: IssueRecord, verb: string): CoreRoot {
  // Parse diagnostics are advisory (`ztrack check` surfaces them); the edit path only needs the
  // model. Strip the side-channel before the strict schema sees it, or a mere warning-shaped
  // body (say, a stray checkbox outside the AC section) would block ac patch/issue edit.
  const lifted = liftDiagnostics(preset.parse([record]));
  // ZTB-15 FAIL-CLOSED GUARD: `ac_prose_in_section` marks content inside a recognized "##
  // Acceptance Criteria" section that has no place in the model (a bare paragraph/blockquote/
  // plain list item — not a checkbox AC line). A preset's `serialize` rebuilds the AC section
  // purely from the model (boilerplates/presets/simple-sdlc.ts's/simple-gh-sdlc.ts's
  // `serializeIssue`), so writing this issue back would silently DROP that content on the very
  // next splice — the same defect class ZTB-10 fixed for bare leading prose, but here the prose
  // can sit anywhere between/around AC list items (not just once, before the first "## "
  // heading), so there is no single position-preserving field to carry it in without a much
  // larger model change. Chosen fix (documented per the work order): fail closed instead — refuse
  // the write with a clear error naming the prose (the diagnostic's own message, which already
  // names the issue, an excerpt, and the line) — nothing is written, matching every other
  // document-source guard's "nothing written on refusal" contract. This is the ONE choke point
  // every writer (`ac patch`/`issue patch`/`fmt`) funnels through, regardless of backend
  // (issue-per-file or document source), so it catches the hazard before any splice is attempted.
  const prose = lifted.findings.find((f) => f.code === 'ac_prose_in_section' && f.issueId === record.id);
  if (prose) throw new Error(`cannot ${verb}: ${prose.message}`);
  const parsed = preset.schema.safeParse(lifted.root);
  if (!parsed.success) {
    throw new Error(`cannot ${verb}: issue ${record.id} does not parse against the '${preset.name}' grammar (run 'ztrack check' to see why).`);
  }
  const root = parsed.data as CoreRoot;
  if (root.issues.length !== 1) throw new Error(`expected exactly one issue, found ${root.issues.length}.`);
  return root;
}

function render(preset: Preset<CoreRoot>, root: CoreRoot, record: IssueRecord): ModelEditResult {
  const out = preset.serialize!(root.issues[0]!);
  const body = withWaivers(out.body, extractWaiversSection(record.body));
  const c = out.columns;
  const changed = body !== record.body
    || (c.title !== undefined && c.title !== record.title)
    || (c.status !== undefined && c.status !== record.status)
    || ((c.assignee ?? '') !== (record.assignee ?? ''))
    || (c.labels !== undefined && c.labels.join('\x00') !== (record.labels ?? []).join('\x00'));
  return { body, columns: c, changed };
}

/** Overlay a typed fragment onto an issue (or one AC) and re-serialize to { body, columns }. */
export function applyModelPatch(preset: Preset<CoreRoot>, record: IssueRecord, edit: ModelPatch): ModelEditResult {
  requireWritable(preset);
  const root = parseOneIssue(preset, record, 'edit');
  const issue = root.issues[0]! as unknown as Record<string, unknown>;
  if (edit.acId) {
    const acs = (issue.acceptanceCriteria ?? []) as Array<Record<string, unknown>>;
    const ac = acs.find((a) => String(a.id) === edit.acId);
    if (!ac) throw new Error(`AC ${edit.acId} not found in ${record.id}.`);
    // ztrack#22: let the preset keep its internally-coupled AC fields consistent (e.g. sync the
    // `checked` checkbox mirror when a patch sets `status` alone) before the overlay. The hook
    // sees the current AC read-only and returns the fragment to apply; an explicit field in the
    // caller's patch always wins inside the shipped implementations.
    const patch = preset.normalizeAcPatch ? preset.normalizeAcPatch(edit.patch, { ...ac }) : edit.patch;
    Object.assign(ac, patch);
  } else {
    Object.assign(issue, edit.patch);
  }
  // Re-validate: a patch that violates the hard schema (a status outside the enum, a malformed
  // evidence object) fails loudly here rather than producing a body that silently misparses.
  // ZTB-21 dev/01: each issue is described via describePatchIssue, which reads the shape a
  // nested field (e.g. `proof`) actually requires off the SAME zod schema — so the first shape
  // error already states the full contract instead of drip-feeding it across attempts.
  const revalidated = preset.schema.safeParse(root);
  if (!revalidated.success) {
    const detail = revalidated.error.issues.map((i) => describePatchIssue(preset.schema, i)).join('; ');
    throw new Error(`patch produces an invalid '${preset.name}' issue: ${detail}`);
  }
  return render(preset, revalidated.data as CoreRoot, record);
}

/** `fmt`: the preset's own round-trip, parse -> serialize, preserving the `## Waivers` section. */
export function canonicalizeBody(preset: Preset<CoreRoot>, record: IssueRecord): ModelEditResult {
  requireWritable(preset);
  return render(preset, parseOneIssue(preset, record, 'canonicalize'), record);
}
