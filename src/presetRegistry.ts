import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import type { TrackerConfig } from './types.ts';
import type { TrackerPresetRuntime } from './presets.ts';
import { GENERIC_PRESET } from './presets/genericRuntime.ts';

export function resolveTrackerPreset(value: string | undefined): TrackerPresetRuntime {
  if (!value || value === 'generic' || value === 'default' || value === 'peak' || value === 'ztrack/presets/generic') return GENERIC_PRESET;
  throw new Error(`Unsupported tracker validation preset '${value}'. Available presets: generic`);
}

function assertTrackerPresetRuntime(value: unknown, source: string): TrackerPresetRuntime {
  if (!value || typeof value !== 'object') {
    throw new Error(`Validation entrypoint ${source} did not export a tracker preset runtime object`);
  }
  const runtime = value as Partial<TrackerPresetRuntime>;
  if (typeof runtime.name !== 'string' || typeof runtime.parseIssueMarkdown !== 'function' || typeof runtime.markdownDiagnostics !== 'function') {
    throw new Error(`Validation entrypoint ${source} is missing required tracker preset runtime fields`);
  }
  return runtime as TrackerPresetRuntime;
}

function loadValidationEntrypoint(entrypoint: string, projectRoot: string): TrackerPresetRuntime {
  const absolutePath = isAbsolute(entrypoint) ? entrypoint : resolve(projectRoot, entrypoint);
  if (!existsSync(absolutePath)) {
    throw new Error(`Configured tracker validation entrypoint does not exist: ${absolutePath}`);
  }
  const require = createRequire(import.meta.url);
  const loaded = require(absolutePath) as { default?: unknown; preset?: unknown } | unknown;
  const candidate = loaded && typeof loaded === 'object'
    ? ((loaded as { preset?: unknown; default?: unknown }).preset ?? (loaded as { default?: unknown }).default ?? loaded)
    : loaded;
  return assertTrackerPresetRuntime(candidate, absolutePath);
}

export function resolveTrackerValidation(config: TrackerConfig, projectRoot = process.cwd()): TrackerPresetRuntime {
  const entrypoint = config.validation?.entrypoint?.trim();
  if (entrypoint) return loadValidationEntrypoint(entrypoint, projectRoot);
  return resolveTrackerPreset(config.organization?.validationPreset);
}
