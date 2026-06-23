// Unresolved sync conflicts as a CROSS-CUTTING check concern — like waivers, this is core/
// universal, not part of any preset's model. When a bidirectional sync finds both sides changed
// the same field, neither is applied (no silent clobber); instead the conflict is recorded here
// and `ztrack check` emits a `sync_conflict` ERROR while it stands. So the gate stays red — and
// the ralph loop keeps going — until the conflict is resolved (pick a side and re-sync, which
// converges and clears the record). Stored provider-agnostically at .volter/sync/conflicts.json,
// keyed by the ztrack issue id.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Finding } from '../core/engine.ts';

export type ConflictRecord = { field: string; local: string; remote: string };
export type ConflictStore = { issues: Record<string, ConflictRecord[]> };

const storePath = (projectRoot: string) => join(projectRoot, '.volter', 'sync', 'conflicts.json');

export function loadConflicts(projectRoot: string): ConflictStore {
  const p = storePath(projectRoot);
  if (existsSync(p)) {
    try { const d = JSON.parse(readFileSync(p, 'utf8')) as Partial<ConflictStore>; if (d.issues) return { issues: d.issues }; } catch { /* fresh */ }
  }
  return { issues: {} };
}

export function saveConflicts(projectRoot: string, store: ConflictStore): void {
  const p = storePath(projectRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(store, null, 2)}\n`);
}

/** Record (or clear, when empty) the conflicts for one issue, leaving other issues untouched. */
export function setIssueConflicts(projectRoot: string, issueId: string, conflicts: ConflictRecord[]): void {
  const store = loadConflicts(projectRoot);
  if (conflicts.length) store.issues[issueId] = conflicts;
  else delete store.issues[issueId];
  saveConflicts(projectRoot, store);
}

const trunc = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

/** Build the `sync_conflict` error findings for the in-scope issues (an unwaivable gate). */
export function conflictFindings(projectRoot: string, inScope?: Set<string>): Finding[] {
  const { issues } = loadConflicts(projectRoot);
  const out: Finding[] = [];
  for (const [issueId, recs] of Object.entries(issues)) {
    if (inScope && !inScope.has(issueId)) continue;
    for (const r of recs) {
      out.push({
        code: 'sync_conflict',
        severity: 'error',
        issueId,
        waivable: false,
        message: `Sync conflict on ${r.field}: local "${trunc(r.local)}" vs remote "${trunc(r.remote)}". Resolve by editing the issue, then re-sync with \`--policy twin-wins\` (keep local) or \`--policy hub-wins\` (take remote).`,
      });
    }
  }
  return out;
}
