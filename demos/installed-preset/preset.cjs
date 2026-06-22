// Installed-preset demo: a minimal repo-local validation preset, in the shape
// `ztrack init` installs.
//
// ztrack is used as a LIBRARY: the engine, markdown parser, and root schema are rented
// from `ztrack/preset-kit`; the RULES are declarative records over the engine's derived
// model — no imperative `run`, no monkey-patching. Each rule:
//
//   { code, severity?, category?, depth?, select, when?, message }
//     select(model)        -> the list to check (a scope, an aggregate, a derived fact)
//     when(item, model)?   -> keep only matches (omit = keep all)
//     message(item, model) -> the finding text; issueId/acId/evidenceId come off the item
//
// The model exposes: root, context, issues, acs, evidence, duplicateIssueIds,
// duplicateAcIds, graph: { cycles, blockerProblems, completionViolations }, derived.
// You extend the preset by editing the `rules` array — add, change, or remove records.
const { definePreset, rule, gitWorld, genericParser, genericSchema, genericScaffold } =
  require('ztrack/preset-kit');

const name = 'installed-demo';

// Project-owned rules, as records. (A real install starts from the full generic record
// set; this compact example writes two from scratch to show the shape.)
const rules = [
  // every issue body must cite at least one [N] source marker
  rule({
    code: `${name}_case_missing_source_marker`, category: 'sourced', depth: 1,
    select: (m) => m.issues,
    when: ({ issue }) => issue.sourceMarkers.length === 0,
    message: () => 'Case body must cite at least one [N] source marker.',
  }),
  // every issue body must include a ## Summary section
  rule({
    code: `${name}_case_missing_summary`,
    select: (m) => m.issues,
    when: ({ issue }) => !issue.sections.includes('Summary'),
    message: () => 'Installed demo preset requires each case body to include a ## Summary section.',
  }),
];

module.exports = definePreset({
  name,
  schema: genericSchema,                    // rented: the strict root shape
  parse: genericParser,                     // rented: markdown -> the schema shape
  loadContext: (input) => gitWorld(input.projectRoot, [], { verifyCommits: input.verifyCommits }),
  rules,
  scaffold: genericScaffold({ name, requireSourceMarker: true }),
  primitives: { labels: true, blocking: true, sources: false, proof: false, relations: false, linkedIssues: false, children: false, category: false },
});
