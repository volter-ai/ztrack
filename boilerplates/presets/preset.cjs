// Repo-local ztrack validation preset.
//
// This file is intentionally plain CommonJS so a fresh project can edit it
// without a build step. It configures the shared `createGenericPreset` factory —
// a single typed validation pipeline: the loader gathers tracker markdown + git
// world, an mdast parser produces a candidate root, one strict Zod
// ValidationInputSchema validates { context, root }, and pure rules run over it.
// The validated root IS the export the CLI, visualizer, and SDK read.
//
// To encode your team's workflow, either flip the config flags below or replace
// the whole export with your own core preset ({ name, schema, parse, rules }).
const { createGenericPreset } = require('ztrack/preset-kit');

module.exports = createGenericPreset({
  name: '__ZTRACK_PRESET_NAME__',
  requireSourceMarker: '__ZTRACK_REQUIRE_SOURCE_MARKER__' === 'true',
  requireSdlcGates: '__ZTRACK_REQUIRE_SDLC_GATES__' === 'true',
  requireSpecSections: '__ZTRACK_REQUIRE_SPEC_SECTIONS__' === 'true',
  requireSpeckitSections: '__ZTRACK_REQUIRE_SPECKIT_SECTIONS__' === 'true',
});
