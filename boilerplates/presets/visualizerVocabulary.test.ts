// VIZ-2 guard: every shipped preset declares the dashboard's vocabulary (`visualizer`,
// `VisualizerSpec` — see `src/core/engine.ts`'s VIZ-1 block comment), and its `statusOrder`
// never drifts from the preset's own issue-status enum. Scans the dir the same way
// `presetManifest.test.ts` does (independent of any central list) so a fifth preset with no
// block — or one whose statusOrder silently falls out of sync with a renamed status — fails CI
// instead of shipping a dashboard that groups issues wrong or drops a status entirely.
import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { CoreRoot, Preset } from '../../src/core/engine.ts';
import { issueStatusEnumOf } from '../../src/presetRegistry.ts';

const DIR = import.meta.dir;
const presetNames = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => f.slice(0, -'.ts'.length));

async function loadPreset(name: string): Promise<Preset<CoreRoot>> {
  const mod = (await import(join(DIR, `${name}.ts`))) as { default?: Preset<CoreRoot> };
  if (!mod.default) throw new Error(`${name}.ts has no default export`);
  return mod.default;
}

describe('preset visualizer vocabulary (VIZ-2)', () => {
  test('every preset exports a `visualizer` block', async () => {
    for (const name of presetNames) {
      const preset = await loadPreset(name);
      expect(preset.visualizer, `${name}.ts's default export has no \`visualizer\` block`).toBeTruthy();
    }
  });

  test("every block's statusOrder equals the schema's own issue-status enum (issueStatusEnumOf)", async () => {
    for (const name of presetNames) {
      const preset = await loadPreset(name);
      const schemaEnum = issueStatusEnumOf(preset);
      expect(schemaEnum, `${name}.ts's schema has no plain z.enum \`status\` field to compare against`).not.toBeNull();
      expect(preset.visualizer?.statusOrder, `${name}.ts's visualizer.statusOrder`).toEqual(schemaEnum ?? undefined);
    }
  });

  // dev/02: proves the equality assertion above actually CATCHES drift — a status renamed in the
  // schema but not updated in the block — using a throwaway in-test fixture (never one of the
  // four shipped presets, and nothing here is left mutated). Wired exactly like the two tests
  // above: `issueStatusEnumOf` against `visualizer.statusOrder`.
  test('demonstrates the mechanism: a status renamed in the schema but not the block fails the equality check', () => {
    const rootSchema = z.object({
      issues: z.array(z.object({ status: z.enum(['draft', 'in-review', 'shipped']) })), // schema renamed done -> shipped
    }).strict();
    const staleFixture = {
      name: 'fixture-stale',
      schema: rootSchema,
      parse: () => ({ issues: [] }),
      rules: [],
      visualizer: { statusOrder: ['draft', 'in-review', 'done'], acUnitLabel: 'ACs' }, // block NOT updated
    } as unknown as Preset<CoreRoot>;

    const schemaEnum = issueStatusEnumOf(staleFixture);
    expect(schemaEnum).toEqual(['draft', 'in-review', 'shipped']);
    // this is the exact comparison the two guard tests above run for every real preset — here it
    // fails (not-equal), which is precisely what would turn CI red for a real preset in this state.
    expect(staleFixture.visualizer!.statusOrder).not.toEqual(schemaEnum ?? undefined);

    // and the positive control: updating the block to match makes the same check pass.
    const fixedFixture = {
      ...staleFixture,
      visualizer: { ...staleFixture.visualizer, statusOrder: ['draft', 'in-review', 'shipped'] },
    } as unknown as Preset<CoreRoot>;
    expect(fixedFixture.visualizer!.statusOrder).toEqual(issueStatusEnumOf(fixedFixture)!);
  });
});
