// @ts-nocheck — bundle entry; not part of the tsc build (tsconfig only includes src/**).
// The server-side surface of the ztrack core that the visualizer needs. In a repo
// checkout the server imports this directly from src/. For the published package
// the build bundles it to visualizer/core.js (mirroring how dist/cli.js is built),
// so the visualizer stays self-contained without shipping the engine as loose modules.
export { check } from '../src/core/engine.ts';
export { resolvePreset } from '../src/core/registry.ts';
export { gitWorld, prBranchesFrom } from '../src/core/gitWorld.ts';
export { observeChanges, readAudit, timestampsFor } from '../src/core/audit.ts';
export { buildSpeckitBundle } from '../src/presets/speckitCore.ts';
