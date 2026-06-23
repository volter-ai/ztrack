// The architecture's only sanctioned writer is a preset's `serialize` (the declared
// inverse of `parse`). A "mutation" is therefore not a subsystem — it is exactly:
//
//     parse(markdown) -> edit the typed model -> serialize -> markdown
//
// This module holds that one grammar-FREE operation. It overlays a typed fragment onto
// an issue (or one of its acceptance criteria, addressed by id), re-validates the result
// against the preset's hard schema, and renders it back through the preset's serialize.
// No preset grammar lives here: the patch is the SCHEMA shape, never markdown, and only
// the preset turns it back into text. A read-only adapter preset (no serialize) cannot be
// written — the same boundary `fmt` observes.
//
// One core concern the preset's serialize does NOT cover: the universal `## Waivers`
// section. Waivers are core-parsed (not part of any preset schema), so serialize drops
// them — the CORE must carry that section verbatim across a model round-trip, which it
// does here.
import { splitIssueBundle } from './core/bundle.ts';
import type { CoreRoot, Preset } from './core/engine.ts';

export type ModelPatch = {
  acId?: string;                  // target one AC by id; omit to overlay the issue itself
  patch: Record<string, unknown>; // schema-shaped fields, overlaid per top-level key (arrays replace)
};

export type ModelPatchResult = { body: string; changed: boolean };

// The universal `## Waivers` section (see engine.parseWaivers) — carried verbatim, since
// it is core markdown outside the preset schema.
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

function parseOneIssue(preset: Preset<CoreRoot>, body: string, verb: string): CoreRoot {
  const parsed = preset.schema.safeParse(preset.parse(body));
  if (!parsed.success) {
    throw new Error(`cannot ${verb}: the issue body does not parse against the '${preset.name}' grammar (run 'ztrack check' to see why).`);
  }
  const root = parsed.data as CoreRoot;
  if (root.issues.length !== 1) throw new Error(`expected exactly one issue, found ${root.issues.length}.`);
  return root;
}

/** Overlay a typed fragment onto an issue (or one AC) and re-serialize via the preset. */
export function applyModelPatch(preset: Preset<CoreRoot>, body: string, edit: ModelPatch): ModelPatchResult {
  requireWritable(preset);
  const root = parseOneIssue(preset, body, 'edit');
  const issue = root.issues[0]! as unknown as Record<string, unknown>;
  if (edit.acId) {
    const acs = (issue.acceptanceCriteria ?? []) as Array<Record<string, unknown>>;
    const ac = acs.find((a) => String(a.id) === edit.acId);
    if (!ac) throw new Error(`AC ${edit.acId} not found in the issue.`);
    Object.assign(ac, edit.patch);
  } else {
    Object.assign(issue, edit.patch);
  }
  // Re-validate the whole root: a patch that violates the hard schema (a status outside
  // the enum, a malformed evidence object) fails loudly here rather than producing a body
  // that silently misparses.
  const revalidated = preset.schema.safeParse(root);
  if (!revalidated.success) {
    const detail = revalidated.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`patch produces an invalid '${preset.name}' issue: ${detail}`);
  }
  const newBody = withWaivers(preset.serialize!(revalidated.data), extractWaiversSection(body));
  return { body: newBody, changed: newBody !== body };
}

/** `fmt`: the preset's own round-trip, parse -> serialize, per issue, preserving waivers. */
export function canonicalizeBody(preset: Preset<CoreRoot>, body: string): string {
  requireWritable(preset);
  // Canonicalize each issue independently so a multi-issue bundle keeps each issue's own
  // `## Waivers` section attached to the right issue.
  return splitIssueBundle(body)
    .map(({ body: issueBody }) => {
      const root = parseOneIssue(preset, issueBody, 'canonicalize');
      return withWaivers(preset.serialize!(root), extractWaiversSection(issueBody));
    })
    .join('\n');
}
