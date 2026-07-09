// ZTB-19 (ZL-E4): `organization.check.categories` was written by every fresh `init` even though
// nothing reads it — no shipped preset assigns any rule a category for it to select among, and
// `ztrack check --categories` reads its own CLI flag, never this config block. Pinning that a
// fresh init no longer writes it (existing configs that already have it keep working — this only
// changes what a NEW init writes).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initTrackerProject, trackerValidationEntrypointPath } from './presetCatalog.ts';
import { trackerConfigPath } from './config.ts';

describe('initTrackerProject — no dead categories block (ZL-E4)', () => {
  test('a fresh init writes no organization.check.categories', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrack-init-'));
    try {
      initTrackerProject(root, 'APP', { preset: 'default' });
      const config = JSON.parse(readFileSync(trackerConfigPath(root), 'utf8'));
      expect(config.organization?.check?.categories).toBeUndefined();
      // and organization itself, having nothing else to carry at init time, is absent entirely
      expect(config.organization).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// VIZ-2 dev/03 — install parity: `initTrackerProject` copies the boilerplate `.ts` VERBATIM
// (installPreset, presetCatalog.ts) into `.volter/tracker/validation/preset.mts`, so the
// installed file must carry the same `visualizer` block the source boilerplate declares
// (guarded at the source by `boilerplates/presets/visualizerVocabulary.test.ts`). String
// assertions on the installed file's source text (not a dynamic import — `ztrack/preset-kit`
// does not resolve from a temp-project subprocess in this sandbox, and in-process `import()` of
// an arbitrary temp path is unnecessary when the file is a verbatim copy checkable as text).
describe('installed preset.mts carries the visualizer block (VIZ-2 install parity)', () => {
  const expectedStatusOrder: Record<string, string[]> = {
    'simple-sdlc': ['draft', 'ready', 'in-progress', 'in-review', 'done'],
    'simple-gh-sdlc': ['draft', 'ready', 'in-progress', 'in-review', 'done'],
    spec: ['draft', 'in-review', 'done'],
    speckit: ['specifying', 'planning', 'tasking', 'in-progress', 'done'],
  };

  for (const [preset, statusOrder] of Object.entries(expectedStatusOrder)) {
    test(`${preset}: installed preset.mts contains a visualizer block with the expected statusOrder`, () => {
      const root = mkdtempSync(join(tmpdir(), 'ztrack-init-viz-'));
      try {
        initTrackerProject(root, 'APP', { preset });
        const installed = readFileSync(trackerValidationEntrypointPath(root), 'utf8');
        expect(installed).toContain('visualizer:');
        expect(installed).toContain('acUnitLabel:');
        for (const status of statusOrder) expect(installed).toContain(`'${status}'`);
        // the array literal itself, in order — not just each status present somewhere in the file.
        expect(installed).toContain(`[${statusOrder.map((s) => `'${s}'`).join(', ')}]`);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
});
