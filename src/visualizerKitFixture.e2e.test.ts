// VIZ-14 dev/02: a consuming fixture `extension.tsx` that imports ONLY 'ztrack/visualizer-kit'
// (a) typechecks against the BUILT .d.ts, and (b) loads at runtime through a plain import.
//
// Method for (a): a temp dir with `node_modules/ztrack` symlinked to the repo root (so Node/TS
// package-exports resolution — the SAME mechanism a real install uses — resolves
// `ztrack/visualizer-kit` to `dist/src/visualizerKit.{js,d.ts}` via this package's own
// `exports` map, package.json:41-45-ish) and `node_modules/@types/react` symlinked to the
// repo's own (so the fixture's `import type { ReactNode }` chain — pulled in transitively by
// `VisualizerExtension` — resolves without a separate react install, per the optional-peer
// design). `bunx tsc --noEmit` runs against the fixture with `moduleResolution: bundler`,
// mirroring `visualizer/tsconfig.json`'s own resolution mode.
//
// Method for (b): the full VIZ-13 compile path (repo extension.tsx -> generated Bun.build
// entry -> served bundle) doesn't exist yet (VIZ-13 is a separate, not-yet-landed task). A bun
// `import()` of the SAME fixture file, from the SAME symlinked-package temp dir, proving
// `defineVisualizerExtension` returns the object unchanged, is the runtime proof this dev/02
// asks for — stated explicitly, not silently substituted.
//
// Gated on the package actually being built (dist/src/visualizerKit.* present) — CI builds
// before testing (ci.yml: "Build package" precedes "Test"); a local `bun test` run without a
// prior `npm run build` skips rather than failing on an environment precondition, matching this
// suite's existing HAS_DEPS convention (visualizer.e2e.test.ts).
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const KIT_BUILT = existsSync(join(REPO, 'dist', 'src', 'visualizerKit.js')) && existsSync(join(REPO, 'dist', 'src', 'visualizerKit.d.ts'));
const TYPES_REACT = existsSync(join(REPO, 'node_modules', '@types', 'react'));
const suite = KIT_BUILT && TYPES_REACT ? describe : describe.skip;

const EXTENSION_SOURCE = `
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';
import type { VisualizerExtension } from 'ztrack/visualizer-kit';

const ext: VisualizerExtension = {
  statusClass: (status) => \`state-\${status}\`,
  acText: (ac) => ac.id,
  acEvidence: (ac, projectUrl) => projectUrl(String(ac.id)),
  acProof: (ac) => ac.id,
  issuePanels: (issue, projectUrl) => projectUrl(issue.id),
};

export default defineVisualizerExtension(ext);
`;

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-vizkit-fixture-'));
  mkdirSync(join(root, 'node_modules', '@types'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
  symlinkSync(join(REPO, 'node_modules', '@types', 'react'), join(root, 'node_modules', '@types', 'react'));
  writeFileSync(join(root, 'extension.tsx'), EXTENSION_SOURCE);
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx',
      strict: true, skipLibCheck: true, types: ['react'], noEmit: true,
    },
    include: ['extension.tsx'],
  }, null, 2));
  return root;
}

suite('ztrack/visualizer-kit — consuming fixture (VIZ-14 dev/02)', () => {
  test('a fixture extension.tsx importing ONLY ztrack/visualizer-kit typechecks against the built .d.ts', () => {
    const root = makeFixture();
    try {
      const result = spawnSync('bunx', ['tsc', '--noEmit', '-p', root], { cwd: root, encoding: 'utf8' });
      expect(result.stdout + result.stderr).not.toContain('error TS');
      expect(result.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('the fixture loads at runtime through a plain import — defineVisualizerExtension returns the object (runtime proof; the full VIZ-13 compile path is a separate task)', async () => {
    const root = makeFixture();
    try {
      const mod = await import(join(root, 'extension.tsx'));
      expect(typeof mod.default).toBe('object');
      expect(typeof mod.default.statusClass).toBe('function');
      expect(mod.default.statusClass('draft')).toBe('state-draft');
      expect(mod.default.acEvidence({ id: 'AC-1' }, (p: string) => `/project/${p}`)).toBe('/project/AC-1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
