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
import { type CanonicalIssue, parseIssue, serializeIssue, stateTypeOf } from './markdown.ts';
import { boardIndexDir, mainWorktreeMarkdownDir, markdownStoreDir } from '../config.ts';
import { git } from '../core/gitWorld.ts';
import { IdAllocator } from '../idAllocator.ts';
import { resolveSources, type ResolvedSource } from '../sources.ts';
import { DocumentSource } from './documentSource.ts';
import type { IssueSource, SourceOrigin } from './issueSource.ts';
import { activeStatusEnum } from '../presetRegistry.ts';
import { nearestKey } from '../configSchema.ts';

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
// unlike list's field selection), so the loader can populate IssueRecord.origin (ZTB-2). `span`
// (ZTB-4) additionally carries a document-sourced issue's section line span; absent (issue-per-file)
// omits `lineStart`/`lineEnd` entirely rather than emitting them as null.
export function viewJson(c: CanonicalIssue, path: string, span?: { lineStart?: number; lineEnd?: number }): Record<string, unknown> {
  return {
    id: c.identifier, identifier: c.identifier, number: c.identifier,
    title: c.title, branchName: c.branchName, description: c.body, body: c.body,
    state: { name: c.state, type: c.stateType }, stateType: c.stateType, devProgress: c.devProgress,
    priority: c.priority, url: c.url, path,
    ...(span?.lineStart !== undefined ? { lineStart: span.lineStart } : {}),
    ...(span?.lineEnd !== undefined ? { lineEnd: span.lineEnd } : {}),
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
// `lineStart`/`lineEnd` (ZTB-4) are the same kind of selectable field, null when the source has no
// span (issue-per-file) or the caller didn't ask.
function listRow(c: CanonicalIssue, fields: string[], path: string, span?: { lineStart?: number; lineEnd?: number }): Record<string, unknown> {
  const all: Record<string, unknown> = {
    id: c.identifier, identifier: c.identifier, number: c.identifier, title: c.title,
    body: c.body, description: c.body, state: c.state, stateType: c.stateType,
    createdAt: c.createdAt, updatedAt: c.updatedAt, project: c.project, parent: c.parent ?? '',
    labels: c.labels, url: c.url, priority: c.priority, assignee: c.assignees[0] ?? '', branchName: c.branchName, path,
    lineStart: span?.lineStart ?? null, lineEnd: span?.lineEnd ?? null,
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
const ok = (stdout: string): TrackerCommandResult => ({ stdout, stderr: '' });

// One declared source's on-disk machinery: the CRUD logic that used to be the whole backend
// (one dir, at most one shared-board index/trunk pair) is unchanged — it just now belongs to
// ONE of potentially several sources instead of being the only one. Only `isDefault` sources
// (today: exactly the implicit `markdownStoreDir()`) get the index/trunk union; a plain declared
// source is a single directory, read/written directly.
class MarkdownSource implements IssueSource {
  readonly format = 'issue-per-file' as const;
  readonly dir: string; // this source's directory (default: THIS checkout's committed store)
  readonly indexDir: string; // central symlink index (default source, shared mode); === dir otherwise (no-op)
  readonly mainDir: string | null; // trunk's committed store — read fallback for a dangling index link (default source only)
  readonly shared: boolean;
  readonly readonlySource: boolean;
  readonly isDefault: boolean;
  // Alias for `dir`, satisfying `IssueSource`'s uniform "where this source lives" field used in
  // error messages — additive, `dir` itself is untouched everywhere else in this class.
  get location(): string { return this.dir; }
  constructor(resolved: ResolvedSource, opts: { indexDir?: string; mainDir?: string | null } = {}) {
    this.dir = resolved.dir;
    this.indexDir = opts.indexDir ?? resolved.dir;
    this.mainDir = opts.mainDir ?? null;
    this.shared = this.indexDir !== this.dir;
    this.readonlySource = resolved.readonly;
    this.isDefault = resolved.isDefault;
    mkdirSync(this.dir, { recursive: true });
    if (this.shared) mkdirSync(this.indexDir, { recursive: true });
  }
  ids(): string[] {
    return [...new Set([...mdIds(this.dir), ...mdIds(this.indexDir), ...(this.mainDir ? mdIds(this.mainDir) : [])])];
  }
  // Resolve the readable md for an id, preferring the LIVE owner: the index symlink target (the worktree
  // currently working it), then this checkout's committed copy, then trunk's (post-merge / fallback).
  resolveBody(id: string): string | null {
    if (this.shared) { const fromIndex = readableMd(issueFile(this.indexDir, id)); if (fromIndex !== null) return fromIndex; }
    const here = readableMd(issueFile(this.dir, id)); if (here !== null) return here;
    if (this.shared && this.mainDir) return readableMd(issueFile(this.mainDir, id));
    return null;
  }
  // The absolute path the issue's content actually resolved from — same precedence as
  // resolveBody, so a finding's origin points at the file that was read, not just this
  // checkout's copy. Falls back to this checkout's path (e.g. right after a fresh write).
  originPath(id: string): string {
    if (this.shared) { const p = issueFile(this.indexDir, id); if (readableMd(p) !== null) return p; }
    const here = issueFile(this.dir, id); if (readableMd(here) !== null) return here;
    if (this.shared && this.mainDir) { const p = issueFile(this.mainDir, id); if (readableMd(p) !== null) return p; }
    return issueFile(this.dir, id);
  }
  // `IssueSource` conformance (ZTB-4): thin wrappers over the methods above, so this class's own
  // internals (and every existing caller of resolveBody/originPath) are untouched.
  load(id: string): CanonicalIssue | null { const body = this.resolveBody(id); return body === null ? null : parseIssue(body); }
  origin(id: string): SourceOrigin { return { path: this.originPath(id) }; }
  // Write the committed md to THIS checkout (board stays in git, on this branch); in shared mode (re)point
  // the central index symlink at it — making this worktree the live owner of the issue.
  write(c: CanonicalIssue): void {
    const real = issueFile(this.dir, c.identifier);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(real, serializeIssue(c));
    if (this.shared) {
      const link = issueFile(this.indexDir, c.identifier);
      try { rmSync(link, { force: true }); symlinkSync(realpathSync(real), link); } catch { /* index is best-effort; ids() still unions the committed store */ }
    }
  }
  delete(id: string): void {
    rmSync(issueFile(this.dir, id), { force: true });
    if (this.shared) { try { rmSync(issueFile(this.indexDir, id), { force: true }); } catch { /* ignore */ } }
  }
}

export class MarkdownBackend implements TrackerBackend {
  readonly name = 'markdown' as const;
  private readonly sources: IssueSource[];
  private readonly teamKey: string;
  private readonly projectRoot: string;
  // `sources` (resolved by `resolveSources`) is optional so direct callers (unit tests, and any
  // caller that never reads tracker-config.json) keep TODAY's exact single-store behavior: one
  // implicit issue-per-file source at `markdownStoreDir(projectRoot)`, with the shared-board
  // index/trunk union it already had.
  constructor(projectRoot: string, teamKey: string, sources?: ResolvedSource[]) {
    this.projectRoot = projectRoot;
    this.teamKey = teamKey;
    const resolved = sources && sources.length ? sources : resolveSources(projectRoot, {});
    // A `document` source (ZTB-4) is a single FILE, parsed into many issues — a wholly different
    // class (DocumentSource) from `issue-per-file`'s directory-shaped MarkdownSource. Both
    // conform to `IssueSource`, so everything below this constructor is format-agnostic.
    this.sources = resolved.map((s): IssueSource => (s.format === 'document'
      ? new DocumentSource(s)
      : new MarkdownSource(s, s.isDefault ? { indexDir: boardIndexDir(projectRoot), mainDir: mainWorktreeMarkdownDir(projectRoot) } : {})
    ));
  }

  // The default assignee for a create that omits `--assignee`: the same git identity `waiver
  // sign` already uses (cliWaiver.ts) — a real owner instead of minting an unassigned issue the
  // installed preset immediately rejects (`issue_missing_assignee`). '' if git has no identity
  // configured (an explicit `--assignee ''` still wins either way — flags override defaults).
  private defaultAssignee(): string {
    return git(this.projectRoot, ['config', 'user.name']);
  }

  // ZTB-23 dev/01 + dev/02: validate a `--state` value against the ACTIVE preset's status
  // vocabulary BEFORE writing it — the single choke point every state-writing lifecycle command
  // (create/edit; close never takes an arbitrary value, see its own --reason gate below) routes
  // through, so a typo (`in_progress` for `in-progress`) fails at the point of the mistake with a
  // did-you-mean, instead of writing silently and surfacing later as an unrelated
  // `wellformed_shape` finding from `ztrack check` (the real 0.38.0 bug this closes). Degrades to
  // undefined (no error — today's permissive behavior) whenever `activeStatusEnum` can't resolve a
  // vocabulary at all: no validation entrypoint configured, the entrypoint fails to load, or the
  // preset's `status` field isn't a plain zod enum. Returns an error STRING (never throws) so
  // every call site can `if (msg) return { stdout: '', stderr: msg };` uniformly.
  private async invalidStateError(commandLabel: string, state: string): Promise<string | undefined> {
    const enumValues = await activeStatusEnum(this.projectRoot);
    if (!enumValues || enumValues.includes(state)) return undefined;
    const suggestion = nearestKey(state, enumValues);
    return (
      `${commandLabel}: "${state}" is not a valid status for the active preset — its status vocabulary is ` +
      `[${enumValues.join(', ')}]${suggestion ? `, did you mean "${suggestion}"?` : ''}. Nothing was written.\n`
    );
  }

  // The FIRST source (declared order) that currently holds `id` — deterministic when an id is
  // unique (the expected/normal case; `ztrack check` is what flags a genuine cross-source
  // collision, via `issue_id_conflict`). Absent sources param default = exactly one source, so
  // this is a no-op lookup in the byte-identical-compat case.
  private sourceOf(id: string): IssueSource | undefined {
    return this.sources.find((s) => s.load(id) !== null);
  }
  // Choke point for every write path (edit/comment/close/delete via writeIssue/deleteIssue below).
  // ZTB-4 dev/09: a `document` source is no longer gated shut HERE — it CAN be written (splice
  // write-back), but only within the narrow delta `DocumentSource.write` itself accepts (body
  // and/or title; see documentSource.ts's guards, which fail closed with a file-naming message
  // for anything wider — status/assignee/labels/reparent/comment/delete). This method still keeps
  // the `readonly: true` config check, which now ALSO protects a `readonly: true` document source
  // (a document source can be declared readonly the same way an issue-per-file one can).
  private requireSourceWritable(source: IssueSource): void {
    if (source.readonlySource) {
      throw new Error(`the source '${source.location}' is read-only (declared readonly: true in tracker-config.json); its issues cannot be written through ztrack — edit the source it reads instead.`);
    }
  }
  // `parent` is a pointer; `children` is a DENORMALIZED VIEW of it (markdown.ts:19-20) that nothing
  // else maintains — so a reparent via `issue edit` must update both endpoints of the edge itself, or
  // `issue list --parent`/the old parent's `children` silently lie until someone fixes it by hand.
  // Bounded cost: one load+write of the old parent (if any) and one of the new parent (if any) — not
  // a scan of the store. `issue create --parent` does NOT backfill the parent's `children` —
  // a residual gap documented in docs/GUIDE.md's parent/children note. Writes route through
  // writeIssue, so a parent living in a `readonly: true` source fails the whole edit closed
  // (the read-only error names that source) rather than leaving the edge half-updated.
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
  private loadOne(id: string): CanonicalIssue | null {
    const source = this.sourceOf(id);
    return source ? source.load(id) : null;
  }
  // Every (issue, source-path[, span]) pair across ALL declared sources, UNDEDUPED across distinct
  // sources — an id present in two different sources surfaces as two entries here on purpose
  // (see engine.ts `crossSourceConflicts`: `ztrack check` turns that into an `issue_id_conflict`
  // finding rather than this layer silently picking a winner). Within ONE source, `ids()`
  // already unions/dedupes its own checkout/index/trunk locations via a Set, so that precedence
  // is untouched. `lineStart`/`lineEnd` (ZTB-4) are present only for a document-sourced issue.
  private loadAllRaw(): Array<{ c: CanonicalIssue; path: string; lineStart?: number; lineEnd?: number }> {
    const out: Array<{ c: CanonicalIssue; path: string; lineStart?: number; lineEnd?: number }> = [];
    for (const source of this.sources) {
      for (const id of source.ids()) {
        const c = source.load(id);
        if (c === null) continue;
        out.push({ c, ...source.origin(id) });
      }
    }
    return out;
  }
  private loadAll(): CanonicalIssue[] { return this.loadAllRaw().map((r) => r.c); }
  // The full origin (path + optional line span) id's content actually resolved from (first source
  // that has it — see sourceOf). Every caller has already confirmed the id exists (via loadOne),
  // so the fallback to sources[0] (always non-empty — see the constructor) is unreachable in
  // practice; it exists only so this stays a plain getter, never a throw.
  private originOf(id: string): SourceOrigin {
    const source = this.sourceOf(id) ?? this.sources[0]!;
    return source.origin(id);
  }
  private originPath(id: string): string { return this.originOf(id).path; }
  // Resolve the owning source of an EXISTING issue and write it there, after confirming that
  // source isn't `readonly: true`. Used by edit/comment/close — never by create (see
  // mintTargetSource: a NEW issue has no existing source to route to).
  private writeIssue(c: CanonicalIssue): void {
    const source = this.sourceOf(c.identifier);
    if (!source) throw new Error(`markdown backend: cannot resolve the source of issue ${c.identifier}.`);
    this.requireSourceWritable(source);
    source.write(c);
  }
  private deleteIssue(id: string): void {
    const source = this.sourceOf(id);
    if (!source) return;
    this.requireSourceWritable(source);
    source.delete(id);
  }
  // `issue create` mints into the first WRITABLE `issue-per-file` source (declared order); with no
  // `sources` config that's the one implicit default, exactly as before. A `document` source
  // (ZTB-4) is NEVER a mint target, even if nothing marks it `readonly: true` — creating an issue
  // means adding a new id-bearing heading to the file, which is the same not-yet-implemented
  // write-back as editing an existing one (dev/09).
  private mintTargetSource(): IssueSource {
    const target = this.sources.find((s) => s.format === 'issue-per-file' && !s.readonlySource);
    if (!target) throw new Error('markdown backend: no writable issue-per-file source is configured for new issues (every declared source is either readonly: true or a "document" source, which cannot be minted into).');
    return target;
  }

  async command(args: string[]): Promise<TrackerCommandResult> {
    const [verb, sub, ...rest] = args;
    if (verb === 'issue' && sub === 'list') {
      const fields = (flagVal(args, 'json') ?? 'identifier').split(',').map((s) => s.trim()).filter(Boolean);
      let rows = this.loadAllRaw();
      // `--state` is either a status TYPE (`open` = not closed, `closed` = completed/canceled,
      // `all` = no filter — what the local backend and the recovery scripts use) or a literal
      // state name ("In Progress"). Matching `open` as a literal name returns nothing.
      const state = flagVal(args, 'state');
      if (state === 'open') rows = rows.filter((r) => r.c.stateType !== 'completed' && r.c.stateType !== 'canceled');
      else if (state === 'closed') rows = rows.filter((r) => r.c.stateType === 'completed' || r.c.stateType === 'canceled');
      else if (state && state !== 'all') rows = rows.filter((r) => r.c.state === state);
      const label = flagVal(args, 'label'); if (label) rows = rows.filter((r) => r.c.labels.includes(label));
      const parent = flagVal(args, 'parent'); if (parent) rows = rows.filter((r) => r.c.parent === parent);
      const search = flagVal(args, 'search'); if (search) rows = rows.filter((r) => `${r.c.title}\n${r.c.body}`.toLowerCase().includes(search.toLowerCase()));
      const limit = flagVal(args, 'limit'); const limitN = Number(limit); if (limit && Number.isFinite(limitN) && limitN >= 0) rows = rows.slice(0, limitN);
      return ok(JSON.stringify(rows.map((r) => listRow(r.c, fields, r.path, r)), null, 2));
    }
    if (verb === 'issue' && sub === 'view') {
      const c = this.loadOne(rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      if (!args.includes('--json')) return ok(c.body);
      // children are recursively denormalized to full child objects (matches local's view)
      const seen = new Set<string>();
      const fullView = (issue: CanonicalIssue): Record<string, unknown> => {
        const o = this.originOf(issue.identifier);
        const v = viewJson(issue, o.path, o);
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
      const body = bodyArg(args) ?? '';
      // A bare `--title` is optional: an omitted flag derives the title from the body's first
      // `# Heading` line (mirroring the loose-file fallback in check.ts's title derivation) so a
      // `--body-file` authored the normal way ("start with a heading") doesn't ALSO need
      // --title. Only the omitted-flag case derives/refuses — an explicit `--title` (even `''`)
      // is unchanged, as before. Never mint a record the installed preset immediately rejects
      // for a blank title: with neither a flag nor a heading, refuse at create time.
      const titleFlag = flagVal(args, 'title');
      let title = titleFlag;
      if (title === undefined) {
        title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
        if (!title) {
          return {
            stdout: '',
            stderr: "issue create: no --title given and the body has no '# Heading' line to derive one from — the installed preset rejects a blank title. Pass --title, or start the body with `# Heading`.\n",
          };
        }
      }
      // ZTB-23 dev/01: an EXPLICIT --state is checked against the active preset's status
      // vocabulary before minting — same typo-catching gate `issue edit --state` gets below. The
      // OMITTED-flag default ('draft', next line) is deliberately NOT run through this gate: it's
      // a preset-specific convenience (matches simple-sdlc/simple-gh-sdlc/spec, not speckit's
      // vocabulary) that predates this check, not a value the OPERATOR typed — validating it here
      // would turn a bare `issue create --title x` into a hard failure on a preset whose
      // vocabulary doesn't happen to include 'draft', which is strictly worse than today.
      const stateFlag = flagVal(args, 'state');
      if (stateFlag !== undefined) {
        const err = await this.invalidStateError('issue create --state', stateFlag);
        if (err) return { stdout: '', stderr: err };
      }
      const target = this.mintTargetSource();
      // Shared minting rule (idAllocator.ts): max numeric suffix across every loaded issue (any
      // prefix, not scoped per-prefix), plus one. importBacklog.ts's batch importer mints via the
      // same class — see idAllocator.ts's top comment.
      const allocator = new IdAllocator();
      for (const c of this.loadAll()) allocator.note(c.identifier);
      const id = allocator.next(this.teamKey);
      const now = new Date().toISOString();
      // Defaults conform to the installed preset (simple-sdlc's status enum starts at 'draft'
      // and requires a non-empty assignee), so a bare `issue create --title x` mints a record
      // `ztrack check` doesn't immediately reject. An explicit `--state`/`--assignee` (even the
      // empty string) still overrides, as before — only the OMITTED-flag case changes.
      const state = stateFlag ?? 'draft';
      const assigneeFlag = flagVal(args, 'assignee');
      const assignee = assigneeFlag !== undefined ? assigneeFlag : this.defaultAssignee();
      const c: CanonicalIssue = {
        identifier: id, title, body,
        state, stateType: stateTypeOf(state), assignees: assignee ? [assignee] : [],
        labels: flagAll(args, 'label'), project: flagVal(args, 'project') ?? null, parent: flagVal(args, 'parent') ?? null,
        children: [], branchName: '', priority: 0, devProgress: '', createdAt: now, updatedAt: now,
        completedAt: null, canceledAt: null, url: `local://tracker/issue/${id}`, comments: [],
      };
      target.write(c);
      return ok(JSON.stringify(viewJson(c, target.origin(c.identifier).path), null, 2));
    }
    if (verb === 'issue' && sub === 'edit') {
      const c = this.loadOne(rest[0]!); if (!c) return { stdout: '', stderr: `issue ${rest[0]} not found` };
      const t = flagVal(args, 'title'); if (t) c.title = t;
      const b = bodyArg(args); if (b !== undefined) c.body = b;
      // ZTB-23 dev/01: validate an explicit --state against the active preset's status vocabulary
      // BEFORE mutating anything — `issue edit <id> --state in_progress` (the underscore typo)
      // now fails closed with a did-you-mean, instead of writing silently and surfacing later as
      // an unrelated `wellformed_shape` finding from `ztrack check`.
      const s = flagVal(args, 'state');
      if (s) {
        const err = await this.invalidStateError(`issue edit ${rest[0]} --state`, s);
        if (err) return { stdout: '', stderr: err };
        c.state = s; c.stateType = stateTypeOf(s);
      }
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
      const id = rest[0]!;
      const reason = flagVal(args, 'reason');
      // ZTB-22 reviewer finding, closed here: an unrecognized --reason used to fall through to the
      // completed path silently (any value other than the exact string 'canceled' was treated as
      // "not canceled", i.e. completed) — `issue close foo --reason oops` recorded it as done with
      // no indication the flag was ignored. Fail closed and name the two values close accepts.
      if (reason !== undefined && reason !== 'completed' && reason !== 'canceled') {
        return {
          stdout: '',
          stderr: `issue close --reason "${reason}": not a recognized reason — accepted values are 'completed' or 'canceled'. Nothing was written.\n`,
        };
      }
      if (reason === 'canceled') {
        // Fail closed: every shipped preset (simple-sdlc, simple-gh-sdlc, spec, speckit) has a
        // lowercase status vocabulary with `done` as its only terminal member and NO "canceled"
        // state — so recording a cancellation would mean either writing a status value the
        // preset rejects, or falsely claiming completion. Neither is honest; write nothing and
        // say so (matches the tone of documentSource.ts's fail-closed errors).
        return {
          stdout: '',
          stderr:
            `issue close --reason canceled: no shipped preset's status vocabulary has a "canceled" state, so ` +
            `cancellation cannot be recorded without falsely claiming completion — nothing was written. Use ` +
            `'ztrack issue delete ${id}' to remove the issue instead, or 'ztrack issue edit ${id} --state <status> ` +
            `--add-label <label>' to record it under a status your preset actually has.\n`,
        };
      }
      c.state = 'done'; c.stateType = 'completed';
      const now = new Date().toISOString(); c.updatedAt = now; c.completedAt = now;
      const cmt = flagVal(args, 'comment'); if (cmt) c.comments.push({ user: 'local', createdAt: now, body: cmt });
      this.writeIssue(c);
      return ok('');
    }
    if (verb === 'project' && sub === 'list') return ok('[]');
    if (verb === 'snapshot') return { stdout: '', stderr: 'the project-manager snapshot report is not yet implemented for the markdown backend' };
    return { stdout: '', stderr: `markdown backend: unsupported command "${args.join(' ')}"\nrun 'ztrack --help' for supported commands\n` };
  }
}

export function createMarkdownBackend(projectRoot: string, teamKey: string, sources?: ResolvedSource[]): TrackerBackend {
  return new MarkdownBackend(projectRoot, teamKey, sources);
}
