// The preset catalog: name -> preset, on the one core contract. Every SDLC
// system the tracker understands is registered here. The CLI and any other
// affordance resolve a preset by name through this map; they never import a
// specific preset directly.
//
// Core-contract native presets: default, spec, speckit (speckitCore). Add a new
// SDLC by writing a Preset against the `engine.ts` contract and registering it here.

import type { CoreRoot, Preset } from './engine.ts';
import { DefaultPreset } from '../presets/default.ts';
import { SpecPreset } from '../presets/spec.ts';
import { SpeckitPreset } from '../presets/speckitCore.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PRESETS: Record<string, Preset<any>> = {
  [DefaultPreset.name]: DefaultPreset,
  [SpecPreset.name]: SpecPreset,
  [SpeckitPreset.name]: SpeckitPreset,
};

export function resolvePreset(name: string): Preset<CoreRoot> {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`Unknown preset "${name}". Available: ${Object.keys(PRESETS).join(', ')}`);
  }
  return preset as Preset<CoreRoot>;
}
