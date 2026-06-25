// @ts-nocheck — bundle entry; not part of the tsc build (tsconfig only includes src/**).
// The server-side surface of the ztrack core that the visualizer needs. In a repo
// checkout the server imports this directly from src/. For the published package
// the build bundles it to visualizer/core.js (mirroring how dist/cli.js is built),
// so the visualizer stays self-contained without shipping the engine as loose modules.
export { check } from '../src/core/engine.ts';
export { observeChanges, readAudit, timestampsFor } from '../src/core/audit.ts';
export { buildSpeckitBundle } from '../boilerplates/presets/speckit.ts';

// Resolve a STANDALONE preset by name (the `ztrack visualizer --preset <name>` mode).
// There is no catalog/registry — the presets are standalone modules, so this is just a
// small static map over them.
import SimpleSdlcPreset from '../boilerplates/presets/simple-sdlc.ts';
import SimpleGhSdlcPreset from '../boilerplates/presets/simple-gh-sdlc.ts';
import SpecPreset from '../boilerplates/presets/spec.ts';
import SpeckitPreset from '../boilerplates/presets/speckit.ts';
// `default` is an alias for the baseline simple-sdlc (matches config.ts's preset resolution).
const STANDALONE_PRESETS = { 'simple-sdlc': SimpleSdlcPreset, 'simple-gh-sdlc': SimpleGhSdlcPreset, default: SimpleSdlcPreset, spec: SpecPreset, speckit: SpeckitPreset };
export function resolvePreset(name) {
  const preset = STANDALONE_PRESETS[name];
  if (!preset) throw new Error(`Unknown preset '${name}'. Available: ${Object.keys(STANDALONE_PRESETS).join(', ')}.`);
  return preset;
}

// The board view routes through the SAME loaders as `ztrack check`/`export`: the active
// preset is resolved from the repo's tracker-config `validation.entrypoint` (so repo-local
// presets load), and issues are read via the configured backend. Reuse — do not duplicate —
// these so the visualizer can never drift from the check pipeline.
export { loadTrackerConfig } from '../src/config.ts';
export { resolveTrackerValidation } from '../src/presetRegistry.ts';
export { loadValidationInput } from '../src/core/loader.ts';
