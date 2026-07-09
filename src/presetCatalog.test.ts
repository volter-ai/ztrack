// ZTB-19 (ZL-E4): `organization.check.categories` was written by every fresh `init` even though
// nothing reads it — no shipped preset assigns any rule a category for it to select among, and
// `ztrack check --categories` reads its own CLI flag, never this config block. Pinning that a
// fresh init no longer writes it (existing configs that already have it keep working — this only
// changes what a NEW init writes).
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { initTrackerProject, trackerValidationEntrypointPath, trackerVisualizerExtensionBasePath, trackerVisualizerExtensionPath } from './presetCatalog.ts';
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

// VIZ-15 dev/01 (non-DOM part) + dev/03 — full installed-artifact parity for the VIZ-13 code
// seam: `ztrack init` installs a starter `extension.tsx` + pristine `.extension.base.tsx`,
// exactly as `installPreset` writes `preset.mts` + `.preset.base.mts` above. The DOM-identity
// half of dev/01 (the no-op starter renders identically to no-extension) lives in
// `visualizer/client/render.viz13.e2e.test.tsx`'s "VIZ-15 dev/01" suite, which needs the real
// served bundle (happy-dom) — this file sticks to installed-file assertions, matching this
// module's own convention (see the comment above VIZ-2's describe block).
describe('initTrackerProject — starter dashboard extension installed at init (VIZ-15 dev/01)', () => {
  test('a fresh init scaffolds extension.tsx + .extension.base.tsx, identical, real no-op code', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrack-init-ext-'));
    try {
      initTrackerProject(root, 'APP', { preset: 'default' });
      const extPath = trackerVisualizerExtensionPath(root);
      const basePath = trackerVisualizerExtensionBasePath(root);
      expect(existsSync(extPath)).toBe(true);
      expect(existsSync(basePath)).toBe(true);
      const installed = readFileSync(extPath, 'utf8');
      expect(installed).toBe(readFileSync(basePath, 'utf8')); // pristine base matches the installed copy
      expect(installed).toContain("import { defineVisualizerExtension } from 'ztrack/visualizer-kit';"); // importing ONLY visualizer-kit
      expect(installed).toContain('export default defineVisualizerExtension({});'); // a genuine no-op — no members to merge
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // dev/03 — idempotence: mirrors installPreset's own existsSync guard (~106-109). Exercised by
  // hand-placing extension.tsx BEFORE init (config.json absent, so init doesn't early-return),
  // the only way to reach installExtension's guard with the file already present.
  test('init never clobbers a pre-existing extension.tsx (mirrors installPreset\'s existsSync guard)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrack-init-ext-idem-'));
    try {
      const extPath = trackerVisualizerExtensionPath(root);
      mkdirSync(dirname(extPath), { recursive: true });
      const handPlaced = '// hand-placed before ztrack init ever ran\nexport default {};\n';
      writeFileSync(extPath, handPlaced);

      initTrackerProject(root, 'APP', { preset: 'default' });

      expect(readFileSync(extPath, 'utf8')).toBe(handPlaced); // untouched, byte-for-byte
      // the pristine base is independently existsSync-guarded (same as the preset's basePath) —
      // still gets seeded from the starter template so `ztrack preset upgrade` has a merge base.
      expect(existsSync(trackerVisualizerExtensionBasePath(root))).toBe(true);
      expect(readFileSync(trackerVisualizerExtensionBasePath(root), 'utf8')).not.toBe(handPlaced);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
