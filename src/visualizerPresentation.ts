import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTrackerConfig, stateDirName } from './config.ts';
import { trackerVisualizerExtensionPath } from './presetCatalog.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';

export interface VisualizerExtensionModuleResult {
  code: string | null;
  contentHash: string | null;
  error: string | null;
  watchPaths: string[];
}

export interface VisualizerThemeResult {
  variables: Record<string, string>;
  error: string | null;
  watchPaths: string[];
}

const themeTokens = new Set([
  'bg', 'sidebar', 'panel', 'panel-soft', 'line', 'line-soft', 'text', 'muted', 'subtle',
  'accent', 'green', 'amber', 'red', 'shadow',
]);

function packageRoot(): string {
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = join(cursor, 'package.json');
    if (existsSync(candidate)) {
      try { if (JSON.parse(readFileSync(candidate, 'utf8')).name === 'ztrack') return cursor; } catch { /* continue */ }
    }
    cursor = dirname(cursor);
  }
  throw new Error('Unable to locate the installed ztrack package root.');
}

function containedRealPath(path: string, root: string): string {
  const real = realpathSync(path);
  const realRoot = realpathSync(root);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw new Error(
      `ztrack visualizer: '${path}' resolves to '${real}', outside project root '${realRoot}'.`,
    );
  }
  return real;
}

function extensionError(error: unknown, path: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const stderr = (error as { stderr?: string } | null)?.stderr;
  return `The visualizer extension (${path}) failed to compile:\n\n${stderr?.trim() || raw}`;
}

/** Compile preset + repo presentation into one host-React browser module. */
export async function buildVisualizerExtensionModule(input: { projectRoot: string }): Promise<VisualizerExtensionModuleResult> {
  const projectRoot = resolve(input.projectRoot);
  const root = packageRoot();
  const conventional = trackerVisualizerExtensionPath(projectRoot);
  const watchPaths = [conventional];
  let repoExtension: string | null = null;
  try { if (existsSync(conventional)) repoExtension = containedRealPath(conventional, projectRoot); }
  catch (error) { return { code: null, contentHash: null, error: extensionError(error, conventional), watchPaths }; }

  let shippedExtension: string | null = null;
  try {
    const preset = await resolveTrackerValidation(loadTrackerConfig(projectRoot), projectRoot);
    const candidate = join(root, 'visualizer', 'client', 'presets', `${preset.name}.tsx`);
    if (existsSync(candidate)) shippedExtension = realpathSync(candidate);
  } catch (error) {
    return { code: null, contentHash: null, error: `Unable to resolve the visualizer preset extension: ${error instanceof Error ? error.message : String(error)}`, watchPaths };
  }
  if (shippedExtension) watchPaths.push(shippedExtension);
  if (!repoExtension && !shippedExtension) return { code: null, contentHash: null, error: null, watchPaths };

  const script = join(root, 'scripts', 'build-visualizer-extension.mjs');
  const child = spawnSync('bun', [script], {
    encoding: 'utf8',
    input: JSON.stringify({ projectRoot, packageRoot: root, repoExtension, shippedExtension }),
    maxBuffer: 10 * 1024 * 1024,
  });
  if (child.status !== 0) {
    const error = new Error(child.stderr || child.stdout || `extension builder exited ${child.status}`) as Error & { stderr?: string };
    error.stderr = child.stderr;
    return { code: null, contentHash: null, error: extensionError(error, conventional), watchPaths };
  }
  try {
    const built = JSON.parse(child.stdout) as { code: string; watchPaths: string[] };
    const allWatchPaths = [...new Set([...watchPaths, ...built.watchPaths].map((path) => {
      try { return realpathSync(path); } catch { return resolve(path); }
    }))];
    return {
      code: built.code,
      contentHash: createHash('sha256').update(built.code).digest('hex'),
      error: null,
      watchPaths: allWatchPaths,
    };
  } catch (error) {
    return { code: null, contentHash: null, error: extensionError(error, conventional), watchPaths };
  }
}

/** Load only documented color tokens and map them to host-scoped CSS variables. */
export async function loadVisualizerTheme(input: { projectRoot: string }): Promise<VisualizerThemeResult> {
  const projectRoot = resolve(input.projectRoot);
  const path = join(projectRoot, stateDirName(), 'tracker', 'visualizer', 'theme.css');
  if (!existsSync(path)) return { variables: {}, error: null, watchPaths: [path] };
  let source: string;
  try {
    containedRealPath(path, projectRoot);
    source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  } catch (error) {
    return { variables: {}, error: error instanceof Error ? error.message : String(error), watchPaths: [path] };
  }
  const match = /^(?::root|\.ztrack-root)\s*\{([\s\S]*)\}$/.exec(source);
  if (!match) return { variables: {}, error: `Unsafe visualizer theme '${path}': expected one :root or .ztrack-root token block.`, watchPaths: [path] };
  const variables: Record<string, string> = {};
  for (const raw of match[1]!.split(';')) {
    const declaration = raw.trim();
    if (!declaration) continue;
    const item = /^--([a-z][a-z0-9-]*)\s*:\s*(.+)$/.exec(declaration);
    if (!item || !themeTokens.has(item[1]!)) {
      return { variables: {}, error: `Unsafe visualizer theme '${path}': only documented --<token> declarations are allowed.`, watchPaths: [path] };
    }
    const value = item[2]!.trim();
    if (!value || /[{}@]|url\s*\(|expression\s*\(|!important/i.test(value)) {
      return { variables: {}, error: `Unsafe visualizer theme '${path}': invalid value for --${item[1]}.`, watchPaths: [path] };
    }
    variables[`--ztrack-${item[1]}`] = value;
  }
  return { variables, error: null, watchPaths: [path] };
}
