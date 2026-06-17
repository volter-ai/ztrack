import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
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
      const text = readFileSync(entrypoint, 'utf8');
      expect(text).toContain('Repo-local ztrack validation preset');

      const require = createRequire(import.meta.url);
      const preset = require(entrypoint) as {
        name: string;
        parseIssueMarkdown(body: string): Record<string, unknown>;
        snapshot: { checkSnapshot(snapshot: unknown, options?: unknown): { valid: boolean; findings: Array<{ code: string }> } };
      };
      expect(preset.name).toBe('simple-sdlc');
      expect(preset.snapshot.checkSnapshot({ cases: [{ identifier: 'APP-1', body: '# Missing source', assignee: 'agent' }] }).findings[0]?.code)
        .toBe('simple-sdlc_case_missing_source_marker');
      const validBody = '# Has source [1]\n\n- [ ] dev/01 status: pending Do it. [1]';
      expect(preset.snapshot.checkSnapshot({ cases: [{ identifier: 'APP-2', body: validBody, assignee: 'agent', ...preset.parseIssueMarkdown(validBody) }] }).valid)
        .toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('simple-spec and speckit stamp their section gates', () => {
    for (const presetName of ['simple-spec', 'speckit'] as const) {
      const root = tempProject();
      try {
        initTrackerProject(root, 'app', { preset: presetName });
        const require = createRequire(import.meta.url);
        const preset = require(trackerValidationEntrypointPath(root)) as {
          snapshot: { checkSnapshot(snapshot: unknown, options?: unknown): { findings: Array<{ code: string }> } };
        };
        const codes = preset.snapshot.checkSnapshot({ cases: [{ identifier: 'APP-1', body: '# Missing sections [1]', assignee: 'agent' }] }).findings.map((finding) => finding.code);
        expect(codes.some((code) => code.startsWith(`${presetName}_missing_`))).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
