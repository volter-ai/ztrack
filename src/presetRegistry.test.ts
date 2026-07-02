// ZTB-13: `ztrack check --preset <path>` loads an operator-supplied validation preset in place
// of the repo's configured `validation.entrypoint` — unconfined to the project (that confinement
// guards against the REPO's config naming an arbitrary host path; a CLI flag is the OPERATOR's
// own trust decision). Unit-level proof of `resolveTrackerValidation`'s presetPath branch
// (`loadOperatorPreset` in presetRegistry.ts) — the real dynamic-import machinery and
// `assertCorePreset` shape-check, without spawning the CLI. See cliCheckPreset.e2e.test.ts for
// the black-box proof (identical gating, sentinel-not-imported, --input/live-tracker modes).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTrackerValidation } from './presetRegistry.ts';
import type { TrackerConfig } from './types.ts';

// A minimal but SHAPE-VALID core preset (name/schema/parse/rules) — deliberately does not import
// 'ztrack/preset-kit' so this unit test has no node_modules dependency; assertCorePreset only
// checks the shape, not that `schema` is a real Zod type.
const FIXTURE_PRESET = `
export default {
  name: 'fixture-preset',
  schema: { parse: (x) => x },
  parse: (records) => ({ issues: records }),
  rules: [],
};
`;

const NO_ENTRYPOINT_CONFIG: TrackerConfig = { backend: 'markdown', local: { teamKey: 'X' } };

describe('resolveTrackerValidation — operator --preset (ZTB-13)', () => {
  test('a valid core preset OUTSIDE the project loads via presetPath, with no entrypoint configured at all', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'ztrk-preset-unit-'));
    try {
      const presetPath = join(outside, 'fixture.mts');
      writeFileSync(presetPath, FIXTURE_PRESET);
      // projectRoot points somewhere that does not even exist — proves presetPath is resolved
      // independently of (and unconfined to) the project.
      const preset = await resolveTrackerValidation(NO_ENTRYPOINT_CONFIG, '/nonexistent/project/root', presetPath);
      expect(preset.name).toBe('fixture-preset');
      expect(typeof preset.parse).toBe('function');
      expect(preset.rules).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('presetPath wins even when a (bogus) config entrypoint is also set — the flag overrides, it does not merely fill a gap', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'ztrk-preset-unit-override-'));
    try {
      const presetPath = join(outside, 'fixture.mts');
      writeFileSync(presetPath, FIXTURE_PRESET);
      const config: TrackerConfig = { ...NO_ENTRYPOINT_CONFIG, validation: { entrypoint: 'does/not/exist.mts' } };
      const preset = await resolveTrackerValidation(config, '/nonexistent/project/root', presetPath);
      expect(preset.name).toBe('fixture-preset');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a nonexistent --preset path fails with a clear error (not a generic import failure)', async () => {
    await expect(resolveTrackerValidation(NO_ENTRYPOINT_CONFIG, process.cwd(), '/no/such/preset.mts'))
      .rejects.toThrow(/--preset path does not exist: \/no\/such\/preset\.mts/);
  });

  test('a module that does not export an object fails with the existing "did not export a preset object" error', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'ztrk-preset-unit-bad-scalar-'));
    try {
      const presetPath = join(outside, 'not-a-preset.mts');
      writeFileSync(presetPath, 'export default 42;\n');
      await expect(resolveTrackerValidation(NO_ENTRYPOINT_CONFIG, process.cwd(), presetPath))
        .rejects.toThrow(/did not export a preset object/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a module exporting an object missing preset fields fails with the existing "is not a core preset" error', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'ztrk-preset-unit-bad-shape-'));
    try {
      const presetPath = join(outside, 'incomplete-preset.mts');
      writeFileSync(presetPath, "export default { name: 'incomplete' };\n"); // missing schema/parse/rules
      await expect(resolveTrackerValidation(NO_ENTRYPOINT_CONFIG, process.cwd(), presetPath))
        .rejects.toThrow(/is not a core preset \(need name, schema, parse, rules\)/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('without presetPath, the config route (loadValidationEntrypoint) and its inside-project confinement are unchanged', async () => {
    // An entrypoint path that escapes the project root must still be rejected exactly as before —
    // this is the ZTB-13 guardrail: presetRegistry.ts:28-33's confinement stays as-is for the
    // config route; only the NEW operator route (presetPath) skips it.
    const config: TrackerConfig = { ...NO_ENTRYPOINT_CONFIG, validation: { entrypoint: '../../etc/passwd' } };
    await expect(resolveTrackerValidation(config, '/tmp/some-project'))
      .rejects.toThrow(/must live inside the project — '\.\.\/\.\.\/etc\/passwd' escapes/);
  });

  test('without presetPath and without a configured entrypoint, the existing no-entrypoint error is unchanged', async () => {
    await expect(resolveTrackerValidation(NO_ENTRYPOINT_CONFIG, process.cwd()))
      .rejects.toThrow(/No tracker validation entrypoint configured/);
  });
});
