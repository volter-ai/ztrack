// @ts-nocheck — bundle entry; not part of the tsc build (tsconfig only includes src/**).
// The server-side surface of the ztrack core that the visualizer needs. In a repo
// checkout the server imports this directly from src/. For the published package
// the build bundles it to visualizer/core.js (mirroring how dist/cli.js is built),
// so the visualizer stays self-contained without shipping the engine as loose modules.
export { check } from '../src/core/engine.ts';
export { resolvePreset } from '../src/core/registry.ts';
export { observeChanges, readAudit, timestampsFor } from '../src/core/audit.ts';
export { buildSpeckitBundle } from '../src/presets/speckitCore.ts';
// The board view routes through the SAME loaders as `ztrack check`/`export`: the
// active preset is resolved from the repo's tracker-config `validation.entrypoint`
// (so repo-local presets like peak's load), and issues are read via the configured
// backend (so sqlite-backed repos work), not by globbing tracker/*.md. Reuse — do
// not duplicate — these so the visualizer can never drift from the check pipeline.
export { loadTrackerConfig } from '../src/config.ts';
export { resolveTrackerValidation } from '../src/presetRegistry.ts';
export { loadValidationInput } from '../src/core/loader.ts';
