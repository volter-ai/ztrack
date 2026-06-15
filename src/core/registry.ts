// The preset catalog: name -> preset, on the one core contract. Every SDLC
// system the tracker understands is registered here. The CLI and any other
// affordance resolve a preset by name through this map; they never import a
// specific preset directly.
//
// Core-contract native: default, spec, speckit (speckitCore), peak (peakCore). The
// new conformant peak lives beside the sprawling legacy peak.ts (which stays on its
// own contract and is NOT registered here). The transitional spine contract and its
// spine-only presets (the old speckit/openspec) were retired — see SPINE-HARVEST.md;
// openspec was unused and dropped rather than re-ported.

import type { CoreRoot, Preset } from './engine.ts';
import { DefaultPreset } from '../presets/default.ts';
import { SpecPreset } from '../presets/spec.ts';
import { SpeckitPreset } from '../presets/speckitCore.ts';
import { PeakPreset } from '../presets/peakCore.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PRESETS: Record<string, Preset<any>> = {
  [DefaultPreset.name]: DefaultPreset,
  [SpecPreset.name]: SpecPreset,
  [SpeckitPreset.name]: SpeckitPreset,
  [PeakPreset.name]: PeakPreset,
};

export function resolvePreset(name: string): Preset<CoreRoot> {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`Unknown preset "${name}". Available: ${Object.keys(PRESETS).join(', ')}`);
  }
  return preset as Preset<CoreRoot>;
}
