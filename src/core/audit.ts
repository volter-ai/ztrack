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
// observes first records the change and advances the shared baseline, so the other sees no diff.
// The baseline is a read-modify-write shared across processes (two terminals, or a CLI mutation
// racing the visualizer's per-request pass), so `observeChanges` takes a short advisory lock
// (`<stateDir>/tracker/.audit.lock`) around load→diff→append→save. On contention it SKIPS rather
// than blocks — best-effort: the skipper writes nothing and does NOT advance the baseline, so the
// pending change is still diffed and recorded by the next observer. That gives no duplicate and no
// permanent loss (each racing process re-exports fresh, and every mutation triggers another
// observe); a crashed holder's lock is stolen after a staleness timeout. (A lock-free append + read
// dedupe can't work here: the two racing processes stamp `new Date()` independently, so the
// duplicate lines differ by milliseconds — not byte-identical — and a ts-blind dedupe would wrongly
// collapse a legitimately repeated transition.) The backend choke point (`MarkdownBackend.command`)
// can't drive this — it only ever sees a preset-agnostic `CanonicalIssue` with no acceptance
// criteria — which is exactly why the observe pass runs one layer up, over the validated export.
//
// `repo` here is the tracker STATE DIR (`cacheRoot(projectRoot)` — `.volter` for a local tracker,
// the per-clone cache for a linked one), so the log lives at `<stateDir>/tracker/.audit.jsonl`,
// next to the markdown store. It's local, derived observability (per-clone, regenerable by
// observation), so both it and its baseline are gitignored on first write — never committed.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
  const want = ['.audit.jsonl', '.audit-state.json', '.audit.lock'];
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

// A short advisory lock serializing the load→diff→append→save critical section across processes.
// Skip-on-contention (never block a user's command); steal a lock left by a crashed holder.
const AUDIT_LOCK_STALE_MS = 10_000;
function lockPath(repo: string): string { return join(repo, 'tracker', '.audit.lock'); }
/** Try to take the audit lock. Returns an fd to release, or null if another observer holds it
 *  (in which case the caller must skip this pass — the change stays pending for the next observer). */
function acquireAuditLock(repo: string): number | null {
  mkdirSync(join(repo, 'tracker'), { recursive: true });
  const lock = lockPath(repo);
  try {
    return openSync(lock, 'wx'); // exclusive create — fails if held
  } catch {
    // Held by a live observer, or stale from a crashed one. Steal only if clearly stale; otherwise
    // treat as contended and skip (best-effort — no blocking, no duplicate).
    try {
      if (Date.now() - statSync(lock).mtimeMs > AUDIT_LOCK_STALE_MS) {
        unlinkSync(lock);
        return openSync(lock, 'wx');
      }
    } catch { /* lock vanished, or a competing steal won the race — treat as contended */ }
    return null;
  }
}
function releaseAuditLock(repo: string, fd: number): void {
  try { closeSync(fd); } catch { /* already closed */ }
  try { unlinkSync(lockPath(repo)); } catch { /* already removed */ }
}

/** Diff the current issues against the last-seen baseline; append an audit entry
 *  for every change (status / AC status / AC added / evidence added). On the very
 *  first run it seeds the baseline silently (no burst of "created" entries).
 *  Returns [] and records nothing if a concurrent observer holds the lock. */
export function observeChanges(repo: string, issues: ObservableIssue[], actor = 'observed'): AuditEntry[] {
  const fd = acquireAuditLock(repo);
  if (fd === null) return []; // a concurrent observer is mid-pass; skip — the change stays pending
  try {
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
  } finally {
    releaseAuditLock(repo, fd);
  }
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
