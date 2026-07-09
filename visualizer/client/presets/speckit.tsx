// The speckit SDLC's FIRST-PARTY code extension (VIZ-4/VIZ-14). AC = user story (priority + MVP
// + scenarios + tasks, with verification-layer commits). Issue-level panels render the rest of
// the captured Spec Kit process: metadata, FR/SC, key entities/edge cases/assumptions/
// clarifications, the plan (technical context + Constitution Check), constitution principles,
// non-story task phases, and design-artifact presence.
//
// Vocabulary (statusOrder/acUnitLabel) is NOT here — it moved to DATA, the `visualizer` block in
// `boilerplates/presets/speckit.ts` (VIZ-2), because this file conforms to the render-only
// `VisualizerExtension` contract (`client/extensions.tsx`), which deliberately excludes
// vocabulary members (VIZ-14's drift guard). This module is discovered by filename at
// bundle-build time (server.ts's generated entry scans `client/presets/*.tsx`, imports this
// file's default export, and calls `registerExtension('speckit', ...)`) — no hardcoded
// name->extension map anywhere.
import React from 'react';
import type { VisualizerExtension } from '../extensions';

type Task = { id: string; title: string; status: string; parallel?: boolean; commit?: string; dependsOn?: string[] };

function TaskList({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) return null;
  return (
    <div className="task-lines">
      {tasks.map((t) => (
        <div className={`task-line${t.status === 'done' ? ' done' : ''}`} key={t.id}>
          <span className="task-box">{t.status === 'done' ? '[x]' : '[ ]'}</span>
          <span className="task-id">{t.id}</span>
          {t.parallel && <span className="task-p">P</span>}
          <span className="task-title">{t.title}</span>
          {t.commit && <code className="task-commit">{t.commit.slice(0, 7)}</code>}
        </div>
      ))}
    </div>
  );
}
function Panel({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return <section className="panel"><div className="panel-title"><h3>{title}</h3>{count !== undefined && <span>{count}</span>}</div>{children}</section>;
}

const speckitExtension: VisualizerExtension = {
  acText: (ac) => {
    const a = ac as { id: string; text?: string; priority?: string; mvp?: boolean; needsClarification?: boolean };
    return (
      <>
        {a.priority && <span className="prio-tag">{a.priority}</span>}{a.mvp && <span className="mvp-tag">🎯 MVP</span>}{' '}
        <strong>{a.id}</strong> {a.text}
        {a.needsClarification && <span className="clar-tag">NEEDS CLARIFICATION</span>}
      </>
    );
  },
  acEvidence: (ac) => {
    const a = ac as { tasks?: Task[]; scenarios?: Array<{ id: string; text: string }> };
    return (
      <>
        {a.scenarios && a.scenarios.length > 0 && <div className="scenarios">{a.scenarios.map((s) => <div className="scenario" key={s.id}>{s.text}</div>)}</div>}
        <TaskList tasks={a.tasks ?? []} />
      </>
    );
  },
  // The kit's issuePanels receives (issue, projectUrl) — the same `/project/` URL mapper
  // acEvidence already gets — so a panel can link evidence/design-artifact files under the
  // project root. This preset's captured process is all inline text/structure today, so
  // projectUrl is unused here, but the parameter is wired through at the call site (main.tsx)
  // for any first-party or repo-local extension (VIZ-13) that needs it.
  issuePanels: (issue, _projectUrl) => {
    const i = issue as {
      metadata?: { featureBranch?: string; status?: string; created?: string; input?: string };
      requirements?: Array<{ id: string; text: string; needsClarification: boolean }>;
      successCriteria?: Array<{ id: string; text: string; needsClarification: boolean }>;
      keyEntities?: Array<{ name: string; description: string }>;
      edgeCases?: string[]; assumptions?: string[]; clarifications?: Array<{ text: string }>;
      phases?: Array<{ name: string; kind: string; tasks: Task[] }>;
      plan?: { present: boolean; technicalContext: Array<{ field: string; value: string }>; constitutionGates: Array<{ text: string; passed?: boolean }>; complexity: string[] };
      constitution?: { present: boolean; principles: string[] };
      artifacts?: { research: boolean; dataModel: boolean; quickstart: boolean; contracts: string[] };
    };
    const m = i.metadata ?? {}, reqs = i.requirements ?? [], scs = i.successCriteria ?? [], plan = i.plan, con = i.constitution, art = i.artifacts;
    return (
      <>
        {(m.featureBranch || m.status || m.created || m.input) && (
          <Panel title="Spec">
            <div className="meta-grid">
              {m.featureBranch && <><span className="primitive-key">branch</span><code>{m.featureBranch}</code></>}
              {m.status && <><span className="primitive-key">status</span><span>{m.status}</span></>}
              {m.created && <><span className="primitive-key">created</span><span>{m.created}</span></>}
              {m.input && <><span className="primitive-key">input</span><span>{m.input}</span></>}
            </div>
          </Panel>
        )}
        {reqs.length > 0 && <Panel title="Functional Requirements" count={reqs.length}><div className="spec-list">{reqs.map((r) => <div className="spec-item" key={r.id}><span className="cat-tag cat-functional-requirement">{r.id}</span> {r.text}{r.needsClarification && <span className="clar-tag">NEEDS CLARIFICATION</span>}</div>)}</div></Panel>}
        {scs.length > 0 && <Panel title="Success Criteria" count={scs.length}><div className="spec-list">{scs.map((c) => <div className="spec-item" key={c.id}><span className="cat-tag cat-success-criterion">{c.id}</span> {c.text}</div>)}</div></Panel>}
        {i.keyEntities && i.keyEntities.length > 0 && <Panel title="Key Entities" count={i.keyEntities.length}><div className="spec-list">{i.keyEntities.map((e) => <div className="spec-item" key={e.name}><strong>{e.name}</strong> — {e.description}</div>)}</div></Panel>}
        {((i.edgeCases?.length ?? 0) > 0 || (i.assumptions?.length ?? 0) > 0 || (i.clarifications?.length ?? 0) > 0) && (
          <Panel title="Edge Cases · Assumptions · Clarifications">
            <div className="spec-list">
              {(i.edgeCases ?? []).map((e, n) => <div className="spec-item" key={`e${n}`}><span className="mini-key">edge</span> {e}</div>)}
              {(i.assumptions ?? []).map((a, n) => <div className="spec-item" key={`a${n}`}><span className="mini-key">assume</span> {a}</div>)}
              {(i.clarifications ?? []).map((c, n) => <div className="spec-item" key={`c${n}`}><span className="mini-key">clarified</span> {c.text}</div>)}
            </div>
          </Panel>
        )}
        {plan?.present && (
          <Panel title="Implementation Plan">
            {plan.technicalContext.length > 0 && <div className="meta-grid">{plan.technicalContext.map((f) => <React.Fragment key={f.field}><span className="primitive-key">{f.field}</span><span>{f.value}</span></React.Fragment>)}</div>}
            {plan.constitutionGates.length > 0 && (
              <div className="gates"><div className="mini-key">Constitution Check</div>{plan.constitutionGates.map((g, n) => <div className={`gate${g.passed === false ? ' failed' : ' ok'}`} key={n}>{g.passed === false ? '✗' : '✓'} {g.text}</div>)}</div>
            )}
          </Panel>
        )}
        {con?.present && con.principles.length > 0 && <Panel title="Constitution" count={con.principles.length}><div className="spec-list">{con.principles.map((p) => <div className="spec-item" key={p}>{p}</div>)}</div></Panel>}
        {(i.phases ?? []).filter((p) => p.tasks.length > 0).map((p) => (
          <Panel title={p.name} key={p.name}><span className={`phase-kind phase-${p.kind}`}>{p.kind}</span><TaskList tasks={p.tasks} /></Panel>
        ))}
        {art && (art.research || art.dataModel || art.quickstart || art.contracts.length > 0) && (
          <Panel title="Design Artifacts">
            <div className="chips">
              {art.research && <span>research.md</span>}
              {art.dataModel && <span>data-model.md</span>}
              {art.quickstart && <span>quickstart.md</span>}
              {art.contracts.map((c) => <span key={c}>{c.split('/').pop()}</span>)}
            </div>
          </Panel>
        )}
      </>
    );
  },
};

// Default export ONLY — registration itself happens in the generated bundle entry (server.ts),
// which scans this directory, imports each file's default export, and calls
// `registerExtension(<filename>, <default export>)`. Filename = canonical preset name (mirroring
// the boilerplates/presets two-file convention) is the ONE place that name is decided, so this
// file itself never hardcodes it.
export default speckitExtension;
