import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stateDirName, trackerConfigPath } from './config.ts';
import { trackerVisualizerExtensionPath } from './presetCatalog.ts';
import { buildVisualizerExtensionModule, loadVisualizerTheme } from './visualizerPresentation.ts';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });
const root = () => { const value = mkdtempSync(join(tmpdir(), 'ztrack-presentation-')); roots.push(value); return value; };
const configured = (projectRoot: string) => {
  mkdirSync(dirname(trackerConfigPath(projectRoot)), { recursive: true });
  const presetPath = join(projectRoot, stateDirName(), 'tracker', 'validation', 'preset.mjs');
  mkdirSync(dirname(presetPath), { recursive: true });
  writeFileSync(presetPath, `export default { name: 'test', schema: {}, parse: () => ({ issues: [] }), rules: [] };\n`);
  writeFileSync(trackerConfigPath(projectRoot), JSON.stringify({
    backend: 'markdown', local: { teamKey: 'TST' }, board: 'branch',
    validation: { entrypoint: `${stateDirName()}/tracker/validation/preset.mjs` },
  }));
};

describe('loadVisualizerTheme', () => {
  test('maps the documented legacy tokens to scoped ztrack variables', async () => {
    const projectRoot = root();
    const path = join(projectRoot, stateDirName(), 'tracker', 'visualizer', 'theme.css');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, ':root { --accent: #123456; --panel-soft: rgb(1 2 3 / 40%); }');
    expect(await loadVisualizerTheme({ projectRoot })).toMatchObject({
      variables: { '--ztrack-accent': '#123456', '--ztrack-panel-soft': 'rgb(1 2 3 / 40%)' },
      error: null,
    });
  });

  test('rejects host selectors, unknown tokens, and active CSS values', async () => {
    const projectRoot = root();
    const path = join(projectRoot, stateDirName(), 'tracker', 'visualizer', 'theme.css');
    mkdirSync(dirname(path), { recursive: true });
    for (const source of ['body { --accent: red; }', ':root { --host-secret: red; }', ':root { --accent: url(https://example.test/x); }']) {
      writeFileSync(path, source);
      const result = await loadVisualizerTheme({ projectRoot });
      expect(result.variables).toEqual({});
      expect(result.error).toContain('Unsafe visualizer theme');
    }
  });
});

describe('buildVisualizerExtensionModule', () => {
  test('bundles local JSX and kit imports against the host runtime with transitive watch paths', async () => {
    const projectRoot = root();
    configured(projectRoot);
    const extension = trackerVisualizerExtensionPath(projectRoot);
    const helper = join(dirname(extension), 'helper.tsx');
    mkdirSync(dirname(extension), { recursive: true });
    writeFileSync(helper, `export const Label = ({ text }: { text: string }) => <strong>{text}</strong>;`);
    writeFileSync(extension, `import { defineVisualizerExtension } from 'ztrack/visualizer-kit';\nimport { Label } from './helper.tsx';\nexport default defineVisualizerExtension({ acText: (ac) => <Label text={ac.id} /> });\n`);
    const result = await buildVisualizerExtensionModule({ projectRoot });
    expect(result.error).toBeNull();
    expect(result.code).toContain("ztrack.visualizer-react.v1");
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.watchPaths).toContain(realpathSync(helper));
  });

  test('fails closed on repo React imports while preserving a data-board fallback', async () => {
    const projectRoot = root();
    configured(projectRoot);
    const extension = trackerVisualizerExtensionPath(projectRoot);
    mkdirSync(dirname(extension), { recursive: true });
    writeFileSync(extension, `import React from 'react';\nexport default { acText: () => React.createElement('b') };\n`);
    const result = await buildVisualizerExtensionModule({ projectRoot });
    expect(result.code).toBeNull();
    expect(result.contentHash).toBeNull();
    expect(result.error).toContain('must not import React directly');
  });
});
