#!/usr/bin/env node
import { chmodSync, existsSync, readdirSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(packageRoot, 'dist/cli.js');
// Bun can be a .cmd shim on Windows; Node cannot exec it
// directly. All arguments below are fixed build inputs, not caller shell text.
const launch = { shell: process.platform === 'win32', windowsHide: true };
function failed(result, fallback) {
  if (result.error) process.stderr.write(`${result.error.stack ?? result.error}\n`);
  process.stderr.write(result.stderr || result.stdout || `${fallback}\n`);
  process.exit(result.status ?? 1);
}

if (!existsSync(resolve(packageRoot, 'src/cli.ts'))) {
  console.log('ztrack ships prebuilt artifacts in the npm package; clone the repository to rebuild from source.');
  process.exit(0);
}

rmSync(resolve(packageRoot, 'dist/src'), { recursive: true, force: true });
const lib = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
  cwd: packageRoot,
  encoding: 'utf8',
  windowsHide: true,
});

if (lib.status !== 0) {
  failed(lib, 'tsc build failed');
}

function rewriteDeclarations(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      rewriteDeclarations(path);
      continue;
    }
    if (!path.endsWith('.d.ts')) continue;
    const text = readFileSync(path, 'utf8')
      .replace(/((?:from|import)\s+['"][^'"]+)\.ts(['"])/g, '$1.js$2')
      .replace(/(import\(['"][^'"]+)\.ts(['"]\))/g, '$1.js$2');
    writeFileSync(path, text);
  }
}
rewriteDeclarations(resolve(packageRoot, 'dist/src'));

// twin (@volter/world-core, @volter/twin-github) is an OPTIONAL peer dependency (issue #13): a plain `npm i -D
// ztrack` must not pull in its transitive tree (react/react-dom) or its stray
// `volter-twin`/`world-github` bins. `sync.ts` only ever reaches it through a lazy `import()`
// (twinRuntime.ts) — `--external` here keeps that import() a real, unresolved-until-runtime
// module load in dist/cli.js instead of bun inlining the packages into the bundle, so an install
// without the peers stays lean and `ztrack sync github` fails with an install hint instead of a
// module-not-found buried inside a bundled blob.
// Bundles resolve their dependencies' production builds: bun otherwise takes the `development`
// export condition, and micromark's development build runs debug calls and assertions on every
// token of every parse.
const production = { ...process.env, NODE_ENV: 'production' };
const build = spawnSync('bun', ['build', 'src/cli.ts', '--target=node', '--external=@volter/world-core', '--external=@volter/twin-github', '--outfile=dist/cli.js'], {
  cwd: packageRoot,
  encoding: 'utf8',
  env: production,
  ...launch,
});

if (build.status !== 0) {
  failed(build, 'bun build failed');
}

let text = readFileSync(outFile, 'utf8');
if (!text.startsWith('#!/usr/bin/env bun\n')) {
  process.stderr.write('unexpected tracker CLI bundle shebang; refusing to publish an unknown wrapper\n');
  process.exit(1);
}

text = text
  .replace(/^#!\/usr\/bin\/env bun\n(?:\/\/ @bun\n)?/, '#!/usr/bin/env node\n');
writeFileSync(outFile, text);
chmodSync(outFile, 0o755);

// Bundle the visualizer's server-side core into a self-contained module. The
// published package excludes the loose engine modules (they live only inside
// dist/cli.js), so the visualizer imports this bundle instead of dist/src/*.
const vizCore = spawnSync(
  'bun',
  ['build', 'visualizer/serverCore.ts', '--target=bun', '--outfile=visualizer/core.js'],
  { cwd: packageRoot, encoding: 'utf8', ...launch },
);
if (vizCore.status !== 0) {
  failed(vizCore, 'visualizer core bundle failed');
}

// A self-contained CommonJS bundle of preset-kit. The installed preset is ESM
// (preset.mts, `import '@volter/ztrack/preset-kit'`), but a CommonJS consumer that does
// `require('@volter/ztrack/preset-kit')` still needs a real-CJS target: the package is ESM
// (`"type": "module"`), so the `./preset-kit` export's `require` condition points here
// rather than at a `require()` of an ES module. Bundling zod/mdast in keeps it free of
// external ESM.
const kitCjs = spawnSync(
  'bun',
  ['build', 'src/presetKit.ts', '--target=node', '--format=cjs', '--external=@volter/world-core', '--outfile=dist/preset-kit.cjs'],
  { cwd: packageRoot, encoding: 'utf8', env: production, ...launch },
);
if (kitCjs.status !== 0) {
  failed(kitCjs, 'preset-kit CJS bundle failed');
}

// The board backing consumes the installed kanban grammar without a TypeScript loader.
const kanban = spawnSync('bun', ['build', 'boilerplates/presets/kanban.ts', '--target=node', '--format=cjs', '--external=@volter/ztrack/preset-kit', '--outfile=dist/kanban-preset.cjs'], { cwd: packageRoot, encoding: 'utf8', env: production, ...launch });
if (kanban.status !== 0) failed(kanban, 'kanban preset bundle failed');
