#!/usr/bin/env node
import { chmodSync, existsSync, readdirSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(packageRoot, 'dist/cli.js');

if (!existsSync(resolve(packageRoot, 'src/cli.ts'))) {
  console.log('ztrack ships prebuilt artifacts in the npm package; clone the repository to rebuild from source.');
  process.exit(0);
}

rmSync(resolve(packageRoot, 'dist/src'), { recursive: true, force: true });
const lib = spawnSync('npx', ['tsc', '-p', 'tsconfig.build.json'], {
  cwd: packageRoot,
  encoding: 'utf8',
});

if (lib.status !== 0) {
  process.stderr.write(lib.stderr || lib.stdout || 'tsc build failed\n');
  process.exit(lib.status ?? 1);
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

// twin (@volter-ai-dev/twin*) is a regular dependency and is bundled into the CLI on purpose, so
// `ztrack sync github` works from a plain install with no extra step. (A prior `--external=@volter/twin`
// flag was a no-op typo — wrong scope name — and is intentionally gone.)
const build = spawnSync('bun', ['build', 'src/cli.ts', '--target=node', '--outfile=dist/cli.js'], {
  cwd: packageRoot,
  encoding: 'utf8',
});

if (build.status !== 0) {
  process.stderr.write(build.stderr || build.stdout || 'bun build failed\n');
  process.exit(build.status ?? 1);
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
  { cwd: packageRoot, encoding: 'utf8' },
);
if (vizCore.status !== 0) {
  process.stderr.write(vizCore.stderr || vizCore.stdout || 'visualizer core bundle failed\n');
  process.exit(vizCore.status ?? 1);
}

// A self-contained CommonJS bundle of preset-kit. The installed preset is ESM
// (preset.mts, `import 'ztrack/preset-kit'`), but a CommonJS consumer that does
// `require('ztrack/preset-kit')` still needs a real-CJS target: the package is ESM
// (`"type": "module"`), so the `./preset-kit` export's `require` condition points here
// rather than at a `require()` of an ES module. Bundling zod/mdast in keeps it free of
// external ESM.
const kitCjs = spawnSync(
  'bun',
  ['build', 'src/presetKit.ts', '--target=node', '--format=cjs', '--external=@volter-ai-dev/twin', '--outfile=dist/preset-kit.cjs'],
  { cwd: packageRoot, encoding: 'utf8' },
);
if (kitCjs.status !== 0) {
  process.stderr.write(kitCjs.stderr || kitCjs.stdout || 'preset-kit CJS bundle failed\n');
  process.exit(kitCjs.status ?? 1);
}
