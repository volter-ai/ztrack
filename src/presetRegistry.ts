import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TrackerConfig } from './types.ts';
import type { CoreRoot, Preset } from './core/engine.ts';

export function noTrackerValidation(value: string | undefined): never {
  throw new Error(value
    ? `Unsupported legacy organization.validationPreset '${value}'. Run 'ztrack init --preset default' to install repo-local validation.`
    : "No tracker validation entrypoint configured. Run 'ztrack init --preset default' to install .volter/tracker/validation/preset.mts.");
}

function assertCorePreset(value: unknown, source: string): Preset<CoreRoot> {
  if (!value || typeof value !== 'object') {
    throw new Error(`Validation entrypoint ${source} did not export a preset object`);
  }
  const preset = value as Partial<Preset<CoreRoot>>;
  if (typeof preset.name !== 'string' || !preset.schema || typeof preset.parse !== 'function' || !Array.isArray(preset.rules)) {
    throw new Error(`Validation entrypoint ${source} is not a core preset (need name, schema, parse, rules)`);
  }
  return value as Preset<CoreRoot>;
}

async function loadValidationEntrypoint(entrypoint: string, projectRoot: string): Promise<Preset<CoreRoot>> {
  // SECURITY: loading the entrypoint executes it as Node code. Confine it to the
  // project so a config can't point the import at an arbitrary file on the host;
  // running `ztrack` on a repo still executes that repo's preset (see SECURITY.md).
  const root = resolve(projectRoot);
  const absolutePath = resolve(projectRoot, entrypoint);
  if (absolutePath !== root && !absolutePath.startsWith(root + sep)) {
    throw new Error(`Tracker validation entrypoint must live inside the project — '${entrypoint}' escapes ${root}.`);
  }
  if (!existsSync(absolutePath)) {
    throw new Error(`Configured tracker validation entrypoint does not exist: ${absolutePath}`);
  }
  // Loaded via dynamic import so a preset can be a plain ESM `.ts`/`.js` module (no `.cjs`
  // bundle, no `require`). Dynamic import also loads CommonJS, so an existing `.cjs` preset
  // keeps resolving — the export is read off `default`.
  let loaded: { default?: unknown; preset?: unknown };
  try {
    loaded = await import(pathToFileURL(absolutePath).href) as { default?: unknown; preset?: unknown };
  } catch (err) {
    // The installed preset imports `ztrack/preset-kit`; that bare specifier resolves from the
    // PROJECT's node_modules. If ztrack isn't a dependency there (e.g. it was run via `npx`
    // without being installed), the import fails — turn the raw resolver error into a fix.
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | undefined)?.code;
    // The installed preset is a `.mts` loaded via Node's native type stripping (unflagged on Node
    // >= 22.18 / >= 23.6 / >= 24). On older Node the import fails with ERR_UNKNOWN_FILE_EXTENSION —
    // turn that cryptic error into a clear "upgrade Node" message.
    if (code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension "\.?mts"/.test(msg)) {
      throw new Error(
        `The validation preset (${entrypoint}) is a .mts file, loaded via Node's native TypeScript type `
        + `stripping — which this Node (${process.version}) does not support. ztrack needs Node >= 22.18.0 `
        + `(or >= 23.6, or >= 24). Upgrade Node and re-run.`,
      );
    }
    if (/Cannot find package 'ztrack'|Cannot find module 'ztrack/.test(msg)) {
      throw new Error(
        `The validation preset (${entrypoint}) imports 'ztrack/preset-kit', but the 'ztrack' package isn't resolvable from this project. `
        + `Install it as a dependency so the preset can load it:\n\n    npm install -D ztrack\n\n`
        + `(ztrack works like eslint — the preset is your config and imports the mechanism from the installed package; a global or one-off 'npx' install is not enough.)`,
      );
    }
    throw err;
  }
  const candidate = loaded.preset ?? loaded.default ?? loaded;
  return assertCorePreset(candidate, absolutePath);
}

/** Resolve the active preset — a standalone core `Preset` exported by the repo-local
 *  `validation.entrypoint` (its own schema/parser/rules; see ARCHITECTURE.md §3). One
 *  pipeline; there is no separate snapshot runtime. */
export async function resolveTrackerValidation(config: TrackerConfig, projectRoot = process.cwd()): Promise<Preset<CoreRoot>> {
  const entrypoint = config.validation?.entrypoint?.trim();
  if (entrypoint) return loadValidationEntrypoint(entrypoint, projectRoot);
  return noTrackerValidation(config.organization?.validationPreset);
}
