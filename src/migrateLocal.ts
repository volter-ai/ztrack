// One-shot migration off the (removed) Python `local` backend: read the old SQLite store
// and rewrite every issue as a markdown file the pure-JS backend reads. The SQLite store is a
// single `tracker_store(key='store', value=<json>)` row, so a tiny stdlib `python3 -c` dumps
// it (no 101 KB tracker-local.py) — python3 is needed only for this one-time read of old data.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDirName } from './config.ts';
import { type CanonicalIssue, serializeIssue } from './backends/markdown.ts';

const DUMP_STORE = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); r=c.execute(\"SELECT value FROM tracker_store WHERE key='store'\").fetchone(); sys.stdout.write(r[0] if r else '{}')";

type RawIssue = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function toCanonical(i: RawIssue): CanonicalIssue {
  return {
    identifier: str(i.identifier || i.id), title: str(i.title), body: str(i.body),
    state: str(i.state) || 'Backlog', stateType: str(i.stateType) || 'open',
    assignees: i.assignee ? [str(i.assignee)] : Array.isArray(i.assignees) ? (i.assignees as string[]) : [],
    labels: Array.isArray(i.labels) ? (i.labels as string[]) : [],
    project: strOrNull(i.projectId ?? i.project), parent: strOrNull(i.parentId ?? i.parent), children: [],
    branchName: str(i.branchName), priority: typeof i.priority === 'number' ? i.priority : 0, devProgress: str(i.devProgress),
    createdAt: str(i.createdAt) || new Date(0).toISOString(), updatedAt: str(i.updatedAt) || new Date(0).toISOString(),
    completedAt: strOrNull(i.completedAt), canceledAt: strOrNull(i.canceledAt),
    url: str(i.url) || `local://tracker/issue/${str(i.identifier || i.id)}`, comments: [],
  };
}

export interface MigrateResult { migrated: number; sqlitePath: string; ran: boolean }

/** Migrate a Python `local` backend's SQLite issues into markdown files. The original
 *  `tracker.sqlite` is left in place (a backup); only the issue data is copied across. */
export function migrateLocalToMarkdown(projectRoot: string): MigrateResult {
  const stateDir = stateDirName();
  const sqlitePath = join(projectRoot, stateDir, 'tracker', 'tracker.sqlite');
  if (!existsSync(sqlitePath)) return { migrated: 0, sqlitePath, ran: false };
  let raw: string;
  try {
    raw = execFileSync('python3', ['-c', DUMP_STORE, sqlitePath], { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`ztrack migrate-local: this one-time migration needs python3 to read the old SQLite store at ${sqlitePath}. Install python3 and re-run. (${(error as Error).message})`);
  }
  const store = JSON.parse(raw || '{}') as { issues?: Record<string, RawIssue> };
  const dir = join(projectRoot, stateDir, 'tracker', 'markdown');
  mkdirSync(dir, { recursive: true });
  let migrated = 0;
  for (const issue of Object.values(store.issues ?? {})) {
    const c = toCanonical(issue);
    if (!c.identifier) continue;
    writeFileSync(join(dir, `${c.identifier}.md`), serializeIssue(c));
    migrated += 1;
  }
  return { migrated, sqlitePath, ran: true };
}
