// The `markdown` peer backend to `local`/SQLite. Implements TrackerBackend.command
// over the `.volter/tracker/markdown/*.md` store (the markdown.ts (de)serializer is
// its core), emitting JSON in the SAME shapes the local (Python/SQLite) backend does,
// so the SDK/CLI work against either backend identically. Selected by config
// `backend: "markdown"`. Snapshot assembly is built on top of `issue list/view` and
// is not reimplemented here (a follow-on once the snapshot path reads via the backend).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrackerBackend, TrackerCommandResult } from '../types.ts';
import { type CanonicalIssue, parseIssue, serializeIssue } from './markdown.ts';

function storeDir(projectRoot: string): string { return join(projectRoot, '.volter', 'tracker', 'markdown'); }
function issueFile(dir: string, id: string): string { return join(dir, `${id}.md`); }

function loadAll(dir: string): CanonicalIssue[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => parseIssue(readFileSync(join(dir, f), 'utf8')));
}
function loadOne(dir: string, id: string): CanonicalIssue | null {
  const p = issueFile(dir, id); return existsSync(p) ? parseIssue(readFileSync(p, 'utf8')) : null;
}

// canonical → the full nested `issue view --json` shape (matches the local backend)
export function viewJson(c: CanonicalIssue): Record<string, unknown> {
  return {
    id: c.identifier, identifier: c.identifier, number: c.identifier,
    title: c.title, branchName: c.branchName, description: c.body, body: c.body,
    state: { name: c.state, type: c.stateType }, stateType: c.stateType, devProgress: c.devProgress,
    priority: c.priority, url: c.url,
    labels: { nodes: c.labels.map((name) => ({ name })) },
    assignee: c.assignees.length ? { name: c.assignees[0] } : null,
    assignees: { nodes: c.assignees.map((name) => ({ name })) },
    project: c.project ? { id: c.project } : null,
    parent: c.parent ? { id: c.parent, identifier: c.parent } : null,
    children: { nodes: c.children.map((identifier) => ({ identifier })) }, // denormalized by the view handler
    comments: { nodes: c.comments.map((cc) => ({ body: cc.body, createdAt: cc.createdAt, user: { name: cc.user } })) },
    createdAt: c.createdAt, updatedAt: c.updatedAt, completedAt: c.completedAt, canceledAt: c.canceledAt,
  };
}
// canonical → a flat `issue list --json <fields>` row (matches the local backend: state/assignee as strings, parent "")
function listRow(c: CanonicalIssue, fields: string[]): Record<string, unknown> {
  const all: Record<string, unknown> = {
    id: c.identifier, identifier: c.identifier, number: c.identifier, title: c.title,
    body: c.body, description: c.body, state: c.state, stateType: c.stateType,
    createdAt: c.createdAt, updatedAt: c.updatedAt, project: c.project, parent: c.parent ?? '',
    labels: c.labels, url: c.url, priority: c.priority, assignee: c.assignees[0] ?? '', branchName: c.branchName,
  };
  const row: Record<string, unknown> = {};
  for (const f of fields) row[f] = all[f] ?? null;
  return row;
}

function flagVal(args: string[], name: string): string | undefined { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; }
function flagAll(args: string[], name: string): string[] { const out: string[] = []; for (let i = 0; i < args.length; i += 1) if (args[i] === `--${name}`) out.push(args[i + 1]!); return out; }
const ok = (stdout: string): TrackerCommandResult => ({ stdout, stderr: '' });

export class MarkdownBackend implements TrackerBackend {
  readonly name = 'markdown' as const;
  private readonly dir: string;
  private readonly teamKey: string;
  constructor(projectRoot: string, teamKey: string) { this.dir = storeDir(projectRoot); this.teamKey = teamKey; mkdirSync(this.dir, { recursive: true }); }

  // eslint-disable-next-line @typescript-eslint/require-await
  async command(args: string[]): Promise<TrackerCommandResult> {
    const [verb, sub, ...rest] = args;
    if (verb === 'issue' && sub === 'list') {
      const fields = (flagVal(args, 'json') ?? 'identifier').split(',').map((s) => s.trim()).filter(Boolean);
      let rows = loadAll(this.dir);
      const state = flagVal(args, 'state'); if (state) rows = rows.filter((c) => c.state === state);
      const label = flagVal(args, 'label'); if (label) rows = rows.filter((c) => c.labels.includes(label));
      const parent = flagVal(args, 'parent'); if (parent) rows = rows.filter((c) => c.parent === parent);
      const search = flagVal(args, 'search'); if (search) rows = rows.filter((c) => `${c.title}\n${c.body}`.toLowerCase().includes(search.toLowerCase()));
      const limit = flagVal(args, 'limit'); if (limit) rows = rows.slice(0, Number(limit));
      return ok(JSON.stringify(rows.map((c) => listRow(c, fields)), null, 2));
    }
    if (verb === 'issue' && sub === 'view') {
      const c = loadOne(this.dir, rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      if (!args.includes('--json')) return ok(c.body);
      // children are recursively denormalized to full child objects (matches local's view)
      const seen = new Set<string>();
      const fullView = (issue: CanonicalIssue): Record<string, unknown> => {
        const v = viewJson(issue);
        v.children = { nodes: issue.children.map((cid) => {
          if (seen.has(cid)) return { id: cid, identifier: cid, number: cid };
          seen.add(cid); const ch = loadOne(this.dir, cid);
          return ch ? fullView(ch) : { id: cid, identifier: cid, number: cid };
        }) };
        return v;
      };
      return ok(JSON.stringify(fullView(c), null, 2));
    }
    if (verb === 'issue' && sub === 'create') {
      const id = `${this.teamKey}-${loadAll(this.dir).reduce((m, c) => Math.max(m, Number(c.identifier.split('-').pop()) || 0), 0) + 1}`;
      const now = new Date().toISOString();
      const c: CanonicalIssue = {
        identifier: id, title: flagVal(args, 'title') ?? '', body: flagVal(args, 'body') ?? '',
        state: flagVal(args, 'state') ?? 'Backlog', stateType: 'open', assignees: flagVal(args, 'assignee') ? [flagVal(args, 'assignee')!] : [],
        labels: flagAll(args, 'label'), project: flagVal(args, 'project') ?? null, parent: flagVal(args, 'parent') ?? null,
        children: [], branchName: '', priority: 0, devProgress: '', createdAt: now, updatedAt: now,
        completedAt: null, canceledAt: null, url: `local://tracker/issue/${id}`, comments: [],
      };
      writeFileSync(issueFile(this.dir, id), serializeIssue(c));
      return ok(JSON.stringify(viewJson(c), null, 2));
    }
    if (verb === 'issue' && sub === 'edit') {
      const c = loadOne(this.dir, rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      const t = flagVal(args, 'title'); if (t) c.title = t;
      const b = flagVal(args, 'body'); if (b !== undefined) c.body = b;
      const s = flagVal(args, 'state'); if (s) c.state = s;
      const p = flagVal(args, 'project'); if (p) c.project = p; if (args.includes('--remove-project')) c.project = null;
      const pa = flagVal(args, 'parent'); if (pa) c.parent = pa; if (args.includes('--remove-parent')) c.parent = null;
      for (const l of flagAll(args, 'add-label')) if (!c.labels.includes(l)) c.labels.push(l);
      const rm = new Set(flagAll(args, 'remove-label')); c.labels = c.labels.filter((l) => !rm.has(l));
      c.updatedAt = new Date().toISOString();
      writeFileSync(issueFile(this.dir, c.identifier), serializeIssue(c));
      return ok(JSON.stringify(viewJson(c), null, 2));
    }
    if (verb === 'issue' && sub === 'comment') {
      const c = loadOne(this.dir, rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      c.comments.push({ user: 'local', createdAt: new Date().toISOString(), body: flagVal(args, 'body') ?? '' });
      c.updatedAt = new Date().toISOString();
      writeFileSync(issueFile(this.dir, c.identifier), serializeIssue(c));
      return ok('');
    }
    if (verb === 'issue' && sub === 'close') {
      const c = loadOne(this.dir, rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      const canceled = flagVal(args, 'reason') === 'canceled';
      c.state = canceled ? 'Canceled' : 'Done'; c.stateType = canceled ? 'canceled' : 'completed';
      const now = new Date().toISOString(); c.updatedAt = now; if (canceled) c.canceledAt = now; else c.completedAt = now;
      const cmt = flagVal(args, 'comment'); if (cmt) c.comments.push({ user: 'local', createdAt: now, body: cmt });
      writeFileSync(issueFile(this.dir, c.identifier), serializeIssue(c));
      return ok('');
    }
    if (verb === 'project' && sub === 'list') return ok('[]');
    if (verb === 'snapshot') return { stdout: '', stderr: 'snapshot is not yet implemented for the markdown backend (build the snapshot on issue list/view)' };
    return { stdout: '', stderr: `markdown backend: unsupported command "${args.join(' ')}"` };
  }
}

export function createMarkdownBackend(projectRoot: string, teamKey: string): TrackerBackend {
  return new MarkdownBackend(projectRoot, teamKey);
}
