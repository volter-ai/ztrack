// The `default` SDLC's view extension: its status vocabulary + AC rendering.
import React from 'react';
import type { PresetExtension } from '../extensions';

export const defaultExtension: PresetExtension = {
  statusOrder: ['draft', 'ready', 'in-progress', 'in-review', 'done'],
  acUnitLabel: 'Dev ACs',
  statusClass: (s) => s,
  assignee: (issue) => (issue as { assignee?: string }).assignee,
  pr: (issue) => (issue as { pr?: { url: string } }).pr,
  acText: (ac) => {
    const a = ac as { id: string; text?: string; version?: number };
    return <><strong>{a.id}</strong> {a.text} <span className="ver">v{a.version}</span></>;
  },
  acProof: (ac) => {
    const p = (ac as { proof?: { explanation: string; evidenceRefs: string[] } }).proof;
    if (!p) return null;
    return (
      <div className="ac-proof">
        <span className="proof-tag">proof</span>
        <span className="proof-text">{p.explanation}</span>
        {p.evidenceRefs.length > 0 && <span className="proof-refs">{p.evidenceRefs.join(', ')}</span>}
      </div>
    );
  },
  acEvidence: (ac, projectUrl) => {
    const ev = (ac.evidence ?? []) as Array<{ id: string; image?: string; commit?: string; acVersion?: number }>;
    if (ev.length === 0) return null;
    return (
      <div className="evidence-paths">
        {ev.map((e) => (
          <a className="evidence-thumb evidence-screenshot" href={e.image ? projectUrl(e.image) : '#'} target="_blank" rel="noreferrer" key={e.id}>
            {e.image && <img src={projectUrl(e.image)} alt={e.id} loading="lazy" />}
            <code>{e.id} · {e.commit?.slice(0, 7)} · acv{e.acVersion}</code>
          </a>
        ))}
      </div>
    );
  },
};
