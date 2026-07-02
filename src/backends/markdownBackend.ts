// The `markdown` peer backend to `local`/SQLite. Implements TrackerBackend.command
// over the `.volter/tracker/markdown/*.md` store (the markdown.ts (de)serializer is
// its core), emitting JSON in the SAME shapes the local (Python/SQLite) backend does,
// so the SDK/CLI work against either backend identically. Selected by config
// `backend: "markdown"`. Validation reads this store through `issue list/view`
// (the loader frames those rows into the validation bundle); the project-manager
// `snapshot` report verb is the one backend command not yet implemented here.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { TrackerBackend, TrackerCommandResult } from '../types.ts';
import { type CanonicalIssue, parseIssue, serializeIssue } from './markdown.ts';
import { boardIndexDir, mainWorktreeMarkdownDir, markdownStoreDir } from '../config.ts';
import { git } from '../core/gitWorld.ts';

// Issue ids name files in the store; reject anything that isn't a plain id so a
// crafted id (or a `Children:` ref read from a file) can't traverse out of the store.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function issueFile(dir: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`invalid issue id: ${JSON.stringify(id)}`);
  return join(dir, `${id}.md`);
}
// A readable issue file resolves through the symlink (board-index entry) to its real committed md.
// A dangling symlink (its worktree was removed) reads as absent here; the caller falls back to trunk.
function readableMd(p: string): string | null {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : null; } catch { return null; }
}
function mdIds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md'));
}

// canonical → the full nested `issue view --json` shape (matches the local backend). `path` is
// the absolute on-disk file this issue was read from — always present (not `--json`-gated,
// unlike list's field selection), so the loader can populate IssueRecord.origin (ZTB-2).
export function viewJson(c: CanonicalIssue, path: string): Record<string, unknown> {
  return {
    id: c.identifier, identifier: c.identifier, number: c.identifier,
    title: c.title, branchName: c.branchName, description: c.body, body: c.body,
    state: { name: c.state, type: c.stateType }, stateType: c.stateType, devProgress: c.devProgress,
    priority: c.priority, url: c.url, path,
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
// canonical → a flat `issue list --json <fields>` row (matches the local backend: state/assignee as strings, parent "").
// `path` is a selectable field like any other — the loader (loader.ts) requests it explicitly
// so IssueRecord.origin can be populated, without changing the shape of any other caller's row.
function listRow(c: CanonicalIssue, fields: string[], path: string): Record<string, unknown> {
  const all: Record<string, unknown> = {
    id: c.identifier, identifier: c.identifier, number: c.identifier, title: c.title,
    body: c.body, description: c.body, state: c.state, stateType: c.stateType,
    createdAt: c.createdAt, updatedAt: c.updatedAt, project: c.project, parent: c.parent ?? '',
    labels: c.labels, url: c.url, priority: c.priority, assignee: c.assignees[0] ?? '', branchName: c.branchName, path,
  };
  const row: Record<string, unknown> = {};
  for (const f of fields) row[f] = all[f] ?? null;
  return row;
}

function flagVal(args: string[], name: string): string | undefined { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; }
function flagAll(args: string[], name: string): string[] { const out: string[] = []; for (let i = 0; i < args.length; i += 1) if (args[i] === `--${name}`) out.push(args[i + 1]!); return out; }
// The CLI passes an issue body either inline (`--body`) or by path (`--body-file`); read
// both, else the file content is silently dropped (the issue stores no acceptance criteria).
function bodyArg(args: string[]): string | undefined {
  const inline = flagVal(args, 'body'); if (inline !== undefined) return inline;
  const file = flagVal(args, 'body-file'); if (file !== undefined) return readFileSync(file, 'utf8');
  return undefined;
}
// The status TYPE behind a state NAME — preset rules gate on stateType (`isDone`/`isCanceled`),
// so `--state Done`/`Canceled` must record `completed`/`canceled`, not a hardcoded `open`.
function stateTypeOf(name: string): 'open' | 'completed' | 'canceled' {
  const n = name.trim().toLowerCase();
  if (n === 'done' || n === 'completed') return 'completed';
  if (n === 'canceled' || n === 'cancelled') return 'canceled';
  return 'open';
}
const ok = (stdout: string): TrackerCommandResult => ({ stdout, stderr: '' });

export class MarkdownBackend implements TrackerBackend {
  readonly name = 'markdown' as const;
  private readonly dir: string; // committed per-worktree store (this checkout) — the board stays IN GIT
  private readonly indexDir: string; // central symlink index (shared mode); === dir in branch mode (no-op)
  private readonly mainDir: string | null; // trunk's committed store — read fallback for a dangling index link
  private readonly shared: boolean;
  private readonly teamKey: string;
  private readonly projectRoot: string;
  constructor(projectRoot: string, teamKey: string) {
    this.projectRoot = projectRoot;
    this.dir = markdownStoreDir(projectRoot);
    this.indexDir = boardIndexDir(projectRoot);
    this.mainDir = mainWorktreeMarkdownDir(projectRoot);
    this.shared = this.indexDir !== this.dir;
    this.teamKey = teamKey;
    mkdirSync(this.dir, { recursive: true });
    if (this.shared) mkdirSync(this.indexDir, { recursive: true });
  }

  // The default assignee for a create that omits `--assignee`: the same git identity `waiver
  // sign` already uses (cliWaiver.ts) — a real owner instead of minting an unassigned issue the
  // installed preset immediately rejects (`issue_missing_assignee`). '' if git has no identity
  // configured (an explicit `--assignee ''` still wins either way — flags override defaults).
  private defaultAssignee(): string {
    return git(this.projectRoot, ['config', 'user.name']);
  }

  // Resolve the readable md for an id, preferring the LIVE owner: the index symlink target (the worktree
  // currently working it), then this checkout's committed copy, then trunk's (post-merge / fallback).
  private resolveBody(id: string): string | null {
    if (this.shared) { const fromIndex = readableMd(issueFile(this.indexDir, id)); if (fromIndex !== null) return fromIndex; }
    const here = readableMd(issueFile(this.dir, id)); if (here !== null) return here;
    if (this.shared && this.mainDir) return readableMd(issueFile(this.mainDir, id));
    return null;
  }
  // The absolute path the issue's content actually resolved from — same precedence as
  // resolveBody, so a finding's origin points at the file that was read, not just this
  // checkout's copy. Falls back to this checkout's path (e.g. right after a fresh write).
  private originPath(id: string): string {
    if (this.shared) { const p = issueFile(this.indexDir, id); if (readableMd(p) !== null) return p; }
    const here = issueFile(this.dir, id); if (readableMd(here) !== null) return here;
    if (this.shared && this.mainDir) { const p = issueFile(this.mainDir, id); if (readableMd(p) !== null) return p; }
    return issueFile(this.dir, id);
  }
  private loadOne(id: string): CanonicalIssue | null {
    const body = this.resolveBody(id); return body === null ? null : parseIssue(body);
  }
  private loadAll(): CanonicalIssue[] {
    if (!this.shared) return mdIds(this.dir).map((id) => parseIssue(readFileSync(issueFile(this.dir, id), 'utf8')));
    // shared: union ids across this checkout, the central index (other worktrees), and trunk; resolve each
    // to its live owner. Robust to a missing/stale index (a fresh clone has committed mds but no index).
    const ids = new Set<string>([...mdIds(this.dir), ...mdIds(this.indexDir), ...(this.mainDir ? mdIds(this.mainDir) : [])]);
    const out: CanonicalIssue[] = [];
    for (const id of ids) { const c = this.loadOne(id); if (c) out.push(c); }
    return out;
  }
  // Write the committed md to THIS checkout (board stays in git, on this branch); in shared mode (re)point
  // the central index symlink at it — making this worktree the live owner of the issue.
  private writeIssue(c: CanonicalIssue): void {
    const real = issueFile(this.dir, c.identifier);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(real, serializeIssue(c));
    if (this.shared) {
      const link = issueFile(this.indexDir, c.identifier);
      try { rmSync(link, { force: true }); symlinkSync(realpathSync(real), link); } catch { /* index is best-effort; loadAll still unions the committed store */ }
    }
  }
  // `parent` is a pointer; `children` is a DENORMALIZED VIEW of it (markdown.ts:19-20) that nothing
  // else maintains — so a reparent via `issue edit` must update both endpoints of the edge itself, or
  // `issue list --parent`/the old parent's `children` silently lie until someone fixes it by hand.
  // Bounded cost: one load+write of the old parent (if any) and one of the new parent (if any) — not
  // a scan of the store. `issue create --parent` does NOT backfill the parent's `children` —
  // a residual gap documented in docs/GUIDE.md's parent/children note.
  private reparentChildren(childId: string, oldParent: string | null, newParent: string | null): void {
    if (oldParent === newParent) return;
    if (oldParent) {
      const op = this.loadOne(oldParent);
      if (op && op.children.includes(childId)) { op.children = op.children.filter((id) => id !== childId); this.writeIssue(op); }
    }
    if (newParent) {
      const np = this.loadOne(newParent);
      if (np && !np.children.includes(childId)) { np.children = [...np.children, childId]; this.writeIssue(np); }
    }
  }
  private deleteIssue(id: string): void {
    rmSync(issueFile(this.dir, id), { force: true });
    if (this.shared) { try { rmSync(issueFile(this.indexDir, id), { force: true }); } catch { /* ignore */ } }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async command(args: string[]): Promise<TrackerCommandResult> {
    const [verb, sub, ...rest] = args;
    if (verb === 'issue' && sub === 'list') {
      const fields = (flagVal(args, 'json') ?? 'identifier').split(',').map((s) => s.trim()).filter(Boolean);
      let rows = this.loadAll();
      // `--state` is either a status TYPE (`open` = not closed, `closed` = completed/canceled,
      // `all` = no filter — what the local backend and the recovery scripts use) or a literal
      // state name ("In Progress"). Matching `open` as a literal name returns nothing.
      const state = flagVal(args, 'state');
      if (state === 'open') rows = rows.filter((c) => c.stateType !== 'completed' && c.stateType !== 'canceled');
      else if (state === 'closed') rows = rows.filter((c) => c.stateType === 'completed' || c.stateType === 'canceled');
      else if (state && state !== 'all') rows = rows.filter((c) => c.state === state);
      const label = flagVal(args, 'label'); if (label) rows = rows.filter((c) => c.labels.includes(label));
      const parent = flagVal(args, 'parent'); if (parent) rows = rows.filter((c) => c.parent === parent);
      const search = flagVal(args, 'search'); if (search) rows = rows.filter((c) => `${c.title}\n${c.body}`.toLowerCase().includes(search.toLowerCase()));
      const limit = flagVal(args, 'limit'); const limitN = Number(limit); if (limit && Number.isFinite(limitN) && limitN >= 0) rows = rows.slice(0, limitN);
      return ok(JSON.stringify(rows.map((c) => listRow(c, fields, this.originPath(c.identifier))), null, 2));
    }
    if (verb === 'issue' && sub === 'view') {
      const c = this.loadOne(rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      if (!args.includes('--json')) return ok(c.body);
      // children are recursively denormalized to full child objects (matches local's view)
      const seen = new Set<string>();
      const fullView = (issue: CanonicalIssue): Record<string, unknown> => {
        const v = viewJson(issue, this.originPath(issue.identifier));
        v.children = { nodes: issue.children.map((cid) => {
          if (seen.has(cid) || !SAFE_ID.test(cid)) return { id: cid, identifier: cid, number: cid };
          seen.add(cid); const ch = this.loadOne(cid);
          return ch ? fullView(ch) : { id: cid, identifier: cid, number: cid };
        }) };
        return v;
      };
      return ok(JSON.stringify(fullView(c), null, 2));
    }
    if (verb === 'issue' && sub === 'create') {
      const id = `${this.teamKey}-${this.loadAll().reduce((m, c) => Math.max(m, Number(c.identifier.split('-').pop()) || 0), 0) + 1}`;
      const now = new Date().toISOString();
      // Defaults conform to the installed preset (simple-sdlc's status enum starts at 'draft'
      // and requires a non-empty assignee), so a bare `issue create --title x` mints a record
      // `ztrack check` doesn't immediately reject. An explicit `--state`/`--assignee` (even the
      // empty string) still overrides, as before — only the OMITTED-flag case changes.
      const state = flagVal(args, 'state') ?? 'draft';
      const assigneeFlag = flagVal(args, 'assignee');
      const assignee = assigneeFlag !== undefined ? assigneeFlag : this.defaultAssignee();
      const c: CanonicalIssue = {
        identifier: id, title: flagVal(args, 'title') ?? '', body: bodyArg(args) ?? '',
        state, stateType: stateTypeOf(state), assignees: assignee ? [assignee] : [],
        labels: flagAll(args, 'label'), project: flagVal(args, 'project') ?? null, parent: flagVal(args, 'parent') ?? null,
        children: [], branchName: '', priority: 0, devProgress: '', createdAt: now, updatedAt: now,
        completedAt: null, canceledAt: null, url: `local://tracker/issue/${id}`, comments: [],
      };
      this.writeIssue(c);
      return ok(JSON.stringify(viewJson(c, this.originPath(c.identifier)), null, 2));
    }
    if (verb === 'issue' && sub === 'edit') {
      const c = this.loadOne(rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      const t = flagVal(args, 'title'); if (t) c.title = t;
      const b = bodyArg(args); if (b !== undefined) c.body = b;
      const s = flagVal(args, 'state'); if (s) { c.state = s; c.stateType = stateTypeOf(s); }
      const asg = flagVal(args, 'assignee'); if (asg !== undefined) c.assignees = asg ? [asg] : [];
      const p = flagVal(args, 'project'); if (p) c.project = p; if (args.includes('--remove-project')) c.project = null;
      // A reparent (either direction) keeps the OLD and NEW parents' `children` views in sync —
      // see reparentChildren above.
      const pa = flagVal(args, 'parent'); const removeParent = args.includes('--remove-parent');
      if (pa || removeParent) {
        const newParent = removeParent ? null : pa!;
        this.reparentChildren(c.identifier, c.parent, newParent);
        c.parent = newParent;
      }
      for (const l of flagAll(args, 'add-label')) if (!c.labels.includes(l)) c.labels.push(l);
      const rm = new Set(flagAll(args, 'remove-label')); c.labels = c.labels.filter((l) => !rm.has(l));
      c.updatedAt = new Date().toISOString();
      this.writeIssue(c);
      return ok(JSON.stringify(viewJson(c, this.originPath(c.identifier)), null, 2));
    }
    if (verb === 'issue' && sub === 'comment') {
      const c = this.loadOne(rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      c.comments.push({ user: 'local', createdAt: new Date().toISOString(), body: flagVal(args, 'body') ?? '' });
      c.updatedAt = new Date().toISOString();
      this.writeIssue(c);
      return ok('');
    }
    if (verb === 'issue' && sub === 'delete') {
      const c = this.loadOne(rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      this.deleteIssue(c.identifier);
      return ok(`deleted ${c.identifier}`);
    }
    if (verb === 'issue' && sub === 'close') {
      const c = this.loadOne(rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      const canceled = flagVal(args, 'reason') === 'canceled';
      c.state = canceled ? 'Canceled' : 'Done'; c.stateType = canceled ? 'canceled' : 'completed';
      const now = new Date().toISOString(); c.updatedAt = now; if (canceled) c.canceledAt = now; else c.completedAt = now;
      const cmt = flagVal(args, 'comment'); if (cmt) c.comments.push({ user: 'local', createdAt: now, body: cmt });
      this.writeIssue(c);
      return ok('');
    }
    if (verb === 'project' && sub === 'list') return ok('[]');
    if (verb === 'snapshot') return { stdout: '', stderr: 'the project-manager snapshot report is not yet implemented for the markdown backend' };
    return { stdout: '', stderr: `markdown backend: unsupported command "${args.join(' ')}"` };
  }
}

export function createMarkdownBackend(projectRoot: string, teamKey: string): TrackerBackend {
  return new MarkdownBackend(projectRoot, teamKey);
}
