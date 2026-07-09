// VIZ-1: VisualizerSpecSchema is the HARD BOUNDARY on the dashboard vocabulary block — every
// member is a string, a string array, or a flat record of strings, so a function- or
// markup-valued member fails validation structurally (dev/03). dev/04 proves the schema can
// express the full vocabulary `visualizer/client/presets/default.tsx:5-40` hand-wrote as React
// code, purely as data.
import { describe, expect, test } from 'bun:test';
import { VisualizerSpecSchema, type VisualizerSpec } from './engine.ts';

describe('VisualizerSpecSchema (VIZ-1 dev/03)', () => {
  test('accepts a minimal good block (statusOrder + acUnitLabel + acText only)', () => {
    const good = {
      statusOrder: ['draft', 'ready', 'done'],
      acUnitLabel: 'Dev ACs',
      acText: { id: 'id', text: 'text', version: 'version' },
    };
    const result = VisualizerSpecSchema.safeParse(good);
    expect(result.success).toBe(true);
  });

  test('accepts a block omitting acText entirely — every field mapping is optional (spec/speckit need not fake one)', () => {
    const good = {
      statusOrder: ['draft', 'in-review', 'done'],
      acUnitLabel: 'ACs',
    };
    const result = VisualizerSpecSchema.safeParse(good);
    expect(result.success).toBe(true);
  });

  test("accepts an acText omitting version — only simple-sdlc's AC schema HAS a version field", () => {
    const good = {
      statusOrder: ['draft', 'in-review', 'done'],
      acUnitLabel: 'User Stories',
      acText: { id: 'id', text: 'text' },
    };
    const result = VisualizerSpecSchema.safeParse(good);
    expect(result.success).toBe(true);
  });

  test('rejects a block with a function-valued member (the hard boundary)', () => {
    const bad = {
      statusOrder: ['draft', 'done'],
      acUnitLabel: 'Dev ACs',
      acText: { id: 'id', text: 'text', version: 'version' },
      // the banned shape: a renderer, not a field reference — exactly what default.tsx's
      // PresetExtension carries and this contract must NOT reproduce.
      statusClass: (s: string) => s,
    };
    const result = VisualizerSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  test('rejects a function in place of a required string field', () => {
    const bad = {
      statusOrder: ['draft', 'done'],
      acUnitLabel: () => 'Dev ACs',
      acText: { id: 'id', text: 'text', version: 'version' },
    };
    const result = VisualizerSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  test('rejects an unknown key (strict — same discipline as configSchema.ts)', () => {
    const bad = {
      statusOrder: ['draft', 'done'],
      acUnitLabel: 'Dev ACs',
      acText: { id: 'id', text: 'text', version: 'version' },
      renderIssuePanel: () => null,
    };
    const result = VisualizerSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe('VisualizerSpecSchema — full default.tsx vocabulary, as data (VIZ-1 dev/04)', () => {
  test('the entire vocabulary visualizer/client/presets/default.tsx:5-40 expressed in React validates as pure data', () => {
    // Mirrors, field-for-field, what defaultExtension (default.tsx) hand-wrote as renderers:
    //  - statusOrder / acUnitLabel / statusClass: identity map
    //  - assignee: reads issue.assignee
    //  - pr: reads issue.pr.url
    //  - acText: id + text + version
    //  - acProof: ac.proof.{explanation, evidenceRefs}
    //  - acEvidence: ac.evidence[].{image, commit, acVersion}
    const spec: VisualizerSpec = {
      statusOrder: ['draft', 'ready', 'in-progress', 'in-review', 'done'],
      acUnitLabel: 'Dev ACs',
      statusClass: {
        draft: 'draft', ready: 'ready', 'in-progress': 'in-progress', 'in-review': 'in-review', done: 'done',
      },
      assignee: 'assignee',
      pr: { field: 'pr', urlField: 'url' },
      acText: { id: 'id', text: 'text', version: 'version' },
      acProof: { field: 'proof', explanation: 'explanation', evidenceRefs: 'evidenceRefs' },
      acEvidence: { field: 'evidence', image: 'image', commit: 'commit', acVersion: 'acVersion' },
    };
    const result = VisualizerSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.statusOrder).toEqual(['draft', 'ready', 'in-progress', 'in-review', 'done']);
      expect(result.data.acProof?.evidenceRefs).toBe('evidenceRefs');
      expect(result.data.acEvidence?.acVersion).toBe('acVersion');
    }
  });
});
