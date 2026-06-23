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

// The in-issue `## Conflicts` block is LOCAL-ONLY presentation (so the agent sees both values
// where they edit). It must be STRIPPED from the body the sync reconciles/pushes, or the marker
// itself becomes a change that fights the sync. Mirrors the core's `## Waivers` handling.
export function stripConflictSection(body: string): string {
  const out: string[] = [];
  let skip = false;
  for (const line of body.split('\n')) {
    if (/^##\s+conflicts\b/i.test(line)) { skip = true; continue; }
    if (skip && /^##\s+/.test(line)) skip = false;
    if (!skip) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

export function renderConflictSection(recs: ConflictRecord[]): string {
  const rows = recs.map((r) => `- ${r.field}: local "${r.local}" | remote "${r.remote}"`);
  return `## Conflicts\n\n<!-- ztrack: unresolved sync conflicts. Resolve a field, then re-sync — \`--policy twin-wins\` keeps local, \`--policy hub-wins\` takes remote; this section clears on its own once both sides agree. -->\n${rows.join('\n')}`;
}

/** Body with the conflict section refreshed (or removed when there are none). */
export function withConflictSection(body: string, recs: ConflictRecord[]): string {
  const clean = stripConflictSection(body);
  return recs.length ? `${clean}\n\n${renderConflictSection(recs)}\n` : `${clean}\n`;
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
