// Installed-preset demo: a minimal repo-local validation preset.
//
// ztrack uses a single validation pipeline. The loader gathers tracker markdown
// plus the git world, an mdast parser produces a candidate root, one strict
// schema validates it, and pure rules run over the validated root. The
// validated root ({ issues: [...] }) is what `ztrack check`, the visualizer,
// and the SDK all read.
//
// A real installed preset lives at `.volter/tracker/validation/preset.cjs`.
// It is a core Preset built on the shared `createGenericPreset` factory, which
// returns { name, schema, parse, rules, scaffold, primitives }. `rules` is an
// array of pure rules: { name, run } where run = (input) => Finding[] and
// input = { context, root }, root = { issues: [...] }. A Finding is
// { code, severity: 'error' | 'warning', message, issueId?, acId?, evidenceId? }.
//
// You extend a preset by PUSHING a rule onto `module.exports.rules` — no
// monkey-patching. This file shows that pattern as a compact teaching example.
const { createGenericPreset } = require('ztrack/preset-kit');

// 1) Start from the generic preset. `requireSourceMarker: true` adds a built-in
//    rule that every issue body must cite at least one [N] source marker.
module.exports = createGenericPreset({
  name: 'installed-demo',
  requireSourceMarker: true,
});

// 2) Add ONE project-owned rule. Each parsed issue exposes: id, title, summary,
//    status, stateType, assignee, labels[], sourceMarkers[], sections[] (the ##
//    heading titles present in the body), and acceptanceCriteria[]. Here we
//    require every issue body to include a `## Summary` section.
module.exports.rules.push({
  name: 'installed_demo_case_missing_summary',
  run: ({ root }) => root.issues
    .filter((i) => !i.sections.includes('Summary'))
    .map((i) => ({
      code: 'installed_demo_case_missing_summary',
      severity: 'error',
      issueId: i.id,
      message: 'Installed demo preset requires each case body to include a ## Summary section.',
    })),
});
