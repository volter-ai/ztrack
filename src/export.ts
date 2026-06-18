// `ztrack export` — write the validated root. The committed CI artifact IS the
// validated root (`{ issues: [...] }`), the same model rules and the visualizer
// read; there is no separate snapshot shape.
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { loadValidationInput } from './core/loader.ts';
import { check, type CoreRoot } from './core/engine.ts';

export type TrackerExportOptions = {
  projectRoot?: string;
  limit?: number;
  issues?: string[];
};

/** Parse + validate the live tracker and return the validated root. Throws if the
 *  store does not satisfy the preset's schema (the root must be well-formed to be
 *  a meaningful export). */
export async function exportTrackerRoot(options: TrackerExportOptions = {}): Promise<CoreRoot> {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = loadTrackerConfig(projectRoot);
  const preset = resolveTrackerValidation(config, projectRoot);
  const { bundle, context } = await loadValidationInput(preset, {
    projectRoot,
    ...(options.issues ? { issues: options.issues } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
  });
  const result = check(preset, bundle, context);
  if (!result.export) {
    throw new Error(`Cannot export: the tracker does not satisfy the ${preset.name} schema:\n${result.findings.map((f) => `  - ${f.code}: ${f.message}`).join('\n')}`);
  }
  return result.export;
}

export { acVersionForItemBody } from './acVersion.ts';
