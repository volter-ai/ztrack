// Repo-local ztrack validation preset — REAL, EDITABLE CODE, not a config shim.
//
// ztrack is used here as a LIBRARY: the engine, the markdown parser, and the root
// schema are imported (rented); your RULES live right here as declarative records you
// can read, edit, delete, or extend. Each rule SELECTS a list off the engine's analyzed
// model and DESCRIBES each match:
//
//   { code, severity?, category?, depth?, select, when?, message }
//     select(model)        -> the list to check (a scope, an aggregate, a derived fact)
//     when(item, model)?   -> keep only matches (omit = keep all)
//     message(item, model) -> the finding text; issueId/acId/evidenceId come off the item
//
// The model a rule reads:
//   { root, context, issues, acs, evidence,
//     duplicateIssueIds, duplicateAcIds,
//     graph: { cycles, blockerProblems, completionViolations },
//     derived }                              // derived = this file's own analysis (see derive)
//
// Plain CommonJS, so editing is zero-build. To change your team's workflow, edit the
// records below; to start fresh, replace `rules`/`derive` entirely.
const {
  definePreset, rule, formatRef, gitWorld, genericParser, genericSchema, genericScaffold,
} = require('ztrack/preset-kit');

const name = '__ZTRACK_PRESET_NAME__';
const requireSourceMarker = '__ZTRACK_REQUIRE_SOURCE_MARKER__' === 'true';
const requireSdlcGates = '__ZTRACK_REQUIRE_SDLC_GATES__' === 'true';
const requireSpecSections = '__ZTRACK_REQUIRE_SPEC_SECTIONS__' === 'true';
const requireSpeckitSections = '__ZTRACK_REQUIRE_SPECKIT_SECTIONS__' === 'true';

const code = (suffix) => `${name}_${suffix}`;
const codeDepth = { category: 'code', depth: 2 };
const shaMatches = (a, b) => a.startsWith(b) || b.startsWith(a);
const isCanceled = (i) => i.stateType.toLowerCase() === 'canceled';
const isDone = (i) => ['done', 'completed'].includes((i.stateType || i.status).toLowerCase());

const rules = [
  // cross-issue: ids unique across the framed tracker root.
  rule({
    code: code('duplicate_issue_id'), waivable: false, select: (m) => m.duplicateIssueIds,
    message: (x) => `Duplicate issue id ${x.issueId} in the tracker.`,
  }),
  // an explicit `status:` must not contradict the GFM checkbox.
  rule({
    code: code('checkbox_status_mismatch'), waivable: false, select: (m) => m.acs,
    when: ({ ac }) => (ac.checked && ac.status !== 'passed') || (!ac.checked && ac.status === 'passed'),
    message: ({ ac }) => `AC ${ac.id} checkbox (${ac.checked ? '[x]' : '[ ]'}) disagrees with status "${ac.status}".`,
  }),
  rule({
    code: code('case_missing_assignee'), select: (m) => m.issues,
    when: ({ issue }) => !isCanceled(issue) && issue.assignee.trim() === '',
    message: () => 'Non-canceled cases must have an assignee.',
  }),
  // checked-AC evidence/commit gates (commit existence comes from the model's git context).
  rule({
    code: code('checked_ac_missing_commit_hash'), ...codeDepth, select: (m) => m.acs,
    when: ({ ac }) => (ac.checked || ac.status === 'passed') && ac.commitHashes.length === 0,
    message: ({ ac }) => `Checked AC ${ac.id} does not cite a commit hash.`,
  }),
  rule({
    code: code('checked_ac_commit_hash_missing'), ...codeDepth, select: (m) => m.derived.missingCommitHashes,
    message: ({ acId, sha }) => `Checked AC ${acId} cites missing commit ${sha}.`,
  }),
  rule({
    code: code('checked_ac_missing_evidence'), ...codeDepth, select: (m) => m.acs,
    when: ({ ac }) => (ac.checked || ac.status === 'passed') && ac.evidenceRefs.length === 0,
    message: ({ ac }) => `Checked AC ${ac.id} does not cite evidence.`,
  }),
  rule({
    code: code('checked_ac_unknown_evidence'), ...codeDepth, select: (m) => m.derived.unknownEvidenceRefs,
    message: ({ acId, ref }) => `Checked AC ${acId} cites unknown evidence ${ref}.`,
  }),
  // blocking integrity over the unified dependency graph (analyzed once by the engine).
  rule({
    code: code('ac_self_block'), waivable: false, select: (m) => m.graph.blockerProblems, when: (b) => b.kind === 'self',
    message: (b) => `AC ${formatRef({ issue: b.issueId, ac: b.acId })} lists itself as a blocker.`,
  }),
  rule({
    code: code('ac_blocker_missing'), waivable: false, select: (m) => m.graph.blockerProblems, when: (b) => b.kind !== 'self',
    message: (b) => `AC ${formatRef({ issue: b.issueId, ac: b.acId })} references ${b.refText}, which does not exist.`,
  }),
  rule({
    code: code('ac_block_cycle'), waivable: false, select: (m) => m.graph.cycles,
    message: ({ cycle }) => `Blocking cycle: ${cycle.join(' → ')} → ${cycle[0]} can never be satisfied.`,
  }),
  rule({
    code: code('ac_blocked_by_unpassed'), waivable: false, select: (m) => m.graph.completionViolations,
    message: ({ nodeKey, depKey, depStatus }) => `${nodeKey} is done but depends on ${depKey} (status "${depStatus}").`,
  }),
];

if (requireSourceMarker) {
  rules.push(rule({
    code: code('case_missing_source_marker'), category: 'sourced', depth: 1, select: (m) => m.issues,
    when: ({ issue }) => issue.sourceMarkers.length === 0,
    message: () => 'Case body must cite at least one [N] source marker.',
  }));
}

// one record per required ## section, each emitting its own missing_<section> code.
const sectionRules = (sections) => sections.map((s) => rule({
  code: code(`missing_${s.toLowerCase().replace(/\s+/g, '_')}`), select: (m) => m.issues,
  when: ({ issue }) => !issue.sections.includes(s),
  message: () => `Issue must include a ## ${s} section.`,
}));
if (requireSpecSections) rules.push(...sectionRules(['Requirements', 'Acceptance Criteria']));
if (requireSpeckitSections) rules.push(...sectionRules(['User Stories', 'Functional Requirements', 'Tasks']));

if (requireSdlcGates) {
  rules.push(rule({
    code: code('case_missing_acceptance_criteria'), select: (m) => m.issues,
    when: ({ issue }) => !isCanceled(issue) && issue.acceptanceCriteria.length === 0,
    message: () => 'Active cases must include at least one acceptance criterion.',
  }));
  rules.push(rule({
    code: code('done_with_unpassed_acceptance_criteria'), select: (m) => m.issues,
    when: ({ issue }) => {
      if (!isDone(issue)) return false;
      // settled = passed OR explicitly descoped (the in-the-open scope decision). `blocked`
      // is NOT settled. And a done case needs >=1 ACTUALLY passed AC — descoping every
      // criterion isn't "done", it's a no-op (cancel it), and would be a free bypass.
      const acs = issue.acceptanceCriteria;
      const settled = acs.filter((ac) => ac.checked || ac.status === 'passed' || ac.status === 'descoped').length;
      const passed = acs.filter((ac) => ac.checked || ac.status === 'passed').length;
      return acs.length === 0 || settled < acs.length || passed === 0;
    },
    message: () => 'Done cases require every acceptance criterion to be passed or descoped, with at least one actually passed (descoping every criterion is not "done").',
  }));
  // a descoped AC must say why — an unjustified descope is as suspect as an unreasoned waiver.
  rules.push(rule({
    code: code('descoped_ac_missing_reason'), select: (m) => m.acs,
    when: ({ ac }) => ac.status === 'descoped' && !(ac.descopeReason && ac.descopeReason.trim()),
    message: ({ ac }) => `Descoped AC ${ac.id} must cite a reason (\`reason: …\`) explaining why it is out of scope.`,
  }));
}

// this preset's own analyzed facts: per-commit and per-evidence-ref problems on checked ACs.
const derive = (model) => {
  const missingCommitHashes = [];
  const unknownEvidenceRefs = [];
  const existing = model.context.git && model.context.git.existingCommits;
  for (const i of model.root.issues) {
    for (const ac of i.acceptanceCriteria) {
      if (!(ac.checked || ac.status === 'passed')) continue;
      if (existing) for (const sha of ac.commitHashes) if (!existing.some((c) => shaMatches(c, sha))) missingCommitHashes.push({ issueId: i.id, acId: ac.id, sha });
      const known = new Set(ac.evidence.map((e) => e.id));
      for (const ref of ac.evidenceRefs) if (!known.has(ref)) unknownEvidenceRefs.push({ issueId: i.id, acId: ac.id, ref });
    }
  }
  return { missingCommitHashes, unknownEvidenceRefs };
};

module.exports = definePreset({
  name,
  schema: genericSchema,                    // rented: the strict root shape (compose your own to extend)
  parse: genericParser,                     // rented: markdown -> the schema shape
  loadContext: (input) => gitWorld(input.projectRoot, [], { verifyCommits: input.verifyCommits }),
  isIssueDone: isDone,                       // terminal state for the block graph's completion gate
  derive,
  rules,
  scaffold: genericScaffold({ name, requireSourceMarker, requireSdlcGates, requireSpecSections, requireSpeckitSections }),
  primitives: { labels: true, blocking: true, sources: false, proof: false, relations: false, linkedIssues: false, children: false, category: false },
});
