// The audit log — a SEPARATE append-only log (NOT git history, NOT the markdown
// body). Timestamps (created / updated / state-since) are derived from it. One per clone.
//
// Mechanism: `observeChanges` diffs a preset-validated snapshot of the tracker against the
// last-seen baseline and appends an entry per change (status / AC status / AC added / evidence
// added). It is the SINGLE source of audit entries, driven from two callers, both after the same
// full preset-validated export (`exportTrackerRoot`, which resolves and runs the repo's preset):
//   (1) the CLI, after any mutating command (`src/cliAudit.ts` → `observeAfterMutation`), so
//       CLI-only usage now populates `.audit.jsonl` — this is the wiring ztrack #19 deferred; and
//   (2) `visualizer/server.ts`, on every request, which also catches edits made OUTSIDE ztrack's
//       mutation affordances (an SDLC whose files are hand-edited or edited by its own tooling).
// Diffing is why one central pass suffices instead of per-path instrumentation: whichever caller
// observes first records the change and advances the shared baseline, so the other sees no diff
// and never double-logs. The backend choke point (`MarkdownBackend.command`) can't drive this —
// it only ever sees a preset-agnostic `CanonicalIssue` with no acceptance criteria — which is
// exactly why the observe pass runs one layer up, over the validated export, not in the backend.
//
// `repo` here is the tracker STATE DIR (`cacheRoot(projectRoot)` — `.volter` for a local tracker,
// the per-clone cache for a linked one), so the log lives at `<stateDir>/tracker/.audit.jsonl`,
// next to the markdown store. It's local, derived observability (per-clone, regenerable by
// observation), so both it and its baseline are gitignored on first write — never committed.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AuditEntry } from './engine.ts';

export function auditPath(repo: string): string {
  return join(repo, 'tracker', '.audit.jsonl');
}

// The audit log + its baseline are local, derived, per-clone — never committed. Drop a
// `.gitignore` next to them (idempotently) on first write so a wired CLI doesn't spray
// untracked files into every repo. Only these two patterns are added; a hand-authored
// `.gitignore` in the same dir (e.g. one the store uses) is appended to, never clobbered.
function ensureAuditIgnored(trackerDir: string): void {
  const gitignore = join(trackerDir, '.gitignore');
  const want = ['.audit.jsonl', '.audit-state.json'];
  let current = '';
  try { current = readFileSync(gitignore, 'utf8'); } catch { /* no .gitignore yet */ }
  const have = new Set(current.split('\n').map((l) => l.trim()));
  const missing = want.filter((w) => !have.has(w));
  if (!missing.length) return;
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  appendFileSync(gitignore, `${prefix}${missing.join('\n')}\n`);
}

// ── change observation (preset-agnostic; uses only core fields) ──────────────
interface BaselineAc { status: string; evidence: number }
interface BaselineIssue { status: string; acs: Record<string, BaselineAc> }
type Baseline = Record<string, BaselineIssue>;
export interface ObservableIssue { id: string; status: string; acceptanceCriteria: Array<{ id: string; status: string; evidence: unknown[] }> }

function baselinePath(repo: string): string { return join(repo, 'tracker', '.audit-state.json'); }
function loadBaseline(repo: string): Baseline { try { return JSON.parse(readFileSync(baselinePath(repo), 'utf8')) as Baseline; } catch { return {}; } }
function saveBaseline(repo: string, b: Baseline): void {
  const dir = dirname(baselinePath(repo));
  mkdirSync(dir, { recursive: true });
  ensureAuditIgnored(dir);
  writeFileSync(baselinePath(repo), JSON.stringify(b, null, 2));
}
function snap(issue: ObservableIssue): BaselineIssue {
  return { status: issue.status, acs: Object.fromEntries(issue.acceptanceCriteria.map((a) => [a.id, { status: a.status, evidence: a.evidence.length }])) };
}

/** Seed an EMPTY baseline (idempotent — no-op if one exists). Called by `ztrack init` for a
 *  fresh LOCAL tracker so its very first `issue create` diffs against `{}` and is logged, rather
 *  than being swallowed by observeChanges's silent first-run seed. A tracker that already holds
 *  issues (a linked pull, or an established repo predating this wiring) must NOT be seeded this
 *  way — leaving no baseline lets the first observe seed silently instead of fabricating a burst
 *  of "created now" entries with the wrong timestamp. */
export function seedAuditBaseline(repo: string): void {
  if (existsSync(baselinePath(repo))) return;
  saveBaseline(repo, {});
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
  const dir = dirname(p);
  mkdirSync(dir, { recursive: true });
  ensureAuditIgnored(dir);
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
