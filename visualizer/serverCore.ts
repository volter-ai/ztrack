// @ts-nocheck — bundle entry; not part of the tsc build (tsconfig only includes src/**).
// The server-side surface of the ztrack core that the visualizer needs. In a repo
// checkout the server imports this directly from src/. For the published package
// the build bundles it to visualizer/core.js (mirroring how dist/cli.js is built),
// so the visualizer stays self-contained without shipping the engine as loose modules.
export { check } from '../src/core/engine.ts';
export { observeChanges, readAudit, timestampsFor } from '../src/core/audit.ts';
export { buildSpeckitBundle } from '../boilerplates/presets/speckit.ts';

// Resolve a STANDALONE preset by name (the `ztrack visualizer --preset <name>` view of a tracker
// with no configured validation entrypoint). The alias + canonical name come from the shared
// preset manifest; the boilerplate is then dynamic-imported from the shipped presets dir — no
// static catalog here, so it scales as presets are added (same source as `ztrack init`).
import { resolvePresetName } from '../src/presetCatalog.ts';
export async function resolvePreset(name) {
  const canonical = resolvePresetName(name);
  const mod = await import(new URL(`../boilerplates/presets/${canonical}.ts`, import.meta.url).href);
  return mod.default;
}

// The board view routes through the SAME loaders as `ztrack check`/`export`: the active
// preset is resolved from the repo's tracker-config `validation.entrypoint` (so repo-local
// presets load), and issues are read via the configured backend. Reuse — do not duplicate —
// these so the visualizer can never drift from the check pipeline.
export { loadTrackerConfig, cacheRoot, stateDirName } from '../src/config.ts';
export { resolveTrackerValidation } from '../src/presetRegistry.ts';
export { loadValidationInput } from '../src/core/loader.ts';
