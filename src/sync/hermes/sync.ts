// `ztrack sync hermes` — one markdown file (a `document` source in the kanban preset's grammar)
// kept two-way in step with a Hermes kanban. The board is the source of truth and the substrate
// every other actor (Hermes's dispatcher, supercode's, a person on `hermes kanban`) writes to; the
// file is how an agent reads and writes that board as text. The method is `ztrack sync github`'s
// (src/sync/github/reconcile.ts): a three-way, field-level merge against the state both sides last
// agreed on (the BASE, machine-local under the sync state dir), so a file edit and a board change
// to different fields both land, and a same-field collision is recorded as a sync conflict (which
// `ztrack check` gates on) instead of either side silently winning.
//
//   read board (CLI) ─┐
//   read file (preset)├─ merge per card & field vs base ─ apply to board (CLI doors) ─ re-read
//   read base ────────┘                                    board ─ render file ─ save base
//
// Hermes has no door to edit a created card's title, body, workspace, branch or priority, and none
// to reopen a done card. A file edit to any of those RE-CREATES the card — the ritual a board
// operator does by hand: a new card with the edited fields and the same parents, children relinked
// to it, a `replaces`/`replaced by` comment on each, the old card archived, and the section's id
// rewritten to the new card's.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { check as runCheck, type CoreRoot, type IssueRecord, type Preset } from '../../core/engine.ts';
import { DocumentSource } from '../../backends/documentSource.ts';
import { shiftHeadings } from '../../documentWriteBack.ts';
import { parseMarkdownDocument } from '../../markdownDocument.ts';
import { syncStateDir } from '../../config.ts';
import { setIssueConflicts, loadConflicts, type ConflictRecord } from '../conflicts.ts';
import { boardWriter, readBoard, type BoardWriter, type HermesCard, type HermesExec } from './board.ts';

export type HermesPolicy = 'merge' | 'board-wins' | 'file-wins';

export interface HermesSyncOpts {
  projectRoot: string;
  /** The board file, project-root-relative or absolute. */
  file: string;
  exec: HermesExec;
  /** The installed preset; must be the kanban preset (its card fields are the sync's contract). */
  preset: Preset<CoreRoot>;
  policy?: HermesPolicy;
  /** Newest comments shown per open card (default 5); done cards show only the count. */
  comments?: number;
  /** The command a reader runs for a card's full thread, printed after the earlier-comment count
   *  (default `hermes kanban show`). */
  showCommand?: string;
  dryRun?: boolean;
}

export interface HermesSyncResult {
  pulled: string[]; pushed: string[]; created: string[]; recreated: Array<{ from: string; to: string }>;
  archived: string[]; conflicts: Array<{ card: string; fields: string[] }>;
  /** Board writes Hermes refused, each `<action>: <Hermes's reason>` (also recorded as conflicts). */
  failed: string[];
  /** Every board write the sync made (or, dry, would make), in order. */
  actions: string[];
}

// ── the card as both sides are compared: Hermes-space ids, canonical values ─────────────────
interface Snap {
  title: string; body: string; status: string; assignee: string | null; parents: string[];
  workspace: string; branch: string | null; priority: number;
}
const FIELDS = ['title', 'body', 'status', 'assignee', 'parents', 'workspace', 'branch', 'priority'] as const;
type Field = typeof FIELDS[number];
/** Fields only a new card can carry (Hermes has no edit door for them). */
const CREATION_FIELDS: Field[] = ['title', 'body', 'workspace', 'branch', 'priority'];

const RESOLVE = 'Edit the card in the file to agree with the board (or remove a section with no card), then `ztrack sync hermes`; `--policy file-wins` keeps the file, `--policy board-wins` takes the board.';
const CARD_HEADING = /^[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9]+\b/;
const FILE_ID = /^t-[0-9a-f]+$/;
export const toFileId = (hermesId: string) => hermesId.replace(/^t_/, 't-');
export const toHermesId = (fileId: string) => fileId.replace(/^t-/, 't_');

/** The body as the file grammar round-trips it (see the kanban preset's serialize/parse). */
function canonBody(s: string): string {
  const lines = s.replace(/\r\n?/g, '\n').split('\n').map((l) => (/^\s{0,3}#/.test(l) ? l.trimStart() : l));
  let a = 0; let b = lines.length;
  while (a < b && lines[a]!.trim() === '') a++;
  while (b > a && lines[b - 1]!.trim() === '') b--;
  return lines.slice(a, b).join('\n');
}

const workspaceOf = (c: HermesCard) => (c.workspaceKind === 'scratch' ? 'scratch' : c.workspacePath ? `${c.workspaceKind}:${c.workspacePath}` : c.workspaceKind);

function remoteSnap(c: HermesCard): Snap {
  return {
    title: c.title, body: canonBody(c.body), status: c.status, assignee: c.assignee,
    parents: [...c.parents].sort(), workspace: workspaceOf(c), branch: c.branch, priority: c.priority,
  };
}

/** A card of the kanban preset's validated root (the fields the sync reads). */
interface FileCard {
  id: string; title: string; status: string; assignee?: string; relations?: Array<{ type: string; issueId: string }>;
  workspace?: string; branch?: string; priority?: number; body: string;
  comments: Array<{ at?: string; author?: string; text: string }>; earlierComments: number; earlierWhere?: string;
}

function localSnap(c: FileCard, idMap: Map<string, string>): Snap {
  return {
    title: c.title, body: canonBody(c.body), status: c.status, assignee: c.assignee ?? null,
    parents: (c.relations ?? []).filter((r) => r.type === 'blocked-by').map((r) => idMap.get(r.issueId) ?? toHermesId(r.issueId)).sort(),
    workspace: c.workspace ?? 'scratch', branch: c.branch ?? null, priority: c.priority ?? 0,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === null ? '(none)' : String(v));

// ── the base: what file and board last agreed on, per Hermes id ───────────────────────────────
type Base = Record<string, Snap>;
const basePath = (projectRoot: string, file: string) => join(syncStateDir(projectRoot), `hermes-base.${file.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`);
function loadBase(p: string): Base {
  try { return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as { cards: Base }).cards ?? {} : {}; } catch { return {}; }
}
function saveBase(p: string, cards: Base): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify({ cards }, null, 2)}\n`);
}

// ── the file: read through the document source + the installed preset; render as a whole ─────
function readFile(abs: string, preset: Preset<CoreRoot>): { cards: FileCard[]; preamble: string } {
  if (!existsSync(abs)) return { cards: [], preamble: '' };
  const text = readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n');
  // The sync re-renders the file whole, so every heading must belong to the grammar: a card
  // (`## <id> — <title>`) or its `### Comments`. Anything else would be dropped or moved by the
  // next render — refuse instead, naming the line.
  const stray = parseMarkdownDocument(text).sections.filter((s, _i, all) => {
    if (s.level === 2 && CARD_HEADING.test(s.title)) return false;
    const parent = s.parentIndex === null ? null : all[s.parentIndex]!;
    return !(s.level === 3 && /^comments$/i.test(s.title.trim()) && parent?.level === 2 && CARD_HEADING.test(parent.title));
  });
  if (stray.length) {
    const lines = stray.slice(0, 5).map((s) => `  ${abs}:${s.lineStart}: ${'#'.repeat(s.level)} ${s.title}`).join('\n');
    throw new Error(`ztrack sync hermes: ${abs} has headings that are neither a card (\`## <id> — <title>\`) nor a card's \`### Comments\`; nothing was synced. Write a literal \`#\` line as \`\\#\`:\n${lines}`);
  }
  const source = new DocumentSource({ dir: abs, format: 'document', readonly: true, isDefault: false, name: abs });
  const records: IssueRecord[] = source.ids().map((id) => {
    const issue = source.load(id)!;
    return { id, title: issue.title, status: issue.state, ...(issue.assignees[0] ? { assignee: issue.assignees[0] } : {}), body: issue.body, origin: source.origin(id) };
  });
  const result = runCheck(preset, records, {});
  if (!result.export) {
    const why = result.findings.filter((f) => f.severity === 'error').slice(0, 5).map((f) => `  ${f.issueId ?? ''} ${f.message}`).join('\n');
    throw new Error(`ztrack sync hermes: ${abs} does not parse as a kanban board — nothing was synced.\n${why}`);
  }
  const first = text.split('\n').findIndex((l) => /^#{1,6}\s+[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9]+\b/.test(l));
  const preamble = (first < 0 ? text : text.split('\n').slice(0, first).join('\n')).replace(/\s+$/, '');
  return { cards: result.export.issues as unknown as FileCard[], preamble };
}

const LANE_ORDER = ['running', 'review', 'ready', 'todo', 'triage', 'blocked', 'scheduled', 'done', 'archived'];

function renderSection(preset: Preset<CoreRoot>, card: FileCard): string {
  const { body } = preset.serialize!({ ...card, summary: '', acceptanceCriteria: [] } as unknown as CoreRoot['issues'][number]);
  const header = [`status: ${card.status}`, ...(card.assignee ? [`assignee: ${card.assignee}`] : [])].join('\n');
  const content = body.trim() ? `\n${shiftHeadings(body.replace(/\n+$/, ''), 1)}\n` : '';
  return `## ${card.id} — ${card.title}\n\n${header}\n${content}`;
}

function renderFile(preset: Preset<CoreRoot>, preamble: string, cards: FileCard[]): string {
  return `${preamble}\n\n${cards.map((c) => renderSection(preset, c)).join('\n')}`;
}

function stamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

function remoteToFileCard(c: HermesCard, opts: { comments: number; showCommand: string }, override?: Partial<Snap>, idOf: (h: string) => string = toFileId): FileCard {
  const s = { ...remoteSnap(c), ...(override ?? {}) };
  const keep = s.status === 'done' ? 0 : opts.comments;
  const shown = keep > 0 ? c.comments.slice(-keep) : [];
  const earlier = c.comments.length - shown.length;
  return {
    id: idOf(c.id), title: s.title, status: s.status, ...(s.assignee ? { assignee: s.assignee } : {}),
    ...(s.parents.length ? { relations: s.parents.map((p) => ({ type: 'blocked-by', issueId: idOf(p) })) } : {}),
    ...(s.workspace !== 'scratch' ? { workspace: s.workspace } : {}),
    ...(s.branch ? { branch: s.branch } : {}),
    ...(s.priority ? { priority: s.priority } : {}),
    body: s.body,
    comments: shown.map((cm) => ({ at: stamp(cm.createdAt), author: cm.author || 'unknown', text: cm.body.trim() || '(empty)' })),
    earlierComments: earlier,
    ...(earlier ? { earlierWhere: `${opts.showCommand} ${c.id}` } : {}),
  };
}

// ── status: the Hermes verb for each lane change a person can make ────────────────────────────
function transitionVerb(from: string, to: string): ((w: BoardWriter, id: string) => Promise<void>) | string {
  if (to === 'archived') return (w, id) => w.archive(id);
  if (from === 'done') return 'recreate';
  if (to === 'done') return (w, id) => w.complete(id);
  if (to === 'blocked') return (w, id) => w.block(id);
  if (to === 'scheduled') return (w, id) => w.schedule(id);
  if (to === 'review') return (w, id) => w.requestReview(id);
  if (to === 'ready' || to === 'todo') {
    if (from === 'blocked' || from === 'scheduled') return (w, id) => w.unblock(id);
    if (to === 'ready' && from === 'todo') return (w, id) => w.promote(id);
    if (to === 'ready' && from === 'review') return (w, id) => w.reopenReview(id);
    return `Hermes has no door from ${from} to ${to}`;
  }
  if (to === 'running') return 'only a dispatcher claims a card into running';
  if (to === 'triage') return 'a card enters triage only when it is created there';
  return `unknown lane ${to}`;
}

/** Two-way sync of one board file with a Hermes kanban. */
export async function syncHermes(opts: HermesSyncOpts): Promise<HermesSyncResult> {
  if (opts.preset.name !== 'kanban' || !opts.preset.serialize) {
    throw new Error(`ztrack sync hermes: the installed preset is '${opts.preset.name}'; a Hermes-backed board needs the kanban preset (\`ztrack init --preset kanban\`).`);
  }
  const policy = opts.policy ?? 'merge';
  const view = { comments: opts.comments ?? 5, showCommand: opts.showCommand ?? 'hermes kanban show' };
  const abs = isAbsolute(opts.file) ? opts.file : resolve(opts.projectRoot, opts.file);
  const bPath = basePath(opts.projectRoot, opts.file);
  const base = loadBase(bPath);
  const writer = boardWriter(opts.exec);
  const dry = !!opts.dryRun;
  const res: HermesSyncResult = { pulled: [], pushed: [], created: [], recreated: [], archived: [], conflicts: [], failed: [], actions: [] };

  const before = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  const { cards: localCards, preamble } = readFile(abs, opts.preset);
  const remote = new Map((await readBoard(opts.exec)).map((c) => [c.id, c]));

  // Provisional ids (a section whose id isn't a board id) are new cards; map them as they're made.
  const idMap = new Map<string, string>();
  for (const c of localCards) if (FILE_ID.test(c.id)) idMap.set(c.id, toHermesId(c.id));
  const localById = new Map(localCards.map((c) => [c.id, c]));
  const conflictsByCard = new Map<string, ConflictRecord[]>();
  const keepLocal = new Map<string, Partial<Snap>>(); // Hermes id -> fields held at the file's value
  const orphans: FileCard[] = [];                    // sections kept in the file with no card behind them
  const conflict = (fileId: string, rec: ConflictRecord) => conflictsByCard.set(fileId, [...(conflictsByCard.get(fileId) ?? []), { ...rec, resolve: RESOLVE }]);
  const hold = (hid: string, f: Field, value: unknown) => keepLocal.set(hid, { ...(keepLocal.get(hid) ?? {}), [f]: value });

  // Every board write is one Hermes verb. A refused write never strands the sync half-applied:
  // it is recorded (a conflict that gates `ztrack check`, the file keeping its value) and the
  // sync goes on to render the board as it actually stands.
  const act = async (label: string, fn: () => Promise<unknown>): Promise<string | null> => {
    res.actions.push(label);
    if (dry) return null;
    try { await fn(); return null; } catch (e) {
      const why = (e as Error).message.replace(/^hermes kanban \S+: /, '').split('\n')[0]!;
      res.failed.push(`${label}: ${why}`);
      return why;
    }
  };

  // 1. New cards, parents first (a new card may be blocked by another new one).
  const fresh = localCards.filter((c) => !FILE_ID.test(c.id));
  const made = new Set<string>();
  const createOne = async (c: FileCard, trail: string[]): Promise<void> => {
    if (made.has(c.id)) return;
    if (trail.includes(c.id)) throw new Error(`ztrack sync hermes: new cards block each other in a loop: ${[...trail, c.id].join(' -> ')}`);
    for (const r of c.relations ?? []) {
      const dep = fresh.find((f) => f.id === r.issueId);
      if (dep) await createOne(dep, [...trail, c.id]);
    }
    made.add(c.id);
    const s = localSnap(c, idMap);
    let newId = `(new ${c.id})`;
    const failed = await act(`create ${c.id} "${c.title}"`, async () => {
      newId = await writer.create({ title: s.title, body: s.body, assignee: s.assignee, parents: s.parents, workspace: s.workspace, branch: s.branch, priority: s.priority });
    });
    if (failed) { orphans.push(c); conflict(c.id, { field: 'card', local: 'new in the file', remote: `not created: ${failed}` }); return; }
    idMap.set(c.id, newId);
    const fid = dry ? c.id : toFileId(newId);
    res.created.push(fid);
    if (s.status !== 'todo' && s.status !== 'ready') {
      const verb = transitionVerb('ready', s.status);
      const why = typeof verb === 'function' ? await act(`${s.status} ${c.id}`, () => verb(writer, newId)) : verb;
      if (why) { conflict(fid, { field: 'status', local: `${s.status} (${why})`, remote: 'ready' }); hold(newId, 'status', s.status); }
    }
    for (const cm of c.comments.filter((x) => !x.at)) {
      const why = await act(`comment ${c.id}`, () => writer.comment(newId, cm.text));
      if (why) conflict(fid, { field: 'comment', local: cm.text, remote: `not posted: ${why}` });
    }
  };
  for (const c of fresh) await createOne(c, []);

  // 2. Cards on both sides (or once on both): merge per field against the base.
  const recreate = async (r: HermesCard, t: Snap, changed: Field[]): Promise<string | null> => {
    let newId = `(new for ${r.id})`;
    const failed = await act(`re-create ${toFileId(r.id)} (${changed.join(', ')} changed)`, async () => {
      newId = await writer.create({ title: t.title, body: t.body, assignee: t.assignee, parents: t.parents, workspace: t.workspace, branch: t.branch, priority: t.priority });
    });
    if (failed) return failed;
    if (!dry) {
      for (const child of remote.values()) {
        if (!child.parents.includes(r.id)) continue;
        await act(`link ${toFileId(newId)} -> ${toFileId(child.id)}`, () => writer.link(newId, child.id));
        await act(`unlink ${toFileId(r.id)} -> ${toFileId(child.id)}`, () => writer.unlink(r.id, child.id));
        child.parents = child.parents.map((p) => (p === r.id ? newId : p)); // the child's merge below sees the relink
      }
      await act(`comment ${toFileId(newId)}`, () => writer.comment(newId, `replaces ${r.id} (${changed.join(', ')} edited in ${opts.file})`));
      await act(`comment ${toFileId(r.id)}`, () => writer.comment(r.id, `replaced by ${newId}`));
      await act(`archive ${toFileId(r.id)}`, () => writer.archive(r.id));
      if (t.status !== 'todo' && t.status !== 'ready') {
        const verb = transitionVerb('ready', t.status);
        if (typeof verb === 'function') await act(`${t.status} ${toFileId(newId)}`, () => verb(writer, newId));
      }
    }
    idMap.set(toFileId(r.id), newId);
    res.recreated.push({ from: toFileId(r.id), to: dry ? '(new)' : toFileId(newId) });
    return null;
  };

  for (const local of localCards.filter((c) => FILE_ID.test(c.id))) {
    const hid = toHermesId(local.id);
    const r = remote.get(hid);
    const b = base[hid];
    const L = localSnap(local, idMap);
    if (!r) {
      // Gone from the board (archived or deleted there). Unchanged in the file since the base:
      // the file follows. Otherwise the edit has nowhere to land — keep the section and gate.
      if (b && FIELDS.every((f) => same(L[f], b[f]))) { res.pulled.push(local.id); continue; }
      conflict(local.id, { field: 'card', local: 'in the file', remote: b ? 'no longer on the board' : 'never on the board' });
      orphans.push(local);
      continue;
    }
    const R = remoteSnap(r);
    const T: Snap = { ...R };
    const pushFields: Field[] = [];
    const conflicted: Field[] = [];
    const refuse = (f: Field, why: string) => { conflict(local.id, { field: f, local: `${show(L[f])} (${why})`, remote: show(R[f]) }); hold(hid, f, L[f]); (T as unknown as Record<string, unknown>)[f] = R[f]; };
    for (const f of FIELDS) {
      const l = L[f]; const rv = R[f]; const bv = b?.[f];
      if (same(l, rv)) continue;
      if (b && same(l, bv)) continue;                                   // board changed: pull
      if ((b && same(rv, bv)) || policy === 'file-wins') { (T as unknown as Record<string, unknown>)[f] = l; pushFields.push(f); continue; }
      if (policy === 'board-wins') continue;
      conflict(local.id, { field: f, local: show(l), remote: show(rv) });
      hold(hid, f, l);
      conflicted.push(f);
    }
    // A pushed status change Hermes has no door for is refused: the file keeps its value, gated.
    let needsRecreate = pushFields.filter((f) => CREATION_FIELDS.includes(f));
    if (pushFields.includes('status')) {
      const verb = transitionVerb(R.status, T.status);
      if (verb === 'recreate') needsRecreate = [...needsRecreate, 'status'];
      else if (typeof verb === 'string') refuse('status', `refused: ${verb}`);
    }
    if (r.status === 'running' && needsRecreate.length) {
      for (const f of needsRecreate) refuse(f, 'refused: the card is running');
      needsRecreate = [];
    }
    const newComments = local.comments.filter((c) => !c.at);
    const postComments = async (to: string) => {
      for (const cm of newComments) {
        const why = await act(`comment ${local.id}`, () => writer.comment(to, cm.text));
        if (why) conflict(local.id, { field: 'comment', local: cm.text, remote: `not posted: ${why}` });
      }
    };
    if (pushFields.length) res.pushed.push(local.id);
    if (needsRecreate.length) {
      const why = await recreate(r, T, needsRecreate);
      if (why) for (const f of needsRecreate) refuse(f, `not re-created: ${why}`);
      await postComments(idMap.get(local.id)!);
      continue;
    }
    if (!same(T.assignee, R.assignee)) {
      const why = await act(`assign ${local.id} ${T.assignee ?? 'none'}`, () => writer.assign(hid, T.assignee));
      if (why) refuse('assignee', why);
    }
    let linkFailed: string | null = null;
    for (const p of T.parents.filter((x) => !R.parents.includes(x))) linkFailed ??= await act(`link ${toFileId(p)} -> ${local.id}`, () => writer.link(p, hid));
    for (const p of R.parents.filter((x) => !T.parents.includes(x))) linkFailed ??= await act(`unlink ${toFileId(p)} -> ${local.id}`, () => writer.unlink(p, hid));
    if (linkFailed) refuse('parents', linkFailed);
    if (T.status !== R.status) {
      const verb = transitionVerb(R.status, T.status);
      const why = typeof verb === 'function' ? await act(`${T.status} ${local.id}`, () => verb(writer, hid)) : null;
      if (why) refuse('status', why);
    }
    await postComments(hid);
    const boardComments = r.comments.length !== local.earlierComments + local.comments.filter((c) => c.at).length;
    if (boardComments || FIELDS.some((f) => !same(L[f], R[f]) && !pushFields.includes(f) && !conflicted.includes(f))) res.pulled.push(local.id);
  }

  // 3. Board cards with no section: new on the board (pull), or a section the file dropped (archive).
  for (const r of remote.values()) {
    const fid = toFileId(r.id);
    if (localById.has(fid)) continue;
    const b = base[r.id];
    if (!b) { res.pulled.push(fid); continue; }
    if (FIELDS.every((f) => same(remoteSnap(r)[f], b[f]))) {
      const why = await act(`archive ${fid} (section removed from ${opts.file})`, () => writer.archive(r.id));
      if (why) conflict(fid, { field: 'card', local: 'removed from the file', remote: `not archived: ${why}` });
      else res.archived.push(fid);
    } else res.pulled.push(fid); // changed on the board since: the board wins, the section returns
  }

  for (const [card, recs] of conflictsByCard) res.conflicts.push({ card, fields: recs.map((r) => r.field) });
  if (dry) return res;

  // 4. The board as it now stands, rendered whole; the base follows every card that agreed.
  const after = await readBoard(opts.exec);
  const byCreated = new Map(after.map((c) => [toFileId(c.id), c.createdAt]));
  const rendered = after
    .map((c) => remoteToFileCard(c, view, keepLocal.get(c.id)))
    .sort((a, b) => (LANE_ORDER.indexOf(a.status) - LANE_ORDER.indexOf(b.status)) || ((byCreated.get(a.id) ?? 0) - (byCreated.get(b.id) ?? 0)));
  const text = renderFile(opts.preset, preamble || DEFAULT_PREAMBLE, [...rendered, ...orphans]);

  const now = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (now !== before) {
    throw new Error(`ztrack sync hermes: ${opts.file} changed while syncing; the board has the changes that were read before it did. Run the sync again.`);
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);

  const nextBase: Base = {};
  for (const c of after) nextBase[c.id] = keepLocal.has(c.id) ? (base[c.id] ?? remoteSnap(c)) : remoteSnap(c);
  saveBase(bPath, nextBase);
  const stale = Object.keys(loadConflicts(opts.projectRoot).issues).filter((id) => FILE_ID.test(id) && !conflictsByCard.has(id));
  for (const id of stale) setIssueConflicts(opts.projectRoot, id, []);
  for (const [card, recs] of conflictsByCard) setIssueConflicts(opts.projectRoot, card, recs);
  return res;
}

const DEFAULT_PREAMBLE = [
  'This file is a Hermes kanban, kept in step with it by `ztrack sync hermes`: edit it, then sync.',
  'One `## <card id> — <title>` section per card, then its `status:`/`assignee:` lines, then the',
  'kanban preset\'s grammar (`Blocked by:`/`Workspace:`/`Branch:`/`Priority:`, the opening post, and',
  `\`### Comments\`). A new card is a section with any id that isn't a board id (\`## new-1 — …\`);`,
  'deleting a section archives its card. The grammar: docs/SYNC-HERMES.md in ztrack.',
].join('\n');
