import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureTrackerGitignore, initTrackerProject, loadTrackerConfig, trackerValidationEntrypointPath } from './config.ts';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'ztrack-config-'));
}

describe('initTrackerProject', () => {
  test('init without --preset installs the default repo-local preset', () => {
    const root = tempProject();
    try {
      const result = initTrackerProject(root, 'app');
      const entrypoint = trackerValidationEntrypointPath(root);
      expect(result).toMatchObject({ alreadyInitialized: false, teamKey: 'APP', preset: 'default', validationEntrypoint: entrypoint });
      expect(loadTrackerConfig(root)).toMatchObject({
        backend: 'markdown',
        local: { teamKey: 'APP' },
        validation: {
          entrypoint: '.volter/tracker/validation/preset.mts',
          installedFrom: 'default',
        },
      });
      expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('# ztrack (added by ztrack init)\n.volter/tracker/tracker.sqlite\n.volter/tracker/tracker.sqlite-*\n.volter/tracker/tracker.sqlite.lock\n.volter/tracker/local-store.json\n.volter/tracker/markdown/\n.volter/agent-dispatch/\n.volter/.ztrack-loop.json\n.volter/.ztrack-loop-iter-*\n.volter/.ztrack-loop-exempt-*\n.volter/.ztrack-loop-capped.json\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('ensureTrackerGitignore migrates an older managed block (appends only missing loop lines)', () => {
    const root = tempProject();
    try {
      // an older repo: ztrack's managed block exists but predates the .ztrack-loop-* patterns.
      writeFileSync(join(root, '.gitignore'), 'node_modules/\n# ztrack (added by ztrack init)\n.volter/tracker/tracker.sqlite\n.volter/agent-dispatch/\n');
      ensureTrackerGitignore(root);
      const out = readFileSync(join(root, '.gitignore'), 'utf8');
      // existing lines preserved, not duplicated; the missing loop patterns appended.
      expect(out.startsWith('node_modules/\n# ztrack (added by ztrack init)\n.volter/tracker/tracker.sqlite\n.volter/agent-dispatch/\n')).toBe(true);
      expect(out.match(/# ztrack \(added by ztrack init\)/g)).toHaveLength(1); // marker not re-added
      for (const line of ['.volter/.ztrack-loop.json', '.volter/.ztrack-loop-iter-*', '.volter/.ztrack-loop-exempt-*', '.volter/.ztrack-loop-capped.json']) {
        expect(out).toContain(line);
      }
      // idempotent: a second call changes nothing.
      const again = (() => { ensureTrackerGitignore(root); return readFileSync(join(root, '.gitignore'), 'utf8'); })();
      expect(again).toBe(out);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('named init installs the standalone preset .ts as the editable entrypoint', () => {
    const root = tempProject();
    try {
      const result = initTrackerProject(root, 'app', { preset: 'spec' });
      const entrypoint = trackerValidationEntrypointPath(root);
      expect(result).toMatchObject({ alreadyInitialized: false, teamKey: 'APP', preset: 'spec', validationEntrypoint: entrypoint });
      expect(loadTrackerConfig(root)).toMatchObject({
        backend: 'markdown',
        local: { teamKey: 'APP' },
        validation: {
          entrypoint: '.volter/tracker/validation/preset.mts',
          installedFrom: 'spec',
        },
      });
      // The installed entrypoint is the STANDALONE preset's real, editable source — its OWN
      // schema/parser/rules, importing only `ztrack/preset-kit` (no generic model). Runtime
      // behavior is proven in boilerplates/presets/spec.test.ts; here we assert the wiring.
      const text = readFileSync(entrypoint, 'utf8');
      expect(text).toContain("from 'ztrack/preset-kit'");
      expect(text).toContain('export const SpecPreset');
      expect(text).toContain('export default SpecPreset');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
