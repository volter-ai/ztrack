// boilerplates/visualizer/extension.tsx — VIZ-16: a worked, copy-paste-ready example of a
// repo-owned dashboard extension. The code-seam analog of `boilerplates/presets/*.ts`: where a
// preset is the DATA extension point (schema/parser/rules, `ztrack/preset-kit`), this file is the
// CODE extension point (render-only dashboard panels, `ztrack/visualizer-kit`) — see
// `boilerplates/README.md` for how to copy it into a real repo.
//
// It imports ONLY `ztrack/visualizer-kit` — the ONE stable seam a dashboard extension author
// should ever depend on. Nothing here reaches into `src/core/engine.ts`, a preset's own schema
// module, or the visualizer client's internals — a grep over this file's import lines must hit
// only that one package (`boilerplates/visualizer/extension.e2e.test.tsx` enforces it).
//
// Drop this file (unedited — it already works) at `<stateDir>/tracker/visualizer/extension.tsx`
// (e.g. `.volter/tracker/visualizer/extension.tsx`) in a real ztrack repo and the running board
// picks it up on the very next `/assets/app.js` fetch — no server restart required (VIZ-13
// dev/04). From there, edit freely: it's a starting point, not a fixed feature.
//
// Note on JSX: this file has no top-level React import at all — the visualizer's build aliases
// the automatic JSX runtime for every repo extension, even one whose own project has no react
// package installed at all (VIZ-13 dev/06). Writing JSX below is enough on its own.
//
// ── what this example shows ───────────────────────────────────────────────────────────────────
// Two independent `VisualizerExtension` members (src/visualizerKit.ts), demonstrated against the
// `simple-sdlc` preset (`boilerplates/presets/simple-sdlc.ts`)'s own mapped fields — but note both
// `ac.proof` and `ac.evidence` are CORE fields (`src/core/engine.ts`'s `CoreAC`), present with
// this exact shape on every preset that declares the `proof` primitive, not ride-along fields
// unique to simple-sdlc. So this same file also works, unedited, against speckit or a custom
// preset — copy it and see for yourself.
//
//   1. `issuePanels` — ONE custom issue-level panel, "Proof coverage": for every acceptance
//      criterion on the open issue, is there BOTH a `proof` (an explanation citing evidence) AND
//      does that proof actually cite evidence that exists? Rendered inside the issue detail
//      drawer, alongside the core "Acceptance Criteria" panel (`visualizer/client/main.tsx`'s
//      `{ext.issuePanels?.(issue, projectUrl)}` slot, ~:342). Useful triage: a reviewer can see at
//      a glance whether an issue claiming to be done actually has its claims backed.
//
//   2. `acEvidence` — ONE custom renderer for a single AC's evidence list, replacing whatever the
//      DATA layer (the preset's own `visualizer.acEvidence` field mapping) would otherwise render
//      as a plain default. Renders a compact line per evidence entry: a short commit sha, the AC
//      version it was recorded against, and — when the entry attaches a screenshot/artifact — a
//      real link built via `projectUrl` (the same project-relative URL mapper `issuePanels`
//      receives, so evidence files resolve under the project root).
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';
import type { CoreAC, CoreIssue } from 'ztrack/visualizer-kit';

// `CoreAC.evidence` is typed as `CoreEvidence[]` (`{ id: string; [k: string]: unknown }` — only
// `id` is guaranteed). simple-sdlc's own evidence mapping (`DEFAULT_VISUALIZER.acEvidence` in
// `boilerplates/presets/simple-sdlc.ts`) names the ride-along keys this example reads:
// `image`, `commit`, `acVersion`. Typed locally, the same way `visualizer/client/presets/
// speckit.tsx` casts its own preset-specific ride-along fields.
interface Evidence {
  id: string;
  image?: string;
  commit?: string;
  acVersion?: number | string;
}

function evidenceOf(ac: CoreAC): Evidence[] {
  return ac.evidence as Evidence[];
}

// `ac.proof` IS a core field (`Proof` in `src/core/engine.ts`: `{ explanation, evidenceRefs }`),
// shared by every preset that turns the `proof` primitive on — unlike `evidence`'s ride-along
// keys above, this shape needs no preset-specific interpretation.
function proofOf(ac: CoreAC): { explanation: string; evidenceRefs: string[] } | undefined {
  return ac.proof as { explanation: string; evidenceRefs: string[] } | undefined;
}

/** True only when an AC has a non-empty proof explanation AND every evidence ref it cites
 *  resolves to a real evidence entry on the same AC — the same "backed claim" bar the core
 *  gate itself enforces (proof_cites_no_evidence / proof_evidence_ref_missing), rendered here
 *  purely for human triage, not re-validated. */
function proofIsBacked(ac: CoreAC): boolean {
  const proof = proofOf(ac);
  if (!proof || proof.explanation.trim().length === 0 || proof.evidenceRefs.length === 0) return false;
  const evidenceIds = new Set(evidenceOf(ac).map((e) => e.id));
  return proof.evidenceRefs.every((ref) => evidenceIds.has(ref));
}

export default defineVisualizerExtension({
  // ── 1. the custom "Proof coverage" panel ────────────────────────────────────────────────────
  issuePanels: (issue: CoreIssue) => {
    const acs = issue.acceptanceCriteria;
    const backedCount = acs.filter(proofIsBacked).length;
    return (
      <section className="panel">
        <div className="panel-title">
          <h3>Proof coverage</h3>
          <span>{backedCount}/{acs.length}</span>
        </div>
        {acs.length === 0 ? (
          <div className="empty">No acceptance criteria on this issue.</div>
        ) : (
          <div className="ac-list">
            {acs.map((ac) => {
              const proof = proofOf(ac);
              const evidence = evidenceOf(ac);
              const backed = proofIsBacked(ac);
              return (
                <div className={`ac-row${backed ? ' checked' : ''}`} key={ac.id}>
                  <span className="check">{backed ? '✓' : '✗'}</span>
                  <div className="ac-body">
                    <div>
                      <strong>{ac.id}</strong>{' — '}
                      {evidence.length} evidence entr{evidence.length === 1 ? 'y' : 'ies'}
                      {proof ? `, ${proof.evidenceRefs.length} cited by its proof` : ', no proof recorded'}
                    </div>
                    {!backed && (
                      <div className="ac-descope-reason">
                        {proof ? 'proof cites a ref with no matching evidence entry' : 'missing a proof'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  },

  // ── 2. the custom acEvidence renderer ───────────────────────────────────────────────────────
  acEvidence: (ac: CoreAC, projectUrl: (path: string) => string) => {
    const evidence = evidenceOf(ac);
    if (evidence.length === 0) return null;
    return (
      <ul className="evidence-lines">
        {evidence.map((e) => (
          <li key={e.id}>
            <code>{e.id}</code>
            {e.commit && <span> {e.commit.slice(0, 7)}</span>}
            {e.acVersion !== undefined && <span> v{e.acVersion}</span>}
            {e.image && (
              <a href={projectUrl(e.image)} target="_blank" rel="noreferrer">
                {' '}{e.image}
              </a>
            )}
          </li>
        ))}
      </ul>
    );
  },
});
