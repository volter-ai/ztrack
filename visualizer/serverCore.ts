// @ts-nocheck — bundle entry; not part of the tsc build (tsconfig only includes src/**).
// The server-side surface of the ztrack core that the visualizer needs. In a repo
// checkout the server imports this directly from src/. For the published package
// the build bundles it to visualizer/core.js (mirroring how dist/cli.js is built),
// so the visualizer stays self-contained without shipping the engine as loose modules.
export { check, VisualizerSpecSchema } from '../src/core/engine.ts';
export { observeChanges, readAudit, timestampsFor } from '../src/core/audit.ts';
export { buildSpeckitBundle } from '../boilerplates/presets/speckit.ts';

// VIZ-3: mtime-keyed live-edit cache bust — visualizer-side ONLY (never wired into any CLI path;
// CLI runs are per-process and need no invalidation). Bun's ESM import cache returns a stale
// module after the imported file is edited on disk (verified — src/presetRegistry.ts:91 is the
// same `import(pathToFileURL(...).href)` shape), and a `?v=<mtime>` query bust does NOT work
// under Bun (verified; it works only under Node, which is irrelevant — the visualizer requires
// Bun, src/cli.ts:228-230). The one mechanism verified effective on Bun 1.3.14 is
// `delete require.cache[<absolute path>]`. This is a deliberate, bounded module-instance leak per
// edit — acceptable for a local dev tool. Shared by both preset-loading paths (this file's own
// `resolvePreset`, and server.ts's use for the repo-config `validation.entrypoint` path) so there
// is exactly one bust implementation, keyed on the actual file each path imports.
import { statSync } from 'node:fs';
const presetMtimes = new Map();
export function bustPresetCacheIfChanged(absolutePath) {
  let mtimeMs;
  try { mtimeMs = statSync(absolutePath).mtimeMs; } catch { return; } // file gone — nothing to bust
  const prev = presetMtimes.get(absolutePath);
  if (prev !== undefined && prev !== mtimeMs) delete require.cache[absolutePath];
  presetMtimes.set(absolutePath, mtimeMs);
}

// Resolve a STANDALONE preset by name (the `ztrack visualizer --preset <name>` view of a tracker
// with no configured validation entrypoint). The alias + canonical name come from the shared
// preset manifest; the boilerplate is then dynamic-imported from the shipped presets dir — no
// static catalog here, so it scales as presets are added (same source as `ztrack init`).
import { resolvePresetName } from '../src/presetCatalog.ts';
import { fileURLToPath } from 'node:url';
export async function resolvePreset(name) {
  const canonical = resolvePresetName(name);
  const url = new URL(`../boilerplates/presets/${canonical}.ts`, import.meta.url);
  bustPresetCacheIfChanged(fileURLToPath(url)); // this boilerplate file is itself editable during local dev
  const mod = await import(url.href);
  return mod.default;
}

// The board view routes through the SAME loaders as `ztrack check`/`export`: the active
// preset is resolved from the repo's tracker-config `validation.entrypoint` (so repo-local
// presets load), and issues are read via the configured backend. Reuse — do not duplicate —
// these so the visualizer can never drift from the check pipeline.
export { loadTrackerConfig, cacheRoot, stateDirName } from '../src/config.ts';
export { resolveTrackerValidation } from '../src/presetRegistry.ts';
export { loadValidationInput } from '../src/core/loader.ts';
