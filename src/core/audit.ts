// The audit log — a SEPARATE append-only log (NOT git history, NOT the markdown
// body). Timestamps (created / updated / state-since) are derived from it. One per repo.
//
// ztrack issue #19 (audit unwired from CLI write paths): this file was designed for two sources —
// (1) rich, actor-attributed entries from the mutation affordances themselves (`setBaselineIssue`
// exists for exactly this: advance the baseline without double-logging after writing your own
// entry) and (2) `observeChanges`, a diff-based fallback that catches edits made OUTSIDE those
// affordances (e.g. an SDLC whose files are hand-edited or edited by its own tooling). Only (2) is
// actually wired up today, and only from `visualizer/serverCore.ts`/`visualizer/server.ts`, which
// calls `observeChanges` on every request after validating the live tracker. `setBaselineIssue` has
// ZERO callers — no CLI mutation path (issue create/edit/patch, `ac patch`, `tx`, waivers) calls it
// or `appendAudit`, so running only the CLI (no visualizer) never writes `.audit.jsonl` at all.
//
// Why it isn't wired into the CLI: every CLI/SDK/MCP/tx mutation funnels through ONE choke point
// (`MarkdownBackend.command`, src/backends/markdownBackend.ts:280), but that layer only ever sees a
// `CanonicalIssue` (title/body/state/labels) — backends are deliberately preset-agnostic and know
// nothing about acceptance criteria. `observeChanges`'s `ObservableIssue` shape (id/status/AC
// status/evidence count) only exists after a FULL preset-validated export (`exportTrackerRoot`,
// resolving and running the repo's preset), which several mutation call sites
// (`ac`/`issue patch` in cli.ts, the raw `issue edit/create` passthrough, `cliWaiver.ts`) don't
// currently run. Wiring it in properly means adding a preset-validation pass to each of those
// paths — a real feature, not a smallest-honest fix — so today's audit log is VISUALIZER-ONLY:
// don't rely on `.audit.jsonl` (or the timestamps derived from it) to reflect CLI-only usage.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AuditEntry } from './engine.ts';

export function auditPath(repo: string): string {
  return join(repo, 'tracker', '.audit.jsonl');
}

// ── change observation (preset-agnostic; uses only core fields) ──────────────
interface BaselineAc { status: string; evidence: number }
interface BaselineIssue { status: string; acs: Record<string, BaselineAc> }
type Baseline = Record<string, BaselineIssue>;
interface ObservableIssue { id: string; status: string; acceptanceCriteria: Array<{ id: string; status: string; evidence: unknown[] }> }

function baselinePath(repo: string): string { return join(repo, 'tracker', '.audit-state.json'); }
function loadBaseline(repo: string): Baseline { try { return JSON.parse(readFileSync(baselinePath(repo), 'utf8')) as Baseline; } catch { return {}; } }
function saveBaseline(repo: string, b: Baseline): void { mkdirSync(dirname(baselinePath(repo)), { recursive: true }); writeFileSync(baselinePath(repo), JSON.stringify(b, null, 2)); }
function snap(issue: ObservableIssue): BaselineIssue {
  return { status: issue.status, acs: Object.fromEntries(issue.acceptanceCriteria.map((a) => [a.id, { status: a.status, evidence: a.evidence.length }])) };
}

/** Advance the baseline for one issue without logging (mutation affordances call
 *  this after writing their own rich entry, so observeChanges won't double-log). */
export function setBaselineIssue(repo: string, issue: ObservableIssue): void {
  const b = loadBaseline(repo); b[issue.id] = snap(issue); saveBaseline(repo, b);
}

/** Diff the current issues against the last-seen baseline; append an audit entry
 *  for every change (status / AC status / AC added / evidence added). On the very
 *  first run it seeds the baseline silently (no burst of "created" entries). */
export function observeChanges(repo: string, issues: ObservableIssue[], actor = 'observed'): AuditEntry[] {
  const seeding = !existsSync(baselinePath(repo));
  const b = loadBaseline(repo);
  const now = new Date().toISOString();
  const out: AuditEntry[] = [];
  for (const issue of issues) {
    const cur = snap(issue); const prev = b[issue.id];
    if (!seeding) {
      if (!prev) out.push({ ts: now, issueId: issue.id, op: 'observed.create', to: cur.status, actor });
      else {
        if (prev.status !== cur.status) out.push({ ts: now, issueId: issue.id, op: 'status', field: 'status', from: prev.status, to: cur.status, actor });
        for (const [acId, ac] of Object.entries(cur.acs)) {
          const pac = prev.acs[acId];
          if (!pac) out.push({ ts: now, issueId: issue.id, op: 'ac.add', field: acId, to: ac.status, actor });
          else {
            if (pac.status !== ac.status) out.push({ ts: now, issueId: issue.id, op: 'ac.status', field: acId, from: pac.status, to: ac.status, actor });
            if (ac.evidence > pac.evidence) out.push({ ts: now, issueId: issue.id, op: 'evidence.add', field: acId, to: `${ac.evidence} evidence`, actor });
          }
        }
      }
    }
    b[issue.id] = cur;
  }
  for (const e of out) appendAudit(repo, e);
  saveBaseline(repo, b);
  return out;
}

export function appendAudit(repo: string, entry: AuditEntry): void {
  const p = auditPath(repo);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(entry) + '\n');
}

export function readAudit(repo: string, issueId?: string): AuditEntry[] {
  const p = auditPath(repo);
  if (!existsSync(p)) return [];
  // Append-only log: tolerate a corrupt/partial line (crash mid-append, manual edit)
  // by skipping it rather than making the whole history unreadable.
  const all = readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l) as AuditEntry]; } catch { return []; }
  });
  return issueId ? all.filter((e) => e.issueId === issueId) : all;
}

export interface Timestamps { created?: string; updated?: string; stateSince?: string }

/** Derive an issue's timestamps from its audit entries (no fields in the body). */
export function timestampsFor(entries: AuditEntry[], issueId: string): Timestamps {
  const es = entries.filter((e) => e.issueId === issueId).sort((a, b) => a.ts.localeCompare(b.ts));
  if (es.length === 0) return {};
  const lastStatus = [...es].reverse().find((e) => e.op === 'status');
  return {
    created: es[0]!.ts,
    updated: es[es.length - 1]!.ts,
    ...(lastStatus ? { stateSince: lastStatus.ts } : {}),
  };
}
