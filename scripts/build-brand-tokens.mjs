// Generates visualizer/brand/ (not committed; shipped in the package): the brand's tokens.css and
// the faces it names, fetched from brand.volter.ai at build time (company decision 0018). The
// visualizer's stylesheets read the brand's semantic roles (var(--volter-*)); `ztrack visualizer`
// serves this file at /assets/brand/tokens.css, and an embedding host imports
// `ztrack/visualizer-react/tokens.css` beside `ztrack/visualizer-react/styles.css`. Font URLs are
// rewritten relative to the file, so they resolve wherever it is served or bundled. Nothing is
// fetched at runtime; a failed fetch fails the build.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRAND = 'https://brand.volter.ai';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../visualizer/brand');

const fetched = async (path) => {
  const response = await fetch(`${BRAND}${path}`);
  if (!response.ok) throw new Error(`brand ${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

const tokens = (await fetched('/tokens.css')).toString('utf8').replaceAll(`${BRAND}/fonts/`, 'fonts/');
const faces = [...tokens.matchAll(/url\("fonts\/([^"]+)"\)/g)].map((m) => m[1]);
if (faces.length === 0) throw new Error('brand tokens.css names no faces');
await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'fonts'), { recursive: true });
for (const face of faces) await writeFile(resolve(out, 'fonts', face), await fetched(`/fonts/${face}`));
await writeFile(resolve(out, 'tokens.css'), tokens);
console.log(`brand tokens: visualizer/brand/tokens.css and ${faces.length} faces`);
