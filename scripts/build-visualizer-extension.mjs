#!/usr/bin/env bun
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const input = JSON.parse(await Bun.stdin.text());
const projectRoot = realpathSync(input.projectRoot);
const packageRoot = realpathSync(input.packageRoot);
const repoExtension = input.repoExtension ? realpathSync(input.repoExtension) : null;
const shippedExtension = input.shippedExtension ? realpathSync(input.shippedExtension) : null;
const watched = new Set();

const inside = (path, root) => path === root || path.startsWith(root + sep);
const sourceRootFor = (path) => inside(path, projectRoot) ? projectRoot : inside(path, packageRoot) ? packageRoot : null;
const runtimeNamespace = 'ztrack-host-react-runtime';
const kitNamespace = 'ztrack-visualizer-kit';

const plugin = {
  name: 'ztrack-confined-extension',
  setup(build) {
    build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => {
      return { path: args.path, namespace: runtimeNamespace };
    });
    build.onResolve({ filter: /^ztrack\/visualizer-kit$/ }, () => ({ path: 'kit', namespace: kitNamespace }));
    build.onResolve({ filter: /^[A-Za-z@]/ }, (args) => {
      throw new Error(`Visualizer extensions may import only local modules and 'ztrack/visualizer-kit' (received '${args.path}').`);
    });
    build.onLoad({ filter: /.*/, namespace: runtimeNamespace }, (args) => {
      if (args.path === 'react/jsx-runtime' || args.path === 'react/jsx-dev-runtime') {
        return { loader: 'js', contents: `
          const runtime = globalThis[Symbol.for('ztrack.visualizer-react.v1')];
          if (!runtime) throw new Error('ztrack visualizer React runtime was not installed by the host');
          export const Fragment = runtime.Fragment;
          export const jsx = (type, props, key) => runtime.createElement(type, key === undefined ? props : { ...props, key });
          export const jsxs = jsx;
          export const jsxDEV = jsx;
        ` };
      }
      return { loader: 'js', contents: `
        const runtime = globalThis[Symbol.for('ztrack.visualizer-react.v1')];
        if (!runtime) throw new Error('ztrack visualizer React runtime was not installed by the host');
        export default runtime;
        export const createElement = runtime.createElement;
        export const Fragment = runtime.Fragment;
      ` };
    });
    build.onLoad({ filter: /.*/, namespace: kitNamespace }, () => ({
      loader: 'js',
      contents: 'export const defineVisualizerExtension = (extension) => extension;',
    }));
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (args) => {
      const path = realpathSync(args.path);
      if (inside(path, scratch)) return undefined;
      const root = sourceRootFor(path);
      if (!root) throw new Error(`Visualizer extension import escapes its allowed root: '${path}'.`);
      watched.add(path);
      const source = readFileSync(path, 'utf8');
      if (root === projectRoot && /(?:from\s*|import\s*\(|require\s*\()\s*['"]react(?:-dom)?(?:\/[^'"]*)?['"]/.test(source)) {
        throw new Error(`Repo visualizer extensions must not import React directly: '${relative(projectRoot, path)}'.`);
      }
      const ext = path.match(/\.([cm]?[jt]sx?)$/)?.[1] ?? 'ts';
      const loader = ext.endsWith('x') ? 'tsx' : ext.endsWith('s') ? 'ts' : 'js';
      return { loader, contents: source };
    });
  },
};

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'ztrack-viz-extension-')));
try {
  const entry = join(scratch, 'entry.ts');
  const lines = [];
  if (shippedExtension) lines.push(`import shipped from ${JSON.stringify(shippedExtension)};`);
  if (repoExtension) lines.push(`import repo from ${JSON.stringify(repoExtension)};`);
  lines.push(`const extension = { ...${shippedExtension ? '(shipped ?? {})' : '{}'}, ...${repoExtension ? '(repo ?? {})' : '{}'} };`);
  lines.push('export default extension;');
  writeFileSync(entry, lines.join('\n'));
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    minify: false,
    plugins: [plugin],
  });
  if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n') || 'extension build failed');
  process.stdout.write(JSON.stringify({ code: await result.outputs[0].text(), watchPaths: [...watched].sort() }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
