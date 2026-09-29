// `ztrack sync hermes` — one markdown file (a `document` source in the kanban preset's grammar)
// kept in step with a kanban in Hermes's format, through supercode's board door (board.ts). The
// FILE is where the board is written; the board is generated from it, and what only the board's
// dispatcher and sessions write (a move a session or reviewer makes, the open run) comes back into
// the file. Each field has one writer at a time, so there is no conflict state: a field the file
// changed since the last sync goes to the board, a field only the board changed comes to the file,
// and a file edit the board's workflow refuses is reported while the file shows where the card is.
//
//   read board (list --json) ─┐
//   read file (preset) ───────├─ per card & field vs base ─ apply to board (its verbs) ─ re-read
//   read base ────────────────┘                                board ─ render file ─ save base
//
// What maps where. A card's title and prose (with `Session:`) are its text, edited in place
// (`specify`); `Machine:` is the machine it runs on (`move`); the lane is the workflow's status,
// reached by whichever event the workflow says goes there (`goto`); `Blocked by:` is its parent
// links. A card's TASKS are its subtasks (`create --subtask-of`): a task `- [ ] c3 <text>` is the
// subtask titled `c3 <text>`, ticked when it is done, its `blocked-by` its links. The workspace,
// branch and priority are fixed at creation: an edit to one RE-CREATES the card (a new card with
// the edited fields, the same parents, children relinked, `replaces`/`replaced by` comments, the
// old card archived, the section renamed).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { check as runCheck, type BlockRef, type CoreRoot, type IssueRecord, type Preset } from '../../core/engine.ts';
import { formatRef } from '../../core/ref.ts';
import { DocumentSource } from '../../backends/documentSource.ts';
import { shiftHeadings } from '../../documentWriteBack.ts';
import { parseMarkdownDocument } from '../../markdownDocument.ts';
import { syncStateDir } from '../../config.ts';
import { boardWriter, readBoard, type BoardCard, type BoardExec } from './board.ts';

export interface HermesSyncOpts {
  projectRoot: string;
  /** The board file, project-root-relative or absolute. */
  file: string;
  exec: BoardExec;
  /** The installed preset; must be the kanban preset (its card fields are the sync's contract). */
  preset: Preset<CoreRoot>;
  dryRun?: boolean;
}

export interface HermesSyncResult {
  pulled: string[]; pushed: string[]; created: string[]; recreated: Array<{ from: string; to: string }>;
  archived: string[];
  /** File edits the board refused, each `<action>: <the board's reason>`; the file shows the board's value. */
  refused: string[];
  /** Every board write the sync made (or, dry, would make), in order. */
  actions: string[];
}

// ── the card as both sides are compared: board card ids, canonical values ──────────────────────
// a task's acceptance lines are its subtask's checkbox lines (`- [ ] <criterion>`, `- [x] <criterion>: <evidence>`)
interface TaskLine { checked: boolean; text: string }
interface Task { id: string; status: string; text: string; blockedBy: string[]; lines: TaskLine[] } // refs `<file card id>[:<task>]`
const CHECKBOX = /^\s*[-*] \[( |x|X)\]\s+(.+)$/;
const linesOf = (body: string): TaskLine[] => body.split('\n').flatMap((l) => { const m = CHECKBOX.exec(l); return m ? [{ checked: m[1] !== ' ', text: m[2]!.trim() }] : []; });
/** A subtask's text with its acceptance lines set to `lines` (its other text kept, the lines after it). */
function withLines(body: string, lines: TaskLine[]): string {
  const rest = body.split('\n').filter((l) => !CHECKBOX.test(l)).join('\n').trim();
  const rendered = lines.map((l) => `- [${l.checked ? 'x' : ' '}] ${l.text}`).join('\n');
  return [rest, rendered].filter(Boolean).join('\n\n');
}
interface Snap {
  title: string; body: string; status: string; assignee: string | null; parents: string[];
  workspace: string; branch: string | null; priority: number;
  machine: string | null; session: string | null; tasks: Task[];
}
const FIELDS = ['title', 'body', 'status', 'assignee', 'parents', 'workspace', 'branch', 'priority', 'machine', 'session', 'tasks'] as const;
type Field = typeof FIELDS[number];
/** Fields only a new card can carry (the board has no edit door for them). */
const CREATION_FIELDS: Field[] = ['workspace', 'branch', 'priority'];

const CARD_HEADING = /^[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9]+\b/;
const FILE_ID = /^t-[0-9a-f]+$/;
const TASK_TITLE = /^([a-z]+\d+)\s+([\s\S]+)$/;
export const toFileId = (boardId: string) => boardId.replace(/^t_/, 't-');
export const toBoardId = (fileId: string) => fileId.replace(/^t-/, 't_');

/** The body as the file grammar round-trips it (see the kanban preset's serialize/parse). */
function canonBody(s: string): string {
  const lines = s.replace(/\r\n?/g, '\n').split('\n').map((l) => (/^\s{0,3}#/.test(l) ? l.trimStart() : l));
  let a = 0; let b = lines.length;
  while (a < b && lines[a]!.trim() === '') a++;
  while (b > a && lines[b - 1]!.trim() === '') b--;
  return lines.slice(a, b).join('\n');
}

const workspaceOf = (c: BoardCard) => (c.workspaceKind === 'scratch' ? 'scratch' : c.workspacePath ? `${c.workspaceKind}:${c.workspacePath}` : c.workspaceKind);
// a task id is a letter prefix and a number (`c3`, `s1`); tasks sort by prefix, then number
const taskNumber = (id: string) => Number(/\d+$/.exec(id)?.[0] ?? 0);
const byTaskId = (a: Task, b: Task) => a.id.replace(/\d+$/, '').localeCompare(b.id.replace(/\d+$/, '')) || taskNumber(a.id) - taskNumber(b.id);

/** A card of the kanban preset's validated root (the fields the sync reads). */
interface FileCard {
  id: string; title: string; status: string; assignee?: string; relations?: Array<{ type: string; issueId: string }>;
  workspace?: string; branch?: string; priority?: number; run?: string; machine?: string; session?: string; body: string;
  acceptanceCriteria: Array<{ id: string; status: string; text: string; blockedBy?: BlockRef[]; sources?: TaskSource[]; lines?: TaskLine[] }>;
  unparsed?: string[];
}

/** The message a task cites as where it came from: the file's own, which the board does not hold. */
type TaskSource = { id: string; quote?: string };
/** A card's tasks' sources, by task id. */
const sourcesByTask = (c: FileCard) => new Map(c.acceptanceCriteria.filter((t) => t.sources?.length).map((t) => [t.id, t.sources!]));

/** The card's text on the board: its prose and `Session:`, in the preset's grammar (no tasks, no
 *  board fields: those are the board's own). */
function cardText(preset: Preset<CoreRoot>, fileId: string, s: Pick<Snap, 'body' | 'session'>): string {
  const { body } = preset.serialize!({
    id: fileId, title: fileId, summary: '', status: 'todo', body: s.body, acceptanceCriteria: [],
    ...(s.session ? { session: s.session } : {}),
  } as unknown as CoreRoot['issues'][number]);
  return body.trim();
}

/** The board as the file sees it: the top-level cards, each with its prose and session read from
 *  its text (parsed in one batch through the preset) and its subtasks as tasks. */
interface BoardView {
  cards: BoardCard[];
  /** Every card id on the board, subtasks included. */
  ids: Set<string>;
  snap: (c: BoardCard) => Snap;
  /** arc board id -> task id -> subtask board id */
  subtaskIds: Map<string, Map<string, string>>;
  /** Subtasks whose titles carry no task id yet: [subtask, arc]. */
  unnamed: Array<[BoardCard, BoardCard]>;
  /** Each subtask's text, by its board id. */
  bodies: Map<string, string>;
}

function viewOf(all: BoardCard[], preset: Preset<CoreRoot>): BoardView {
  const cards = all.filter((c) => !c.subtaskOf);
  const byId = new Map(all.map((c) => [c.id, c]));
  const parsed = new Map(((preset.parse(cards.map((c) => ({ id: toFileId(c.id), title: c.title || c.id, status: 'todo', body: c.body })) as IssueRecord[]) as { issues: FileCard[] }).issues)
    .map((p) => [toBoardId(p.id), p]));
  const subtaskIds = new Map<string, Map<string, string>>();
  const unnamed: Array<[BoardCard, BoardCard]> = [];
  const tasksOf = new Map<string, Array<{ card: BoardCard; id: string; text: string }>>();
  for (const s of all) {
    if (!s.subtaskOf || !byId.has(s.subtaskOf)) continue;
    const m = TASK_TITLE.exec(s.title);
    if (!m) { unnamed.push([s, byId.get(s.subtaskOf)!]); continue; }
    if (!subtaskIds.has(s.subtaskOf)) subtaskIds.set(s.subtaskOf, new Map());
    subtaskIds.get(s.subtaskOf)!.set(m[1]!, s.id);
    tasksOf.set(s.subtaskOf, [...(tasksOf.get(s.subtaskOf) ?? []), { card: s, id: m[1]!, text: m[2]!.trim() }]);
  }
  // a subtask's parent as a task ref: another card's task (`t-…:c2`) or a whole card (`t-…`)
  const refOf = (parent: string): string => {
    const p = byId.get(parent);
    const m = p?.subtaskOf ? TASK_TITLE.exec(p.title) : null;
    return m ? `${toFileId(p!.subtaskOf!)}:${m[1]}` : toFileId(parent);
  };
  const snap = (c: BoardCard): Snap => {
    const p = parsed.get(c.id);
    return {
      title: c.title, status: c.status, assignee: c.assignee,
      parents: [...c.parents].sort(), workspace: workspaceOf(c), branch: c.branch, priority: c.priority,
      machine: c.machine, session: p?.session ?? null, body: canonBody(p?.body ?? c.body),
      tasks: (tasksOf.get(c.id) ?? []).map((t) => ({ id: t.id, status: t.card.status === 'done' ? 'passed' : 'pending', text: t.text, blockedBy: t.card.parents.map(refOf).sort(), lines: linesOf(t.card.body) })).sort(byTaskId),
    };
  };
  return { cards, ids: new Set(all.map((c) => c.id)), snap, subtaskIds, unnamed, bodies: new Map(all.filter((c) => c.subtaskOf).map((c) => [c.id, c.body])) };
}

function localSnap(c: FileCard, idMap: Map<string, string>): Snap {
  const fileIdOf = (fileId: string) => toFileId(idMap.get(fileId) ?? toBoardId(fileId));
  return {
    title: c.title, body: canonBody(c.body), status: c.status, assignee: c.assignee ?? null,
    parents: (c.relations ?? []).filter((r) => r.type === 'blocked-by').map((r) => idMap.get(r.issueId) ?? toBoardId(r.issueId)).sort(),
    workspace: c.workspace ?? 'scratch', branch: c.branch ?? null, priority: c.priority ?? 0,
    machine: c.machine ?? null, session: c.session ?? null,
    tasks: c.acceptanceCriteria.map((t) => ({
      id: t.id, status: t.status, text: t.text,
      blockedBy: (t.blockedBy ?? []).map((r) => formatRef({ issue: fileIdOf(r.issue), ...(r.ac !== undefined ? { ac: r.ac } : {}) })).sort(),
      lines: t.lines ?? [],
    })).sort(byTaskId),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── the base: what file and board last agreed on, per board id ────────────────────────────────
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
function readFile(abs: string, preset: Preset<CoreRoot>, strict = false): { cards: FileCard[]; preamble: string } {
  if (!existsSync(abs)) return { cards: [], preamble: '' };
  const text = readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n');
  // The sync re-renders the file whole, so every heading must belong to the grammar: a card
  // (`## <id> — <title>`) or its `### Tasks`. Anything else would be dropped or moved by the next
  // render — refuse instead, naming the line.
  const stray = parseMarkdownDocument(text).sections.filter((s, _i, all) => {
    if (s.level === 2 && CARD_HEADING.test(s.title)) return false;
    const parent = s.parentIndex === null ? null : all[s.parentIndex]!;
    return !(s.level === 3 && /^tasks$/i.test(s.title.trim()) && parent?.level === 2 && CARD_HEADING.test(parent.title));
  });
  if (stray.length) {
    const lines = stray.slice(0, 5).map((s) => `  ${abs}:${s.lineStart}: ${'#'.repeat(s.level)} ${s.title}`).join('\n');
    throw new Error(`ztrack sync hermes: ${abs} has headings that are neither a card (\`## <id> — <title>\`) nor a card's \`### Tasks\`; nothing was synced. Write a literal \`#\` line as \`\\#\`:\n${lines}`);
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
  // A file an agent wrote must validate before any of it reaches the board: a card whose
  // `status:`/`assignee:` block was discarded (no blank line after it) would otherwise read as a
  // `todo`, unassigned card with those lines in its prose, and push all three.
  if (strict) {
    const problems = [
      ...source.headerDiagnostics().map((d) => `  ${d.issueId}: ${d.message}`),
      ...result.findings.filter((f) => f.severity === 'error').map((f) => `  ${f.issueId ?? ''}${f.origin?.line ? ` (line ${f.origin.line})` : ''}: ${f.message}`),
    ];
    if (problems.length) {
      throw new Error(`ztrack sync hermes: ${abs} doesn't validate, so nothing was synced and the board is untouched. Fix these (\`ztrack check ${basename(abs)}\` shows them too), then sync:\n${problems.slice(0, 10).join('\n')}${problems.length > 10 ? `\n  … ${problems.length - 10} more` : ''}`);
    }
  }
  const first = text.split('\n').findIndex((l) => /^#{1,6}\s+[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9]+\b/.test(l));
  const preamble = (first < 0 ? text : text.split('\n').slice(0, first).join('\n')).replace(/\s+$/, '');
  return { cards: result.export.issues as unknown as FileCard[], preamble };
}

// the file's order: a busy card first, then waiting, then set aside; a status this list does not
// name (the board's workflow declares its own) sits before `done`
const LANE_ORDER = ['running', 'triaging', 'reviewing', 'review', 'ready', 'todo', 'triage', 'blocked', 'stopped', 'scheduled', 'standing', 'done', 'archived'];
const laneRank = (s: string) => { const i = LANE_ORDER.indexOf(s); return i < 0 ? LANE_ORDER.indexOf('done') - 0.5 : i; };

function renderSection(preset: Preset<CoreRoot>, card: FileCard): string {
  const { body } = preset.serialize!({ ...card, summary: '' } as unknown as CoreRoot['issues'][number]);
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

function toFileCard(c: BoardCard, s: Snap, unparsed?: string[], sources?: Map<string, TaskSource[]>): FileCard {
  const toRef = (ref: string): BlockRef => { const [issue, ac] = ref.split(':'); return { issue: issue!, ...(ac ? { ac } : {}) }; };
  return {
    id: toFileId(c.id), title: s.title, status: s.status, ...(s.assignee ? { assignee: s.assignee } : {}),
    ...(s.parents.length ? { relations: s.parents.map((p) => ({ type: 'blocked-by', issueId: toFileId(p) })) } : {}),
    ...(s.workspace !== 'scratch' ? { workspace: s.workspace } : {}),
    ...(s.branch ? { branch: s.branch } : {}),
    ...(s.priority ? { priority: s.priority } : {}),
    ...(c.run ? { run: `${c.run.id} ${c.run.status}${c.run.startedAt ? ` since ${stamp(c.run.startedAt)}` : ''}${c.run.session ? `, ${c.run.session}` : ''}` } : {}),
    ...(s.machine ? { machine: s.machine } : {}),
    ...(s.session ? { session: s.session } : {}),
    body: s.body,
    acceptanceCriteria: s.tasks.map((t) => ({
      id: t.id, status: t.status, evidence: [], text: t.text, ...(t.blockedBy.length ? { blockedBy: t.blockedBy.map(toRef) } : {}),
      ...(sources?.get(t.id) ? { sources: sources.get(t.id) } : {}),
      ...(t.lines.length ? { lines: t.lines } : {}),
    })),
    ...(unparsed?.length ? { unparsed } : {}),
  };
}

// ── one sync at a time per board file: a manual `sync hermes` and `--watch` never interleave ──
const lockPath = (projectRoot: string, file: string) => join(syncStateDir(projectRoot), `hermes-sync.${file.replace(/[^A-Za-z0-9._-]+/g, '_')}.lock`);
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
async function withSyncLock<T>(p: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(p), { recursive: true });
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { writeFileSync(p, String(process.pid), { flag: 'wx' }); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let holder = 0;
      try { holder = Number(readFileSync(p, 'utf8')); } catch { continue; } // released between the two calls
      if (holder && !alive(holder)) { rmSync(p, { force: true }); continue; } // a dead sync's lock
      if (Date.now() > deadline) throw new Error(`ztrack sync hermes: another sync (pid ${holder || '?'}) has held this board file for two minutes (${p}).`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try { return await fn(); } finally { rmSync(p, { force: true }); }
}

/** Sync one board file with its board. */
export async function syncHermes(opts: HermesSyncOpts): Promise<HermesSyncResult> {
  const abs = isAbsolute(opts.file) ? opts.file : resolve(opts.projectRoot, opts.file);
  return withSyncLock(lockPath(opts.projectRoot, abs), () => syncHermesLocked(opts));
}

async function syncHermesLocked(opts: HermesSyncOpts): Promise<HermesSyncResult> {
  const preset = opts.preset;
  if (preset.name !== 'kanban' || !preset.serialize) {
    throw new Error(`ztrack sync hermes: the installed preset is '${preset.name}'; a board file needs the kanban preset (\`ztrack init --preset kanban\`).`);
  }
  const abs = isAbsolute(opts.file) ? opts.file : resolve(opts.projectRoot, opts.file);
  const bPath = basePath(opts.projectRoot, abs); // per file on disk: checkouts share the sync state dir
  // The base says what file and board last agreed on. With no file there is nothing to agree
  // with — a fresh checkout, a deleted file — so the sync starts over from the board instead of
  // reading every card as a deleted section.
  const base = existsSync(abs) ? loadBase(bPath) : {};
  const writer = boardWriter(opts.exec);
  const dry = !!opts.dryRun;
  const res: HermesSyncResult = { pulled: [], pushed: [], created: [], recreated: [], archived: [], refused: [], actions: [] };

  const before = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  const { cards: localCards, preamble } = readFile(abs, preset, true);
  const view = viewOf(await readBoard(opts.exec), preset);
  const remote = new Map(view.cards.map((c) => [c.id, c]));

  // Every board write is one verb. A refused write never strands the sync half-applied: it is
  // reported, and the file is rendered from the board as it actually stands.
  const act = async (label: string, fn: () => Promise<unknown>): Promise<string | null> => {
    res.actions.push(label);
    if (dry) return null;
    try { await fn(); return null; } catch (e) {
      const why = (e as Error).message.replace(/^supercode workflow \S+: /, '').replace(/^Error: /, '').split('\n')[0]!;
      res.refused.push(`${label}: ${why}`);
      return why;
    }
  };

  // Subtasks filed on the board without a task id get their arc's next free one, in their title.
  for (const [s, arc] of view.unnamed) {
    const taken = [...(view.subtaskIds.get(arc.id)?.keys() ?? []), ...(localCards.find((c) => c.id === toFileId(arc.id))?.acceptanceCriteria.map((t) => t.id) ?? [])];
    const id = `c${taken.filter((t) => /^c\d+$/.test(t)).reduce((m, t) => Math.max(m, taskNumber(t)), 0) + 1}`;
    if (!view.subtaskIds.has(arc.id)) view.subtaskIds.set(arc.id, new Map());
    view.subtaskIds.get(arc.id)!.set(id, s.id);
    await act(`name ${toFileId(s.id)} as ${toFileId(arc.id)}:${id}`, () => writer.specify(s.id, { title: `${id} ${s.title}` }));
  }

  // Provisional ids (a section whose id isn't a board id) are new cards; map them as they're made.
  const idMap = new Map<string, string>();
  for (const c of localCards) if (FILE_ID.test(c.id)) idMap.set(c.id, toBoardId(c.id));
  const localById = new Map(localCards.map((c) => [c.id, c]));
  const unparsedOf = new Map<string, string[]>();     // board id -> task-section lines kept verbatim
  const sourcesOf = new Map<string, Map<string, TaskSource[]>>(); // board id -> its tasks' sources, kept from the file
  const orphans: FileCard[] = [];                     // sections kept in the file with no card behind them

  // A task ref (`t-…:c2` or `t-…`) as the board card it names, once it exists.
  const cardOfRef = (ref: string): string | null => {
    const [card, task] = ref.split(':');
    const arc = idMap.get(card!) ?? toBoardId(card!);
    return task ? view.subtaskIds.get(arc)?.get(task) ?? null : arc;
  };

  // A card's tasks, file side against board side against base, each by id: a task only the board
  // changed is left to come back; anything the file changed goes to the subtask.
  const pending: Array<() => Promise<void>> = []; // task links, once every task of every card exists
  const syncTasks = async (arc: string, fileId: string, L: Task[], R: Task[], B: Task[] | undefined): Promise<void> => {
    const r = new Map(R.map((t) => [t.id, t]));
    const b = new Map((B ?? []).map((t) => [t.id, t]));
    const ids = view.subtaskIds.get(arc) ?? new Map<string, string>();
    view.subtaskIds.set(arc, ids);
    for (const t of L) {
      const rt = r.get(t.id);
      const bt = b.get(t.id);
      if (same(t, rt) || (bt && same(t, bt))) continue;
      const label = `${fileId}:${t.id}`;
      let sub = ids.get(t.id) ?? null;
      if (!rt) {
        const made = { id: '' };
        const why = await act(`create ${label} "${t.text}"`, async () => { made.id = await writer.create({ title: `${t.id} ${t.text}`, body: withLines('', t.lines), parents: [], subtaskOf: arc }); });
        if (why || dry) continue;
        sub = made.id;
        ids.set(t.id, sub);
        res.created.push(label);
      } else if (rt.text !== t.text) await act(`retitle ${label}`, () => writer.specify(sub!, { title: `${t.id} ${t.text}` }));
      // its acceptance lines go to its text before any move, so a close sees them checked
      if (rt && !same(rt.lines, t.lines)) await act(`lines ${label}`, () => writer.specify(sub!, { body: withLines(view.bodies.get(sub!) ?? '', t.lines) }));
      if ((rt?.status ?? 'pending') !== t.status) {
        const to = t.status === 'passed' ? 'done' : 'ready';
        const why = await act(`${to} ${label}`, () => writer.goto(sub!, to));
        if (why && to === 'ready') await act(`todo ${label}`, () => writer.goto(sub!, 'todo'));
      }
      const had = rt?.blockedBy ?? [];
      if (!same(had, t.blockedBy)) {
        pending.push(async () => {
          for (const ref of t.blockedBy.filter((x) => !had.includes(x))) {
            const p = cardOfRef(ref);
            if (p) await act(`link ${ref} -> ${label}`, () => writer.link(p, sub!));
            else res.refused.push(`link ${ref} -> ${label}: no such task on the board`);
          }
          for (const ref of had.filter((x) => !t.blockedBy.includes(x))) {
            const p = cardOfRef(ref);
            if (p) await act(`unlink ${ref} -> ${label}`, () => writer.unlink(p, sub!));
          }
        });
      }
    }
    // a task gone from the file that the board did not change since: its subtask is archived
    for (const rt of R) {
      if (L.some((t) => t.id === rt.id)) continue;
      const bt = b.get(rt.id);
      if (bt && same(rt, bt)) await act(`archive ${fileId}:${rt.id}`, () => writer.archive(ids.get(rt.id)!));
    }
  };

  const textOf = (fileId: string, s: Snap) => cardText(preset, fileId, s);

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
      newId = await writer.create({ title: s.title, body: textOf(c.id, s), assignee: s.assignee, parents: s.parents, workspace: s.workspace, branch: s.branch, priority: s.priority, machine: s.machine });
    });
    if (failed) { orphans.push(c); return; }
    idMap.set(c.id, newId);
    const fid = dry ? c.id : toFileId(newId);
    res.created.push(fid);
    if (c.unparsed?.length) unparsedOf.set(newId, c.unparsed);
    sourcesOf.set(newId, sourcesByTask(c));
    if (!dry) await syncTasks(newId, fid, s.tasks, [], undefined);
    if (s.status !== 'todo' && s.status !== 'ready') await act(`${s.status} ${fid}`, () => writer.goto(newId, s.status));
  };
  for (const c of fresh) await createOne(c, []);

  // 2. Cards on both sides: per field against the base; what the file changed goes to the board.
  const recreate = async (r: BoardCard, t: Snap, changed: Field[]): Promise<string | null> => {
    let newId = `(new for ${r.id})`;
    const failed = await act(`re-create ${toFileId(r.id)} (${changed.join(', ')} changed)`, async () => {
      newId = await writer.create({ title: t.title, body: textOf(toFileId(r.id), t), assignee: t.assignee, parents: t.parents, workspace: t.workspace, branch: t.branch, priority: t.priority, machine: t.machine });
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
      if (t.status !== 'todo' && t.status !== 'ready') await act(`${t.status} ${toFileId(newId)}`, () => writer.goto(newId, t.status));
    }
    idMap.set(toFileId(r.id), newId);
    res.recreated.push({ from: toFileId(r.id), to: dry ? '(new)' : toFileId(newId) });
    return null;
  };

  for (const local of localCards.filter((c) => FILE_ID.test(c.id))) {
    const hid = toBoardId(local.id);
    const r = remote.get(hid);
    const b = base[hid];
    const L = localSnap(local, idMap);
    if (!r) {
      // Gone from the board (archived or done there), or a subtask (shown as its card's task): the
      // file follows. A section for a card the board never had stays, and is reported until it is
      // removed.
      if (b || view.ids.has(hid)) { res.pulled.push(local.id); continue; }
      res.refused.push(`${local.id}: no such card on the board (remove the section, or give it a new id to create one)`);
      orphans.push(local);
      continue;
    }
    if (local.unparsed?.length) unparsedOf.set(hid, local.unparsed);
    sourcesOf.set(hid, sourcesByTask(local));
    const R = view.snap(r);
    // what the file changed since the base goes to the board (with no base, all of it)
    const pushFields = FIELDS.filter((f) => !same(L[f], R[f]) && !(b && same(L[f], b[f])));
    if (pushFields.length) res.pushed.push(local.id);
    let recreateFields = pushFields.filter((f) => CREATION_FIELDS.includes(f));
    if (recreateFields.length && (r.status === 'running' || R.tasks.length)) {
      for (const f of recreateFields) res.refused.push(`${f} ${local.id}: ${r.status === 'running' ? 'the card is running' : 'the card has subtasks'}; a re-created card would leave them`);
      recreateFields = [];
    }
    if (recreateFields.length) {
      const why = await recreate(r, { ...R, ...Object.fromEntries(pushFields.map((f) => [f, L[f]])) } as Snap, recreateFields);
      if (!why) continue;
    }
    const push = new Set(pushFields);
    if (push.has('title') || push.has('body') || push.has('session')) {
      await act(`edit ${local.id}`, () => writer.specify(hid, { ...(push.has('title') ? { title: L.title } : {}), ...(push.has('body') || push.has('session') ? { body: textOf(local.id, L) } : {}) }));
    }
    if (push.has('assignee')) await act(`assign ${local.id} ${L.assignee ?? 'none'}`, () => writer.assign(hid, L.assignee));
    if (push.has('machine')) await act(`move ${local.id} ${L.machine ?? 'none'}`, () => writer.move(hid, L.machine));
    if (push.has('parents')) {
      for (const p of L.parents.filter((x) => !R.parents.includes(x))) await act(`link ${toFileId(p)} -> ${local.id}`, () => writer.link(p, hid));
      for (const p of R.parents.filter((x) => !L.parents.includes(x))) await act(`unlink ${toFileId(p)} -> ${local.id}`, () => writer.unlink(p, hid));
    }
    if (push.has('tasks')) await syncTasks(hid, local.id, L.tasks, R.tasks, b?.tasks);
    if (push.has('status')) await act(`${L.status} ${local.id}`, () => writer.goto(hid, L.status));
    if (FIELDS.some((f) => !same(L[f], R[f]) && !push.has(f))) res.pulled.push(local.id);
  }
  for (const link of pending) await link();

  // 3. Board cards with no section: new on the board (pull), or a section the file dropped (archive).
  for (const r of remote.values()) {
    const fid = toFileId(r.id);
    if (localById.has(fid) || r.status === 'done') continue; // a done card isn't in the file: absent is not deleted
    const b = base[r.id];
    if (!b) { res.pulled.push(fid); continue; }
    if (FIELDS.every((f) => same(view.snap(r)[f], b[f]))) {
      const why = await act(`archive ${fid} (section removed from ${opts.file})`, () => writer.archive(r.id));
      if (!why) res.archived.push(fid);
    } else res.pulled.push(fid); // changed on the board since: the section returns
  }

  if (dry) return res;

  // 4. The board as it now stands, rendered whole; the base is what it rendered.
  const after = viewOf(await readBoard(opts.exec), preset);
  const shown = after.cards.filter((c) => c.status !== 'done');
  const expected = new Map(shown.map((c) => [toFileId(c.id), after.snap(c)]));
  const rendered = shown
    .map((c) => toFileCard(c, expected.get(toFileId(c.id))!, unparsedOf.get(c.id), sourcesOf.get(c.id)))
    .sort((a, b) => (laneRank(a.status) - laneRank(b.status)) || ((after.cards.find((c) => toFileId(c.id) === a.id)?.createdAt ?? 0) - (after.cards.find((c) => toFileId(c.id) === b.id)?.createdAt ?? 0)));
  const text = renderFile(preset, preamble || DEFAULT_PREAMBLE, [...rendered, ...orphans]);

  // The file must read back as exactly the board it was rendered from, or the next sync would
  // take the difference for an edit and write it to the board. Render to a sibling, read it back
  // through the same parser, compare every card, then move it into place.
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.ztrack-sync`;
  writeFileSync(tmp, text);
  try {
    const back = readFile(tmp, preset).cards;
    const drift = back.flatMap((c) => {
      const want = expected.get(c.id);
      return want ? FIELDS.filter((f) => !same(localSnap(c, new Map())[f], want[f])).map((f) => `${c.id} ${f}`) : [];
    });
    if (drift.length) throw new Error(`ztrack sync hermes: the rendered file does not read back as the board (${drift.slice(0, 5).join('; ')}); ${opts.file} was left as it was. This is a ztrack defect: report it with the card's section.`);
    const now = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (now !== before) throw new Error(`ztrack sync hermes: ${opts.file} changed while syncing; the board has the changes that were read before it did. Run the sync again.`);
    // Unchanged text is not rewritten: a watcher on the file would take the write for an edit.
    if (text !== before) renameSync(tmp, abs);
  } finally {
    if (existsSync(tmp)) rmSync(tmp);
  }

  saveBase(bPath, Object.fromEntries(shown.map((c) => [c.id, after.snap(c)])));
  return res;
}

const DEFAULT_PREAMBLE = [
  'The arc board: one `## <card id> — <title>` section per open card, each task a subtask. Edit it and',
  'the board follows (`ztrack sync hermes --watch`). A new section makes a card; a deleted one archives it. Grammar: docs/SYNC-HERMES.md in ztrack.',
].join('\n');
