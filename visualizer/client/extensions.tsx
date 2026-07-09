// VIZ-4: the (data + code) extension seam. Two layers merge into one effective, per-render
// extension:
//
//  - DATA layer: the preset's own `visualizer` block (VIZ-1/VIZ-2), shipped validated in the
//    `/api/board` payload (VIZ-3). `buildEffectiveExtension` below turns the field-name mappings
//    (assignee/pr/acText/acProof/acEvidence) into render functions purely by field lookup —
//    no code, no template language, matching the data channel's hard boundary.
//  - CODE layer: a first-party `client/presets/<name>.tsx` module (irreducible render logic,
//    e.g. speckit's issue panels) that self-REGISTERS via `registerExtension` below when the
//    generated bundle entry (server.ts, VIZ-4) imports it. NO hardcoded name->extension map
//    here — that was the banned pattern (docs/PRESETS.md, the dead `default` key) this task
//    kills. VIZ-13 will register a repo-local extension into the SAME registry, layered on top.
//
// Precedence: a code member wins where present (VIZ-14's contract), else the data-derived
// member, else undefined (core renders its own fallback, e.g. bare AC id).
import type { ReactNode } from 'react';
import type { CoreAC, CoreIssue, Payload, VisualizerAcEvidence, VisualizerAcProof, VisualizerAcText, VisualizerExtension, VisualizerPr, VisualizerSpec } from './model';

// The render-only extension contract lives in `model.ts` beside the other wire mirrors (where
// `src/visualizerKit.test.ts`'s Equals guard can reach it) — re-exported here so extension
// modules (`presets/*.tsx`) keep importing it from the seam they register into.
export type { VisualizerExtension } from './model';

// The one merged shape every render call site in main.tsx consumes — replaces the old
// `PresetExtension`. `statusOrder`/`acUnitLabel`/`assignee`/`pr` are DATA-only (the code
// extension contract deliberately excludes vocabulary/field-mapping members, VIZ-14); the rest
// merge code-over-data.
export interface EffectiveExtension {
  statusOrder: string[];
  acUnitLabel?: string;
  statusClass?(status: string): string;
  assignee?(issue: CoreIssue): string | undefined;
  pr?(issue: CoreIssue): { url: string } | undefined;
  acText?(ac: CoreAC): ReactNode;
  acProof?(ac: CoreAC): ReactNode;
  acEvidence?(ac: CoreAC, projectUrl: (path: string) => string): ReactNode;
  issuePanels?(issue: CoreIssue, projectUrl: (path: string) => string): ReactNode;
}

// ── the registry (no central list) ──────────────────────────────────────────────────────────
const registry = new Map<string, VisualizerExtension>();

/** Called by the generated bundle entry (server.ts, VIZ-4) once per discovered
 *  `client/presets/<name>.tsx` module — filename is the canonical preset name. VIZ-13 calls
 *  this again for the repo-local extension, registered under the running preset's own name so
 *  it layers over (not replaces) a first-party entry: repeat registration merges PER MEMBER
 *  (registration order = precedence, later wins where present), so a repo extension defining
 *  only `issuePanels` on a speckit repo keeps speckit's shipped `acText`/`acEvidence` — the
 *  spec's pinned data < first-party < repo precedence is per member, not per object. */
export function registerExtension(name: string, ext: VisualizerExtension): void {
  registry.set(name, { ...registry.get(name), ...ext });
}

function codeExtensionFor(presetName: string): VisualizerExtension | undefined {
  return registry.get(presetName);
}

// ── data layer: field-mapped renderers from the preset's own `visualizer` block ────────────
function fieldValue<T = unknown>(obj: unknown, field: string): T | undefined {
  return (obj as Record<string, unknown> | null | undefined)?.[field] as T | undefined;
}

function dataAssignee(field?: string): ((issue: CoreIssue) => string | undefined) | undefined {
  if (!field) return undefined;
  return (issue) => fieldValue<string>(issue, field);
}

function dataPr(pr?: VisualizerPr): ((issue: CoreIssue) => { url: string } | undefined) | undefined {
  if (!pr) return undefined;
  return (issue) => {
    const obj = fieldValue<Record<string, unknown>>(issue, pr.field);
    const url = obj ? fieldValue<string>(obj, pr.urlField) : undefined;
    return url ? { url } : undefined;
  };
}

function dataAcText(spec?: VisualizerAcText): ((ac: CoreAC) => ReactNode) | undefined {
  if (!spec) return undefined;
  return (ac) => {
    const id = fieldValue<string>(ac, spec.id);
    const text = fieldValue<string>(ac, spec.text);
    const version = spec.version ? fieldValue(ac, spec.version) : undefined;
    return (
      <>
        <strong>{id}</strong> {text}
        {version !== undefined && <span className="ver">v{String(version)}</span>}
      </>
    );
  };
}

function dataAcProof(spec?: VisualizerAcProof): ((ac: CoreAC) => ReactNode) | undefined {
  if (!spec) return undefined;
  return (ac) => {
    const proof = fieldValue<Record<string, unknown>>(ac, spec.field);
    if (!proof) return null;
    const explanation = fieldValue<string>(proof, spec.explanation);
    const refs = fieldValue<string[]>(proof, spec.evidenceRefs);
    return (
      <div className="ac-proof">
        <span className="proof-tag">proof</span>
        <span className="proof-text">{explanation}</span>
        {refs && refs.length > 0 && <span className="proof-refs">{refs.join(', ')}</span>}
      </div>
    );
  };
}

function dataAcEvidence(spec?: VisualizerAcEvidence): ((ac: CoreAC, projectUrl: (path: string) => string) => ReactNode) | undefined {
  if (!spec) return undefined;
  return (ac, projectUrl) => {
    const arr = fieldValue<Array<Record<string, unknown>>>(ac, spec.field) ?? [];
    if (arr.length === 0) return null;
    return (
      <div className="evidence-paths">
        {arr.map((e) => {
          const image = fieldValue<string>(e, spec.image);
          const commit = fieldValue<string>(e, spec.commit);
          const acVersion = fieldValue(e, spec.acVersion);
          const id = fieldValue<string>(e, 'id') ?? '';
          return (
            <a className="evidence-thumb evidence-screenshot" href={image ? projectUrl(image) : '#'} target="_blank" rel="noreferrer" key={id}>
              {image && <img src={projectUrl(image)} alt={id} loading="lazy" />}
              <code>{id} · {commit?.slice(0, 7)} · acv{String(acVersion ?? '')}</code>
            </a>
          );
        })}
      </div>
    );
  };
}

function dataStatusClass(map?: Record<string, string>): (status: string) => string {
  return (status) => map?.[status] ?? status;
}

/** Observed-status fallback (VIZ-4 dev/04): when the preset declares no `visualizer` block (or
 *  it failed validation, VIZ-3), derive the status set from the issues themselves, in FIRST-SEEN
 *  order — no vocabulary is invented, no alphabetical re-sort. */
function firstSeenStatuses(issues: CoreIssue[]): string[] {
  const seen: string[] = [];
  for (const i of issues) if (!seen.includes(i.status)) seen.push(i.status);
  return seen;
}

export const UPGRADE_NOTICE = 'vocabulary not declared — run ztrack preset upgrade';

/** Build the one effective extension a render pass uses, from the wire payload. Returns the
 *  merged extension plus a one-line `notice` (VIZ-4 dev/04): null while the vocabulary is
 *  present and valid; the shipped `visualizerError` text when the block was invalid; the
 *  upgrade notice when the preset declares none at all. `payload` may be null before the first
 *  successful fetch — in that transient state there is nothing to report yet. */
export function buildEffectiveExtension(payload: Payload | null): { ext: EffectiveExtension; notice: string | null } {
  const issues = payload?.issues ?? [];
  const spec: VisualizerSpec | null = payload?.visualizer ?? null;
  const codeExt = payload ? codeExtensionFor(payload.preset) : undefined;
  const notice = !payload ? null : spec ? null : (payload.visualizerError ?? UPGRADE_NOTICE);
  const ext: EffectiveExtension = {
    statusOrder: spec?.statusOrder ?? firstSeenStatuses(issues),
    acUnitLabel: spec?.acUnitLabel,
    statusClass: codeExt?.statusClass ?? dataStatusClass(spec?.statusClass),
    assignee: dataAssignee(spec?.assignee),
    pr: dataPr(spec?.pr),
    acText: codeExt?.acText ?? dataAcText(spec?.acText),
    acProof: codeExt?.acProof ?? dataAcProof(spec?.acProof),
    acEvidence: codeExt?.acEvidence ?? dataAcEvidence(spec?.acEvidence),
    issuePanels: codeExt?.issuePanels,
  };
  return { ext, notice };
}
