// VIZ-14 dev/03 — DRIFT GUARD BY CONSTRUCTION, made executable: `VisualizerExtension` must
// never gain `statusOrder`/`acUnitLabel`/field-mapping members (that vocabulary is layer-1 DATA
// in `preset.mts`, VIZ-1 — see the "DRIFT GUARD BY CONSTRUCTION" comment in `visualizerKit.ts`).
// A `@ts-expect-error` fails `npm run typecheck` ("unused '@ts-expect-error' directive") the
// moment the excluded member becomes assignable again — i.e. the moment the interface regains
// it — and the runtime key-list assertion pins the exact member SET for a fully-populated
// extension, so the accompanying prose can't drift from what the type actually allows.
//
// Also carries the VIZ-14 model.ts/visualizerKit.ts `Payload` mutual-assignability guard: see
// the "the wire payload" comment block in `visualizerKit.ts` for why `visualizer/client/
// model.ts` keeps its own hand-mirrored `Payload` instead of a type-only import, and why this
// guard is the drift backstop for that choice.
import { describe, expect, test } from 'bun:test';
import { defineVisualizerExtension, type VisualizerExtension, type Payload as KitPayload } from './visualizerKit.ts';
import type { Payload as ClientPayload, VisualizerExtension as ClientVisualizerExtension } from '../visualizer/client/model.ts';

// Standard two-way conditional-type equality check (the common `Equals<A, B>` idiom): distinct
// only when A and B are NOT mutually assignable in both the "extends" and "not extends" sense
// for every possible probe type T.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// If `model.ts`'s hand mirror and `visualizerKit.ts`'s authoritative `Payload` ever diverge,
// this line stops compiling (`Equals<KitPayload, ClientPayload>` becomes `false`, which is not
// assignable to `true`) and `npm run typecheck` fails.
const payloadShapesMatch: Equals<KitPayload, ClientPayload> = true;
void payloadShapesMatch;

// VIZ-4's client-side `VisualizerExtension` mirror (`visualizer/client/model.ts`) gets the SAME
// executable guard as `Payload` above — the client tree cannot type-import the kit's copy (its
// tsconfig has no "node" ambient types; visualizerKit.ts transitively imports `node:crypto` via
// src/core/engine.ts), so it hand-mirrors, and this line is what keeps the two copies from
// silently diverging: any member added/removed/re-signatured on one side but not the other makes
// `Equals<...>` become `false` and `npm run typecheck` fails. (This guard must live HERE, not in
// visualizer/client test files — those are excluded from every tsconfig and would be inert.)
const extensionShapesMatch: Equals<VisualizerExtension, ClientVisualizerExtension> = true;
void extensionShapesMatch;

describe('VisualizerExtension — render-only surface (VIZ-14 dev/03)', () => {
  test('defineVisualizerExtension is the identity helper', () => {
    const ext: VisualizerExtension = { statusClass: (s) => s };
    expect(defineVisualizerExtension(ext)).toBe(ext);
  });

  test('an empty extension is valid — every member is optional', () => {
    expect(defineVisualizerExtension({})).toEqual({});
  });

  test('a fully-populated extension has EXACTLY the render-only key set', () => {
    const full: VisualizerExtension = {
      statusClass: () => 'state-draft',
      acText: () => 'AC text',
      acEvidence: () => 'evidence',
      acProof: () => 'proof',
      issuePanels: () => 'panels',
    };
    expect(new Set(Object.keys(full))).toEqual(new Set(['statusClass', 'acText', 'acEvidence', 'acProof', 'issuePanels']));
  });

  test('issuePanels receives (issue, projectUrl) — the same /project/ mapper acEvidence gets', () => {
    const calls: Array<[string, string]> = [];
    const ext = defineVisualizerExtension({
      issuePanels: (issue, projectUrl) => { calls.push([issue.id, projectUrl('evidence/x.png')]); return null; },
    });
    ext.issuePanels?.(
      { id: 'ISS-1', title: 't', summary: 's', status: 'draft', acceptanceCriteria: [] },
      (p) => `/project/${p}`,
    );
    expect(calls).toEqual([['ISS-1', '/project/evidence/x.png']]);
  });

  test('@ts-expect-error — statusOrder is NOT a member (vocabulary is layer-1 data in preset.mts)', () => {
    // @ts-expect-error — statusOrder must stay data-only (VIZ-1); this must NOT typecheck
    const bad: VisualizerExtension = { statusOrder: ['draft', 'ready', 'done'] };
    expect(bad).toBeTruthy();
  });

  test('@ts-expect-error — acUnitLabel is NOT a member (vocabulary is layer-1 data)', () => {
    // @ts-expect-error — acUnitLabel must stay data-only (VIZ-1); this must NOT typecheck
    const bad: VisualizerExtension = { acUnitLabel: 'Dev ACs' };
    expect(bad).toBeTruthy();
  });

  test('@ts-expect-error — assignee field-mapping is NOT a member (vocabulary is layer-1 data)', () => {
    // @ts-expect-error — field mappings must stay data-only (VIZ-1); this must NOT typecheck
    const bad: VisualizerExtension = { assignee: (issue) => issue.id };
    expect(bad).toBeTruthy();
  });

  test('@ts-expect-error — pr field-mapping is NOT a member (vocabulary is layer-1 data)', () => {
    // @ts-expect-error — field mappings must stay data-only (VIZ-1); this must NOT typecheck
    const bad: VisualizerExtension = { pr: (issue) => ({ url: issue.id }) };
    expect(bad).toBeTruthy();
  });
});
