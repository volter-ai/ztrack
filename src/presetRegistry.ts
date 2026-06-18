import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import type { TrackerConfig } from './types.ts';
import type { CoreRoot, Preset } from './core/engine.ts';

export function noTrackerValidation(value: string | undefined): never {
  throw new Error(value
    ? `Unsupported legacy organization.validationPreset '${value}'. Run 'ztrack init --preset basic' to install repo-local validation.`
    : "No tracker validation entrypoint configured. Run 'ztrack init --preset basic' to install .volter/tracker/validation/preset.cjs.");
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

function loadValidationEntrypoint(entrypoint: string, projectRoot: string): Preset<CoreRoot> {
  // SECURITY: loading the entrypoint executes it as Node code. Confine it to the
  // project so a config can't point `require()` at an arbitrary file on the host;
  // running `ztrack` on a repo still executes that repo's preset (see SECURITY.md).
  const root = resolve(projectRoot);
  const absolutePath = resolve(projectRoot, entrypoint);
  if (absolutePath !== root && !absolutePath.startsWith(root + sep)) {
    throw new Error(`Tracker validation entrypoint must live inside the project — '${entrypoint}' escapes ${root}.`);
  }
  if (!existsSync(absolutePath)) {
    throw new Error(`Configured tracker validation entrypoint does not exist: ${absolutePath}`);
  }
  const require = createRequire(import.meta.url);
  const loaded = require(absolutePath) as { default?: unknown; preset?: unknown } | unknown;
  const candidate = loaded && typeof loaded === 'object'
    ? ((loaded as { preset?: unknown; default?: unknown }).preset ?? (loaded as { default?: unknown }).default ?? loaded)
    : loaded;
  return assertCorePreset(candidate, absolutePath);
}

/** Resolve the active preset — a core `Preset` exported by the repo-local
 *  `validation.entrypoint` (e.g. `createGenericPreset({...})`). One pipeline; there
 *  is no separate snapshot runtime. */
export function resolveTrackerValidation(config: TrackerConfig, projectRoot = process.cwd()): Preset<CoreRoot> {
  const entrypoint = config.validation?.entrypoint?.trim();
  if (entrypoint) return loadValidationEntrypoint(entrypoint, projectRoot);
  return noTrackerValidation(config.organization?.validationPreset);
}
