#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(packageRoot, 'dist/cli.js');

const build = spawnSync('bun', ['build', 'src/cli.ts', '--target=node', '--external=@volter/twin', '--outfile=dist/cli.js'], {
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
