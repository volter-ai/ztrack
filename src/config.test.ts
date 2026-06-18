import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initTrackerProject, loadTrackerConfig, trackerValidationEntrypointPath } from './config.ts';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'ztrack-config-'));
}

describe('initTrackerProject', () => {
  test('init without --preset installs the basic repo-local preset', () => {
    const root = tempProject();
    try {
      const result = initTrackerProject(root, 'app');
      const entrypoint = trackerValidationEntrypointPath(root);
      expect(result).toMatchObject({ alreadyInitialized: false, teamKey: 'APP', preset: 'basic', validationEntrypoint: entrypoint });
      expect(loadTrackerConfig(root)).toMatchObject({
        backend: 'local',
        local: { teamKey: 'APP' },
        validation: {
          entrypoint: '.volter/tracker/validation/preset.cjs',
          installedFrom: 'basic',
        },
      });
      expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('# ztrack (added by ztrack init)\n.volter/tracker/tracker.sqlite\n.volter/tracker/tracker.sqlite-*\n.volter/tracker/tracker.sqlite.lock\n.volter/tracker/local-store.json\n.volter/tracker/markdown/\n.volter/agent-dispatch/\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('named init installs an editable repo-local validation entrypoint', () => {
    const root = tempProject();
    try {
      const result = initTrackerProject(root, 'app', { preset: 'simple-sdlc' });
      const entrypoint = trackerValidationEntrypointPath(root);
      expect(result).toMatchObject({ alreadyInitialized: false, teamKey: 'APP', preset: 'simple-sdlc', validationEntrypoint: entrypoint });
      expect(loadTrackerConfig(root)).toMatchObject({
        backend: 'local',
        local: { teamKey: 'APP' },
        validation: {
          entrypoint: '.volter/tracker/validation/preset.cjs',
          installedFrom: 'simple-sdlc',
        },
      });
      // The installed entrypoint configures the shared createGenericPreset factory
      // (a core preset) — it does not reimplement validation. Its runtime behavior
      // is covered by presetKit.test.ts; here we assert the install wiring.
      const text = readFileSync(entrypoint, 'utf8');
      expect(text).toContain('Repo-local ztrack validation preset');
      expect(text).toContain("require('ztrack/preset-kit')");
      expect(text).toContain("createGenericPreset");
      expect(text).toContain("name: 'simple-sdlc'");
      expect(text).toContain("requireSdlcGates: 'true' === 'true'");
      expect(text).toContain("requireSourceMarker: 'true' === 'true'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('simple-spec and speckit stamp their section-gate flags into the entrypoint', () => {
    const flag = { 'simple-spec': 'requireSpecSections', speckit: 'requireSpeckitSections' } as const;
    for (const presetName of ['simple-spec', 'speckit'] as const) {
      const root = tempProject();
      try {
        initTrackerProject(root, 'app', { preset: presetName });
        const text = readFileSync(trackerValidationEntrypointPath(root), 'utf8');
        expect(text).toContain(`name: '${presetName}'`);
        expect(text).toContain(`${flag[presetName]}: 'true' === 'true'`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
