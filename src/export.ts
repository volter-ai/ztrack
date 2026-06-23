// `ztrack export` — write the validated root. The committed CI artifact IS the
// validated root (`{ issues: [...] }`), the same model rules and the visualizer
// read; there is no separate snapshot shape.
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { loadValidationInput } from './core/loader.ts';
import { check, parseWaivers, type CoreRoot, type WaiverDirective } from './core/engine.ts';

export type TrackerExportOptions = {
  projectRoot?: string;
  limit?: number;
  issues?: string[];
};

// The committed root may carry the issues' `## Waivers` directives so a `check --input`
// re-check honors them faithfully (they downgrade findings, and are part of the validated
// state). They live alongside `issues`, NOT inside the strict per-preset root schema.
export type ExportedRoot = CoreRoot & { waivers?: WaiverDirective[] };

/** Parse + validate the live tracker and return the validated root. Throws if the
 *  store does not satisfy the preset's schema (the root must be well-formed to be
 *  a meaningful export). */
export async function exportTrackerRoot(options: TrackerExportOptions = {}): Promise<ExportedRoot> {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = loadTrackerConfig(projectRoot);
  const preset = await resolveTrackerValidation(config, projectRoot);
  const { records, context } = await loadValidationInput(preset, {
    projectRoot,
    ...(options.issues ? { issues: options.issues } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
  });
  const result = check(preset, records, context);
  if (!result.export) {
    throw new Error(`Cannot export: the tracker does not satisfy the ${preset.name} schema:\n${result.findings.map((f) => `  - ${f.code}: ${f.message}`).join('\n')}`);
  }
  const waivers = parseWaivers(records);
  return waivers.length ? { ...result.export, waivers } : result.export;
}

export { acVersionForItemBody } from './acVersion.ts';
