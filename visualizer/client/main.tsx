import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AuditEntry, CoreIssue, Finding, Payload, Timestamps } from './model';
import { buildEffectiveExtension, type EffectiveExtension } from './extensions';

// The shared `/project/` URL mapper — passed to `acEvidence` and `issuePanels` so an extension
// (data-derived or code) can link evidence/design-artifact files under the project root.
const projectUrl = (p: string) => '/project/' + p.replace(/^\/+/, '');

// ── time helpers (ported subset of the original time.ts) ─────────────────────
const parseTs = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };
function formatAgo(iso?: string) {
  const t = parseTs(iso); if (t === null) return iso || 'unknown';
  let s = Math.round((Date.now() - t) / 1000); const tense = s < 0 ? 'from now' : 'ago'; s = Math.abs(s);
  if (s < 5) return 'just now';
  for (const [u, sz] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]] as const) {
    if (s >= sz) { const n = Math.floor(s / sz); return `${n} ${u}${n === 1 ? '' : 's'} ${tense}`; }
  }
  return 'just now';
}
function timeSince(iso?: string) {
  const t = parseTs(iso); if (t === null) return '';
  const h = Math.max(0, Math.floor((Date.now() - t) / 3600000));
  if (h < 1) return '<1h'; if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24), r = h % 24; return r ? `${d}d ${r}h` : `${d}d`;
}
function formatDateTime(iso?: string) {
  const t = parseTs(iso); if (t === null) return iso || '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t);
}

// ── field accessors (core + default primitives) ──────────────────────────────
// an AC counts as complete (settled) if its status is terminal: a success state
// ('passed' (default) or 'done' (speckit)) or an explicit, recorded descope.
const isAcComplete = (a: { status: string }) => a.status === 'passed' || a.status === 'done' || a.status === 'descoped';
const passed = (i: CoreIssue) => i.acceptanceCriteria.filter(isAcComplete).length;
const acProgress = (i: CoreIssue) => { const total = i.acceptanceCriteria.length; const done = passed(i); return { done, total, percent: total ? Math.round(done / total * 100) : 0 }; };
const errorsOf = (f: Finding[], id: string) => f.filter((x) => x.issueId === id && x.severity === 'error');
const warningsOf = (f: Finding[], id: string) => f.filter((x) => x.issueId === id && x.severity === 'warning');
const acknowledgedOf = (f: Finding[], id: string) => f.filter((x) => x.issueId === id && x.severity === 'acknowledged');
const labelsOf = (i: CoreIssue) => ((i as { labels?: string[] }).labels ?? []);
const childrenOf = (i: CoreIssue) => ((i as { children?: string[] }).children ?? []);
const relsOf = (i: CoreIssue, t: string) => ((i as { relations?: Array<{ type: string; issueId: string }> }).relations ?? []).filter((r) => r.type === t).map((r) => r.issueId);

function initials(name: string) {
  const p = name.replace(/@/g, '').split(/[\s._-]+/).filter(Boolean);
  return (((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')) || name.slice(0, 2)).toUpperCase();
}
function AssigneeAvatar({ assignee }: { assignee?: string }) {
  const v = assignee?.trim(); if (!v) return null;
  return <span className="assignee-avatar" title={`Assigned to ${v}`}>{initials(v)}</span>;
}

// ── routing ──────────────────────────────────────────────────────────────────
function readRoute() { const p = new URLSearchParams(window.location.search); return { view: p.get('view') ?? 'all', issueId: p.get('issue') }; }
function writeRoute(view: string, issueId: string | null) {
  const p = new URLSearchParams();
  if (view !== 'all') p.set('view', view);
  if (issueId) p.set('issue', issueId);
  const q = p.toString();
  window.history.pushState(null, '', q ? `?${q}` : window.location.pathname);
}

// ── transforms (ported intent of caseModel) ──────────────────────────────────
type GroupBy = 'status' | 'label' | 'none';
type OrderBy = 'priority' | 'identifier' | 'title' | 'progress';
type IssueFilter = 'all' | 'blocked' | 'blocking' | 'withPr' | 'errors' | 'warnings';
const issueFilterLabels: Record<IssueFilter, string> = { all: 'Any issue', blocked: 'Blocked', blocking: 'Blocking others', withPr: 'Has a PR', errors: 'Has errors', warnings: 'Has warnings' };

function applyView(list: CoreIssue[], view: string, findings: Finding[]) {
  if (view === 'all') return list;
  if (view === 'findings') return list.filter((i) => errorsOf(findings, i.id).length || warningsOf(findings, i.id).length || acknowledgedOf(findings, i.id).length);
  return list.filter((i) => i.status === view);
}
function primaryLabel(i: CoreIssue) { const l = labelsOf(i); return l.find((x) => x.startsWith('priority:') || /^P\d$/.test(x)) ?? l[0] ?? 'No label'; }
function issueWeight(i: CoreIssue, f: Finding[]) { return errorsOf(f, i.id).length * 1000 + warningsOf(f, i.id).length * 100 + relsOf(i, 'blocked-by').length * 10 + relsOf(i, 'blocks').length; }
function sortValue(i: CoreIssue, orderBy: OrderBy, f: Finding[]): string | number {
  if (orderBy === 'identifier') return i.id;
  if (orderBy === 'title') return i.title.toLowerCase();
  if (orderBy === 'progress') return acProgress(i).percent;
  return issueWeight(i, f);
}
function filterAndSort(issues: CoreIssue[], query: string, label: string, issueFilter: IssueFilter, orderBy: OrderBy, ext: EffectiveExtension, findings: Finding[]) {
  const q = query.trim().toLowerCase();
  const out = issues.filter((i) => {
    const hay = [i.id, i.title, i.summary, i.status, ...labelsOf(i)].join(' ').toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (label !== 'all' && !labelsOf(i).includes(label)) return false;
    if (issueFilter === 'blocked' && relsOf(i, 'blocked-by').length === 0) return false;
    if (issueFilter === 'blocking' && relsOf(i, 'blocks').length === 0) return false;
    if (issueFilter === 'withPr' && !ext.pr?.(i)) return false;
    if (issueFilter === 'errors' && errorsOf(findings, i.id).length === 0) return false;
    if (issueFilter === 'warnings' && warningsOf(findings, i.id).length === 0) return false;
    return true;
  });
  return out.sort((a, b) => {
    const av = sortValue(a, orderBy, findings), bv = sortValue(b, orderBy, findings);
    if (typeof av === 'number' && typeof bv === 'number') return bv - av || a.id.localeCompare(b.id);
    return String(av).localeCompare(String(bv)) || a.id.localeCompare(b.id);
  });
}
function groupedItems(items: CoreIssue[], groupBy: GroupBy, ext: EffectiveExtension) {
  if (groupBy === 'none') return [{ title: 'Issues', items }];
  const map = new Map<string, CoreIssue[]>();
  for (const i of items) { const t = groupBy === 'label' ? primaryLabel(i) : i.status; map.set(t, [...(map.get(t) ?? []), i]); }
  const groups = [...map.entries()].map(([title, gi]) => ({ title, items: gi }));
  if (groupBy === 'status') groups.sort((a, b) => ((ext.statusOrder.indexOf(a.title) + 1) || 999) - ((ext.statusOrder.indexOf(b.title) + 1) || 999));
  else groups.sort((a, b) => a.title.localeCompare(b.title));
  return groups;
}

// ── shared bits ──────────────────────────────────────────────────────────────
function StatePill({ status, ext }: { status: string; ext: EffectiveExtension }) {
  return <span className={`state-pill state-${ext.statusClass ? ext.statusClass(status) : status}`}>{status}</span>;
}
function AcMiniRing({ issue, ext }: { issue: CoreIssue; ext: EffectiveExtension }) {
  const { done, total, percent } = acProgress(issue);
  if (total === 0) return null;
  const label = ext.acUnitLabel ?? 'ACs';
  return (
    <span className="ac-progress-mini-strip" aria-label="AC progress">
      <span className="ac-progress-mini ac-progress-development" title={`${label}: ${done}/${total} complete`}>
        <span className="ac-mini-ring" style={{ '--progress': `${percent}%` } as React.CSSProperties}><span>{done}/{total}</span></span>
      </span>
    </span>
  );
}
function AcWheelStrip({ issue, ext }: { issue: CoreIssue; ext: EffectiveExtension }) {
  const { done, total, percent } = acProgress(issue);
  if (total === 0) return null;
  const label = ext.acUnitLabel ?? 'ACs';
  return (
    <div className="ac-progress-strip" aria-label="Acceptance criteria progress">
      <div className="ac-progress-wheel ac-progress-development" title={`${label}: ${done}/${total} complete`}>
        <span className="ac-ring" style={{ '--progress': `${percent}%` } as React.CSSProperties}><span>{done}/{total}</span></span>
        <span className="ac-progress-copy"><strong>{label}</strong><small>{done}/{total} complete</small></span>
      </div>
    </div>
  );
}
function FindingBadges({ findings, id }: { findings: Finding[]; id: string }) {
  const e = errorsOf(findings, id).length, w = warningsOf(findings, id).length;
  if (!e && !w) return null;
  return <>
    {e > 0 && <span className="finding-badge finding-badge-error">{e} error{e === 1 ? '' : 's'}</span>}
    {w > 0 && <span className="finding-badge finding-badge-warning">{w} warning{w === 1 ? '' : 's'}</span>}
  </>;
}

// ── list view (the original 7-col grid) ──────────────────────────────────────
function WorkList({ groups, groupBy, collapsed, selectedId, findings, ext, ts, onSelect, onToggleGroup }: {
  groups: Array<{ title: string; items: CoreIssue[] }>; groupBy: GroupBy; collapsed: Set<string>; selectedId: string;
  findings: Finding[]; ext: EffectiveExtension; ts: Record<string, Timestamps>; onSelect: (i: CoreIssue) => void; onToggleGroup: (t: string) => void;
}) {
  if (groups.length === 0) return <div className="empty large">No matching work.</div>;
  const grouped = groupBy === 'status';
  return (
    <section className="work-list" aria-label="Issues">
      {groups.map((group) => {
        const isCol = collapsed.has(group.title);
        return (
          <div className="work-group" key={group.title}>
            <div className="group-header">
              <button className="group-collapse" onClick={() => onToggleGroup(group.title)} type="button" aria-label={`${isCol ? 'Expand' : 'Collapse'} ${group.title}`}>{isCol ? '›' : '⌄'}</button>
              <span className="group-title">{group.title}</span>
              <strong>{group.items.length}</strong>
            </div>
            {!isCol && (
              <div className={`list-header${grouped ? ' status-grouped' : ''}`}>
                <span></span><span>Issue</span>{!grouped && <span>Status</span>}<span>Issue age</span><span>State age</span><span>ACs</span><span>Signals</span>
              </div>
            )}
            {!isCol && group.items.map((i) => {
              const t = ts[i.id] ?? {};
              return (
                <div className={`issue-row${i.id === selectedId ? ' selected' : ''}${grouped ? ' status-grouped' : ''}`} key={i.id} role="button" tabIndex={0}
                  onClick={() => onSelect(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(i); }}>
                  <span className="row-select" />
                  <span className="issue-main">
                    <span className="issue-title-line">
                      <span className="issue-id">{i.id}</span>
                      <AssigneeAvatar assignee={ext.assignee?.(i)} />
                      <span className="issue-title">{i.title}</span>
                    </span>
                    {i.summary && i.summary !== i.title && <span className="issue-summary">{i.summary}</span>}
                  </span>
                  {!grouped && <StatePill status={i.status} ext={ext} />}
                  <span className={`age-cell${t.created ? '' : ' untracked'}`} title={t.created ? `Created ${formatDateTime(t.created)}` : 'No created timestamp'}>{t.created ? timeSince(t.created) : '-'}</span>
                  <span className={`age-cell${t.stateSince ? '' : ' untracked'}`} title={t.stateSince ? `Since ${formatDateTime(t.stateSince)}` : 'No audit rows yet'}>{t.stateSince ? timeSince(t.stateSince) : '-'}</span>
                  <span className="progress-cell"><AcMiniRing issue={i} ext={ext} /></span>
                  <span className="signals">
                    {ext.pr?.(i) && <span>PR</span>}
                    {relsOf(i, 'blocked-by').length > 0 && <span className="blocked-by-chip">blocked by {relsOf(i, 'blocked-by').length}</span>}
                    {relsOf(i, 'blocks').length > 0 && <span className="blocks-chip">blocks {relsOf(i, 'blocks').length}</span>}
                    <FindingBadges findings={findings} id={i.id} />
                    {labelsOf(i).slice(0, 2).map((l) => <span key={l}>{l}</span>)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

// ── board ────────────────────────────────────────────────────────────────────
function Board({ groups, collapsed, selectedId, findings, ext, onSelect, onToggleGroup }: {
  groups: Array<{ title: string; items: CoreIssue[] }>; collapsed: Set<string>; selectedId: string;
  findings: Finding[]; ext: EffectiveExtension; onSelect: (i: CoreIssue) => void; onToggleGroup: (t: string) => void;
}) {
  if (groups.length === 0) return <div className="empty large">No matching work.</div>;
  return (
    <section className="board" aria-label="Board">
      {groups.map((group) => {
        const isCol = collapsed.has(group.title);
        return (
          <div className={`board-column${isCol ? ' collapsed' : ''}`} key={group.title}>
            <div className="board-column-head">
              <button className="group-collapse" onClick={() => onToggleGroup(group.title)} type="button" aria-label={`${isCol ? 'Expand' : 'Collapse'} ${group.title}`}>{isCol ? '›' : '⌄'}</button>
              <span className="group-title">{group.title}</span>
              <strong>{group.items.length}</strong>
            </div>
            {!isCol && group.items.map((i) => {
              const { done, total } = acProgress(i);
              return (
                <button className={`board-card${i.id === selectedId ? ' selected' : ''}`} key={i.id} onClick={() => onSelect(i)} type="button">
                  <span className="issue-id">{i.id}</span>
                  <strong>{i.title}</strong>
                  <StatePill status={i.status} ext={ext} />
                  {i.summary && i.summary !== i.title && <span className="board-summary">{i.summary}</span>}
                  <span className="board-meta">{total === 0 ? '0 AC' : `${done}/${total} AC`}</span>
                  <span className="signals board-signals">
                    {relsOf(i, 'blocked-by').length > 0 && <span className="blocked-by-chip">blocked by {relsOf(i, 'blocked-by').length}</span>}
                    {relsOf(i, 'blocks').length > 0 && <span className="blocks-chip">blocks {relsOf(i, 'blocks').length}</span>}
                    <FindingBadges findings={findings} id={i.id} />
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

// ── detail ───────────────────────────────────────────────────────────────────
type Tab = 'overview' | 'activity';
function RelationPanel({ issue }: { issue: CoreIssue }) {
  const blockedBy = relsOf(issue, 'blocked-by'), blocks = relsOf(issue, 'blocks'), relates = relsOf(issue, 'relates');
  if (!blockedBy.length && !blocks.length && !relates.length) return null;
  const group = (label: string, ids: string[], cls: string) => ids.length > 0 && (
    <div className={`relation-group ${cls}`}>
      <div className="relation-heading"><span></span><strong>{label}</strong></div>
      {ids.map((id) => <div className="relation-row" key={id}><strong>{id}</strong></div>)}
    </div>
  );
  return (
    <section className="panel relation-panel">
      <div className="panel-title"><h3>Relations</h3><span>{blockedBy.length + blocks.length + relates.length}</span></div>
      <div className="relation-grid">
        {group('Blocked by', blockedBy, 'relation-blocked-by')}
        {group('Blocks', blocks, 'relation-blocks')}
        {group('Relates', relates, 'relation-blocks')}
      </div>
    </section>
  );
}
function PrimitivesPanel({ issue }: { issue: CoreIssue }) {
  const labels = labelsOf(issue), kids = childrenOf(issue);
  if (!labels.length && !kids.length) return null;
  return (
    <div className="primitive-rows">
      {labels.length > 0 && <div className="primitive-row"><span className="primitive-key">labels</span><span className="chips">{labels.map((l) => <span key={l}>{l}</span>)}</span></div>}
      {kids.length > 0 && <div className="primitive-row"><span className="primitive-key">children</span><span className="chips">{kids.map((c) => <span key={c}>{c}</span>)}</span></div>}
    </div>
  );
}
function Detail({ issue, ext, findings, audit, timestamps, width, onClose }: {
  issue: CoreIssue; ext: EffectiveExtension; findings: Finding[]; audit: AuditEntry[]; timestamps: Timestamps; width: number; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const fs = findings.filter((f) => f.issueId === issue.id);
  const errs = fs.filter((f) => f.severity === 'error').length, warns = fs.filter((f) => f.severity === 'warning').length, acks = fs.filter((f) => f.severity === 'acknowledged').length;
  const blockedBy = relsOf(issue, 'blocked-by').length, blocks = relsOf(issue, 'blocks').length;
  return (
    <aside className="detail-drawer open" aria-label="Issue details">
      <div className="drawer-bar"><span>{issue.id}</span><button aria-label="Close" onClick={onClose} type="button">x</button></div>
      <article className="detail-pane">
        <header className="detail-header">
          <div>
            <div className="case-kicker">{issue.id}</div>
            <h2>{issue.title}</h2>
            {issue.summary && issue.summary !== issue.title && <p className="case-summary">{issue.summary}</p>}
          </div>
          <div className="case-metrics">
            <AssigneeAvatar assignee={ext.assignee?.(issue)} />
            <StatePill status={issue.status} ext={ext} />
            {ext.pr?.(issue) && <span>PR {ext.pr(issue)!.url}</span>}
            {timestamps.created && <span title={formatDateTime(timestamps.created)}>issue age {timeSince(timestamps.created)}</span>}
            {timestamps.stateSince && <span title={formatDateTime(timestamps.stateSince)}>in state {timeSince(timestamps.stateSince)}</span>}
            {blockedBy > 0 && <span className="metric-blocked-by">blocked by {blockedBy}</span>}
            {blocks > 0 && <span className="metric-blocks">blocks {blocks}</span>}
            {errs > 0 && <span className="metric-error">{errs} errors</span>}
            {warns > 0 && <span className="metric-warning">{warns} warnings</span>}
            {acks > 0 && <span className="metric-acknowledged" title="downgraded to acknowledged by a fresh waiver">{acks} acknowledged</span>}
          </div>
        </header>
        <AcWheelStrip issue={issue} ext={ext} />
        {(issue as { waiver?: { reason?: string; approvedBy?: string } }).waiver && (
          <div className="waiver-banner" title="A signed waiver downgrades this issue's errors to acknowledged while its acceptance criteria are unchanged.">
            ⚑ Waiver by {(issue as { waiver?: { approvedBy?: string } }).waiver!.approvedBy || 'unknown'}: {(issue as { waiver?: { reason?: string } }).waiver!.reason || '(no reason)'}
          </div>
        )}
        {fs.length > 0 && (
          <details className="finding-summary"><summary>{errs} errors, {warns} warnings{acks > 0 ? `, ${acks} acknowledged` : ''}</summary>
            <div className="finding-list">{fs.map((f, i) => <div className={`finding ${f.severity}`} key={i}>{f.severity.toUpperCase()} {f.code}{f.acId ? ` ${f.acId}` : ''}: {f.message}</div>)}</div>
          </details>
        )}
        <div className="tabs" role="tablist">
          {(['overview', 'activity'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} type="button">{t}{t === 'activity' ? ` (${audit.length})` : ''}</button>)}
        </div>
        <div className="detail-content"><div className="detail-main">
          {tab === 'overview' && (
            <div className="detail-grid">
              <RelationPanel issue={issue} />
              <PrimitivesPanel issue={issue} />
              <section className="panel">
                <div className="panel-title"><h3>Acceptance Criteria</h3><span>{issue.acceptanceCriteria.length}</span></div>
                <div className="ac-list">
                  {issue.acceptanceCriteria.map((ac) => (
                    <div className={`ac-row${isAcComplete(ac) ? ' checked' : ''}${ac.status === 'descoped' ? ' descoped' : ''}`} key={ac.id}>
                      <span className="check">{ac.status}</span>
                      <div className="ac-body">
                        <div>{ext.acText ? ext.acText(ac) : <strong>{ac.id}</strong>}</div>
                        {ac.status === 'descoped' && (ac as { descopeReason?: string }).descopeReason && <div className="ac-descope-reason">descoped: {(ac as { descopeReason?: string }).descopeReason}</div>}
                        {ext.acProof?.(ac)}
                        {ext.acEvidence && <div className="ac-evidence">{ext.acEvidence(ac, projectUrl)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              {ext.issuePanels?.(issue, projectUrl)}
            </div>
          )}
          {tab === 'activity' && (
            <section className="panel">
              <div className="panel-title"><h3>Activity</h3><span>{audit.length}</span></div>
              {audit.length === 0 ? <div className="empty">No audit entries — this issue was not created through the mutation affordances.</div> : (
                <div className="audit-list">
                  {[...audit].reverse().map((e, i) => (
                    <div className="audit-row" key={i}>
                      <span className="audit-op">{e.op}{e.field ? ` ${e.field}` : ''}</span>
                      <span className="audit-change">{e.from !== undefined || e.to !== undefined ? `${e.from ?? '∅'} → ${e.to ?? '∅'}` : ''}</span>
                      <span className="audit-actor">{e.actor}</span>
                      <span className="audit-time" title={formatDateTime(e.ts)}>{formatAgo(e.ts)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div></div>
      </article>
    </aside>
  );
}
const DETAIL_MIN = 440, DETAIL_MAX = 980, DETAIL_MIN_LIST = 520;
function clampWidth(w: number) {
  const layout = document.querySelector('.tracker-layout');
  const lw = layout?.getBoundingClientRect().width ?? window.innerWidth;
  const max = Math.max(DETAIL_MIN, Math.min(DETAIL_MAX, lw - DETAIL_MIN_LIST));
  return Math.min(max, Math.max(DETAIL_MIN, w));
}
function DetailResizer({ onResize }: { onResize: (w: number) => void }) {
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; e.preventDefault();
    const layout = (e.currentTarget as HTMLElement).closest('.tracker-layout');
    const right = layout?.getBoundingClientRect().right ?? window.innerWidth;
    const move = (m: PointerEvent) => onResize(clampWidth(right - m.clientX));
    const up = () => { document.body.classList.remove('resizing-detail'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    document.body.classList.add('resizing-detail');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  };
  return <div className="detail-resizer" role="separator" aria-orientation="vertical" tabIndex={0} onPointerDown={onPointerDown} />;
}

// ── popovers ─────────────────────────────────────────────────────────────────
function DisplayOptions({ open, layout, groupBy, orderBy, onClose, onLayout, onGroupBy, onOrderBy }: {
  open: boolean; layout: 'list' | 'board'; groupBy: GroupBy; orderBy: OrderBy; onClose: () => void;
  onLayout: (v: 'list' | 'board') => void; onGroupBy: (v: GroupBy) => void; onOrderBy: (v: OrderBy) => void;
}) {
  if (!open) return null;
  return (
    <div className="popover display-options" role="dialog" aria-label="Display options">
      <div className="popover-head"><strong>Display options</strong><button onClick={onClose} type="button">x</button></div>
      <label><span>Layout</span><select value={layout} onChange={(e) => onLayout(e.target.value as 'list' | 'board')}><option value="list">List</option><option value="board">Board</option></select></label>
      <label><span>Group by</span><select value={groupBy} onChange={(e) => onGroupBy(e.target.value as GroupBy)}><option value="status">Status</option><option value="label">Label</option><option value="none">No grouping</option></select></label>
      <label><span>Order by</span><select value={orderBy} onChange={(e) => onOrderBy(e.target.value as OrderBy)}><option value="priority">Needs attention</option><option value="identifier">Issue ID</option><option value="title">Title</option><option value="progress">AC progress</option></select></label>
    </div>
  );
}
function FilterOptions({ open, labels, label, issueFilter, onClose, onLabel, onIssueFilter, onReset }: {
  open: boolean; labels: string[]; label: string; issueFilter: IssueFilter; onClose: () => void;
  onLabel: (v: string) => void; onIssueFilter: (v: IssueFilter) => void; onReset: () => void;
}) {
  if (!open) return null;
  return (
    <div className="popover filter-options" role="dialog" aria-label="Filters">
      <div className="popover-head"><strong>Filters</strong><button onClick={onClose} type="button">x</button></div>
      <label><span>Issue</span><select value={issueFilter} onChange={(e) => onIssueFilter(e.target.value as IssueFilter)}>{(Object.keys(issueFilterLabels) as IssueFilter[]).map((k) => <option key={k} value={k}>{issueFilterLabels[k]}</option>)}</select></label>
      <label><span>Label</span><select value={label} onChange={(e) => onLabel(e.target.value)}><option value="all">Any label</option>{labels.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
      <button className="popover-action" onClick={onReset} type="button">Clear filters</button>
    </div>
  );
}

// ── app ──────────────────────────────────────────────────────────────────────
function App() {
  const initial = readRoute();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initial.issueId);
  const [view, setView] = useState(initial.view);
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState('all');
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
  const [layout, setLayout] = useState<'list' | 'board'>('list');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [orderBy, setOrderBy] = useState<OrderBy>('priority');
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [detailWidth, setDetailWidth] = useState(720);

  async function refresh() {
    try {
      const res = await fetch('/api/board'); const data = await res.json() as Payload;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPayload(data); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void refresh(); const t = window.setInterval(() => void refresh(), 4000); return () => window.clearInterval(t); }, []);
  useEffect(() => { const onPop = () => { const r = readRoute(); setView(r.view); setSelectedId(r.issueId); }; window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);

  // VIZ-4: build the effective (data + code) extension from the wire payload itself — no
  // preset-name lookup against a hardcoded map. `notice` is the one-line vocabulary-missing/
  // -invalid message (VIZ-4 dev/04); null once a valid `visualizer` block is present.
  const { ext, notice } = useMemo(() => buildEffectiveExtension(payload), [payload]);
  const findings = payload?.findings ?? [];
  const all = payload?.issues ?? [];
  const labelSet = useMemo(() => [...new Set(all.flatMap(labelsOf))].sort((a, b) => a.localeCompare(b)), [all]);
  const inView = useMemo(() => applyView(all, view, findings), [all, view, findings]);
  const items = useMemo(() => filterAndSort(inView, query, label, issueFilter, orderBy, ext, findings), [inView, query, label, issueFilter, orderBy, ext, findings]);
  const groups = useMemo(() => groupedItems(items, groupBy, ext), [items, groupBy, ext]);
  const selected = useMemo(() => (selectedId ? all.find((i) => i.id === selectedId) ?? null : null), [all, selectedId]);

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const acknowledged = findings.filter((f) => f.severity === 'acknowledged').length;
  const globalFindings = findings.filter((f) => !f.issueId);

  const selectIssue = (i: CoreIssue) => { setSelectedId(i.id); writeRoute(view, i.id); };
  const closeDetail = () => { setSelectedId(null); writeRoute(view, null); };
  const changeView = (v: string) => { setView(v); writeRoute(v, selectedId); };
  const toggleGroup = (t: string) => setCollapsed((c) => { const n = new Set(c); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const viewCount = (v: string) => applyView(all, v, findings).length;
  const VIEWS = ['all', ...ext.statusOrder, 'findings'];
  const viewLabel = (v: string) => (v === 'all' ? 'All issues' : v === 'findings' ? 'Needs attention' : v);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◆</span><div><strong>tracker</strong><small>preset: {payload?.preset ?? '…'}</small></div></div>
        <nav className="views" aria-label="Views">
          {VIEWS.map((v) => <button className={`view${view === v ? ' active' : ''}`} key={v} onClick={() => changeView(v)} type="button"><span>{viewLabel(v)}</span><strong>{viewCount(v)}</strong></button>)}
        </nav>
        <div className={`health health-${payload ? (payload.ok ? 'pass' : 'fail') : 'pass'}`}><span>{payload ? (payload.ok ? 'PASS' : 'FAIL') : '…'}</span><small>{errors} errors, {warnings} warnings{acknowledged > 0 ? `, ${acknowledged} acknowledged` : ''}</small></div>
        {payload && (
          <div className="primitives-strip"><div className="primitives-head">primitives</div>
            {(['proof', 'labels', 'relations', 'children', 'sources', 'category'] as const).map((p) => (
              <div className={`primitive-cap${payload.primitives[p] ? ' on' : ' off'}`} key={p}><span>{p}</span><span>{payload.primitives[p] ? '✓' : 'not impl'}</span></div>
            ))}
            <div className="primitive-cap on"><span>audit</span><span>✓ auto</span></div>
          </div>
        )}
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <div className="breadcrumbs"><span>{payload?.preset ?? '…'} SDLC</span><span>/</span><strong>{viewLabel(view)}</strong></div>
            <h1>{viewLabel(view)}</h1>
            <p>{payload ? payload.projectDir : 'loading…'}</p>
          </div>
          <div className="toolbar-actions">
            <label className="search"><span>Search</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter issues, labels, states" /></label>
            <div className="segmented">
              <button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} type="button">List</button>
              <button className={layout === 'board' ? 'active' : ''} onClick={() => setLayout('board')} type="button">Board</button>
            </div>
            <div className="display-anchor">
              <button className={label !== 'all' || issueFilter !== 'all' ? 'active' : ''} onClick={() => { setFilterOpen((o) => !o); setDisplayOpen(false); }} type="button">Filter</button>
              <FilterOptions open={filterOpen} labels={labelSet} label={label} issueFilter={issueFilter} onClose={() => setFilterOpen(false)} onLabel={setLabel} onIssueFilter={setIssueFilter} onReset={() => { setLabel('all'); setIssueFilter('all'); }} />
            </div>
            <div className="display-anchor">
              <button onClick={() => { setDisplayOpen((o) => !o); setFilterOpen(false); }} type="button">Display</button>
              <DisplayOptions open={displayOpen} layout={layout} groupBy={groupBy} orderBy={orderBy} onClose={() => setDisplayOpen(false)} onLayout={setLayout} onGroupBy={setGroupBy} onOrderBy={setOrderBy} />
            </div>
            <button className="primary" onClick={() => void refresh()} type="button">Refresh</button>
          </div>
        </header>
        {error && <pre className="error">{error}</pre>}
        {payload && notice && <div className="visualizer-notice" role="status">{notice}</div>}
        {payload?.extensionError && <div className="visualizer-notice extension-error" role="status">{payload.extensionError}</div>}
        {payload && (
          <div className={`tracker-layout${selected ? ' has-detail' : ''}`} style={selected ? ({ '--detail-width': `${detailWidth}px` } as React.CSSProperties) : undefined}>
            <div className="view-summary">
              <span>{items.length} issues</span>
              <span>{errors} errors</span>
              <span>{warnings} warnings</span>
              {acknowledged > 0 && <span>{acknowledged} acknowledged</span>}
              {view !== 'all' && <button className="active-filter" onClick={() => changeView('all')} type="button">View: {viewLabel(view)} x</button>}
              {query && <button className="active-filter" onClick={() => setQuery('')} type="button">Search: {query} x</button>}
              {issueFilter !== 'all' && <button className="active-filter" onClick={() => setIssueFilter('all')} type="button">{issueFilterLabels[issueFilter]} x</button>}
              {label !== 'all' && <button className="active-filter" onClick={() => setLabel('all')} type="button">Label: {label} x</button>}
            </div>
            {view === 'findings' && globalFindings.length > 0 && (
              <section className="global-findings"><h2>Global Findings</h2>{globalFindings.map((f, i) => <div className={`finding ${f.severity}`} key={i}>{f.severity.toUpperCase()} {f.code}: {f.message}</div>)}</section>
            )}
            {layout === 'list'
              ? <WorkList groups={groups} groupBy={groupBy} collapsed={collapsed} selectedId={selected?.id ?? ''} findings={findings} ext={ext} ts={payload.timestamps} onSelect={selectIssue} onToggleGroup={toggleGroup} />
              : <Board groups={groups} collapsed={collapsed} selectedId={selected?.id ?? ''} findings={findings} ext={ext} onSelect={selectIssue} onToggleGroup={toggleGroup} />}
            {selected && <DetailResizer onResize={setDetailWidth} />}
            {selected && <Detail issue={selected} ext={ext} findings={findings} audit={payload.audit[selected.id] ?? []} timestamps={payload.timestamps[selected.id] ?? {}} width={detailWidth} onClose={closeDetail} />}
          </div>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
