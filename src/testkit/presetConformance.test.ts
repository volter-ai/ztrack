// VIZ-7: tests of the testkit's OWN visualizer-vocabulary conformance helper
// (`visualizerSpecConformanceProblems` / `assertVisualizerSpecConformance`,
// src/testkit/presetConformance.ts) — not of any shipped preset. The four shipped presets'
// own test files (boilerplates/presets/*.test.ts) call `assertVisualizerSpecConformance`
// against THEIR real preset (dev/01); this file proves the helper itself actually catches
// drift, using throwaway in-test fixtures rather than mutating a shipped preset (dev/02).
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { CoreRoot, Preset, VisualizerSpec } from 'ztrack/preset-kit';
import { assertVisualizerSpecConformance, visualizerSpecConformanceProblems } from './presetConformance.ts';

// A schema + matching visualizer block that maps every optional member — the positive control
// every negative fixture below perturbs one field of at a time.
const GOOD_SCHEMA = z.object({
  issues: z.array(z.object({
    id: z.string(),
    status: z.enum(['draft', 'active', 'done']),
    assignee: z.string(),
    pr: z.object({ url: z.string() }).strict().optional(),
    acceptanceCriteria: z.array(z.object({
      id: z.string(),
      text: z.string(),
      version: z.number(),
      proof: z.object({ explanation: z.string(), evidenceRefs: z.array(z.string()) }).strict().optional(),
      evidence: z.array(z.object({ image: z.string(), commit: z.string(), acVersion: z.number() }).strict()),
    }).strict()),
  }).strict()),
}).strict();

const GOOD_VISUALIZER: VisualizerSpec = {
  statusOrder: ['draft', 'active', 'done'], // must equal GOOD_SCHEMA's status enum, in order
  acUnitLabel: 'ACs',
  assignee: 'assignee',
  pr: { field: 'pr', urlField: 'url' },
  acText: { id: 'id', text: 'text', version: 'version' },
  acProof: { field: 'proof', explanation: 'explanation', evidenceRefs: 'evidenceRefs' },
  acEvidence: { field: 'evidence', image: 'image', commit: 'commit', acVersion: 'acVersion' },
};

const goodPreset = {
  name: 'fixture-good', schema: GOOD_SCHEMA, parse: () => ({ issues: [] }), rules: [],
  visualizer: GOOD_VISUALIZER,
} as unknown as Preset<CoreRoot>;

describe('visualizerSpecConformanceProblems (VIZ-7)', () => {
  test('a fully-conformant preset reports zero problems', () => {
    expect(visualizerSpecConformanceProblems(goodPreset)).toEqual([]);
  });

  // dev/01, demonstrated on the pure fixture too (the real shipped-preset wiring lives in each
  // preset's own boilerplates/presets/*.test.ts) — the registering wrapper actually runs a
  // bun:test `test()` and passes for a conformant preset.
  assertVisualizerSpecConformance(goodPreset);

  test('a preset with no `visualizer` block reports exactly one problem, naming the preset', () => {
    const bare = { name: 'fixture-bare', schema: GOOD_SCHEMA, parse: () => ({ issues: [] }), rules: [] } as unknown as Preset<CoreRoot>;
    const problems = visualizerSpecConformanceProblems(bare);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('fixture-bare');
    expect(problems[0]).toContain('visualizer');
  });

  test('VisualizerSpecSchema catches a structurally invalid block (statusOrder not an array)', () => {
    const bad = {
      ...goodPreset,
      visualizer: { ...GOOD_VISUALIZER, statusOrder: 'draft' as unknown as string[] },
    } as unknown as Preset<CoreRoot>;
    const problems = visualizerSpecConformanceProblems(bad);
    expect(problems.some((p) => p.includes('VisualizerSpecSchema'))).toBe(true);
  });

  test('a mapping naming a field absent from the issue schema is reported, naming the field', () => {
    const bad = { ...goodPreset, visualizer: { ...GOOD_VISUALIZER, assignee: 'owner' } } as unknown as Preset<CoreRoot>;
    const problems = visualizerSpecConformanceProblems(bad);
    const named = problems.find((p) => p.includes('"owner"'));
    expect(named, `expected a problem naming "owner"; got: ${JSON.stringify(problems)}`).toBeTruthy();
    expect(named).toContain('issue schema');
  });

  test('a mapping naming a field absent from the AC schema is reported, naming the field', () => {
    const bad = { ...goodPreset, visualizer: { ...GOOD_VISUALIZER, acText: { id: 'id', text: 'body' } } } as unknown as Preset<CoreRoot>;
    const problems = visualizerSpecConformanceProblems(bad);
    const named = problems.find((p) => p.includes('"body"'));
    expect(named, `expected a problem naming "body"; got: ${JSON.stringify(problems)}`).toBeTruthy();
    expect(named).toContain('AC schema');
  });

  test('a mapping naming a field absent from a nested sub-object (acProof) is reported, naming the field', () => {
    const bad = {
      ...goodPreset,
      visualizer: { ...GOOD_VISUALIZER, acProof: { field: 'proof', explanation: 'why', evidenceRefs: 'evidenceRefs' } },
    } as unknown as Preset<CoreRoot>;
    const problems = visualizerSpecConformanceProblems(bad);
    const named = problems.find((p) => p.includes('"why"'));
    expect(named, `expected a problem naming "why"; got: ${JSON.stringify(problems)}`).toBeTruthy();
    expect(named).toContain('proof schema');
  });

  // dev/02: an in-test fixture (never a shipped preset, nothing left mutated) proving the helper
  // ACTUALLY catches a status renamed in the schema but not updated in the visualizer block — the
  // exact drift `issueStatusEnumOf` (src/presetRegistry.ts, VIZ-2) exists to guard against — and
  // that the failure NAMES the offending status.
  describe('dev/02: a status renamed in the schema but not the block fails the helper, naming the status', () => {
    const staleSchema = z.object({
      issues: z.array(z.object({
        status: z.enum(['draft', 'in-review', 'shipped']), // schema renamed done -> shipped
        acceptanceCriteria: z.array(z.object({ id: z.string() }).strict()),
      }).strict()),
    }).strict();
    const staleFixture = {
      name: 'fixture-stale', schema: staleSchema, parse: () => ({ issues: [] }), rules: [],
      visualizer: { statusOrder: ['draft', 'in-review', 'done'], acUnitLabel: 'ACs' }, // block NOT updated
    } as unknown as Preset<CoreRoot>;

    test('the helper reports a problem naming "done" and the preset', () => {
      const problems = visualizerSpecConformanceProblems(staleFixture);
      expect(problems.length).toBeGreaterThan(0);
      const named = problems.find((p) => p.includes('"done"'));
      expect(named, `expected a problem naming "done"; got: ${JSON.stringify(problems)}`).toBeTruthy();
      expect(named).toContain('fixture-stale');
      expect(named).toContain('in-review'); // the schema's REAL enum is cited too, for orientation
    });

    // positive control: this is the EXACT comparison `assertVisualizerSpecConformance` runs for
    // every real shipped preset — updating the block to match makes it pass.
    test('fixing the block to match its schema makes the same check pass', () => {
      const fixed = {
        ...staleFixture,
        visualizer: { ...(staleFixture.visualizer as { acUnitLabel: string }), statusOrder: ['draft', 'in-review', 'shipped'] },
      } as unknown as Preset<CoreRoot>;
      expect(visualizerSpecConformanceProblems(fixed)).toEqual([]);
    });
  });
});
