// An evidence-free kanban preset: each issue is a CARD on a board whose lanes are its workflow's
// statuses. A card is its story: its context (prose), its ACCEPTANCE (outcomes, each ticked with one
// pointer to where it was seen), and its TASKS (the working session's plan: one line each, with ids,
// ticked when done, optionally blocked by other tasks or cards). There is no evidence record and no
// comment thread. Written for a board
// kept as ONE document-source markdown file (docs/SOURCES.md), optionally backed by a kanban through
// `ztrack sync hermes` (docs/SYNC-HERMES.md), where each task is a subtask card, but it validates
// any card file on its own.
//
// One card, as the document presents it to this preset (the `status:`/`assignee:` header block
// and the `## <id> — <title>` heading are the document grammar's; everything below is this
// preset's, level-shifted so the card's `### Tasks` reads as `## Tasks` here):
//
//   Blocked by: t-954aa1da                  optional: cards that must be done first
//   Blocked by: m-f17fd1c2                  message waits share the blocking relation
//   Paused: sc:host:codex:session — waiting for owner
//   Every: 2h                              recurring role runs
//   Workspace: worktree:volter-ai/editor    optional: scratch | worktree:<repository> | dir:<repository>
//   Branch: wt/t6-wire                      optional
//   Priority: 2                             optional integer
//   Machine: aarons-mac-mini                optional
//
//   What stands: the card's context, verbatim. A line of it that starts with `#` is
//   written `\#` so it can never read as a heading, and a first line that starts like a
//   metadata key is written `\Key:` so it can never read as metadata.
//
//   ## Acceptance
//
//   - [ ] the Stoneguard Bridge scene loads in the editor
//   - [x] a person has seen it working: request_afcaef03, answered 11:21:25Z
//
//   ## Tasks
//
//   - [ ] c1 merge the lowering lane
//   - [x] c2 studio lights fix on main
//   - [ ] c3 release
//     - blocked-by: c1, t-954aa1da:c2
//     - [ ] a person has seen it working       an acceptance line; checked: `- [x] <line>: <evidence>`
//   - [x] c4 the owner's words are the source of this task
//     - source: u-63f732c036792fc8462474ae "supercode inbox can be a source cited by ztrack"
//
// The metadata block is the body's leading paragraphs made wholly of the keys above; anything
// else is the prose. A task is `- [ ] <id> <text>`: the id is `c<N>` (or another letter prefix and
// number, `s1`), and a task written without one gets the next free `c<N>` of its card. `blocked-by` names tasks
// (`c1` in this card, `<card>:<task>` in another) or whole cards.
//
// A `source` names the message a task came from, by its supercode mailbox id (a line a person
// typed, `u-…`; mail from a session, a Room or a channel, `m-…`; a session's answer, `a-…`), with
// an optional quote of its words. `check` asks supercode for each cited message
// (`supercode message show`): an id no mailbox on this machine holds, or a quote not in the
// message's words, is an error. A source is where a task came from, not proof it is done; ticking
// a task still takes no evidence.

// A STANDALONE preset: imports ONLY the public mechanism from `@volter/ztrack/preset-kit`.
import {
  z, check as runCheck, rule, formatRef, BlockRefSchema, normalizeBlockRefs, parseBlockToken,
  supercodeMessages, quoteIn, SUPERCODE_SERVICE, type PresetContextInput,
  type BlockRef, type Context, type IssueColumns, type IssueRecord, type Preset, type RawBlockRef, type VisualizerSpec,
} from '@volter/ztrack/preset-kit';

// ── the hard schema (core + preset-specific, all strict) ─────────────────────────────────────
// A lane is a status of the board's workflow (Hermes's nine, or the ones a supercode board's workflow
// declares, such as `stopped` or `reviewing`): a lowercase name. `archived` is a lane too: a card
// moved there leaves the board.
export const KanbanStatusSchema = z.string().regex(/^[a-z][a-z_]*$/);

// A task is the core's AC shape (so the engine's blocking graph covers it) with no evidence:
// `passed` is a ticked task, `pending` an open one.
export const KanbanTaskSchema = z.object({
  id: z.string().regex(/^[a-z]+\d+$/),                   // core: `c3`, or any letter prefix and number (`s1`)
  status: z.enum(['pending', 'passed']),                 // core
  evidence: z.array(z.never()),                          // core: a task carries no evidence, ever
  text: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  blockedBy: z.array(BlockRefSchema).optional(),         // primitive
  /** The message whose answer the task waits for (`  - waiting-on: m-…`). */
  waitingOn: z.string().regex(/^[ma]-[0-9a-f]{6,}$/).optional(), // primitive
  sources: z.array(z.object({ id: z.string().regex(/^[a-z]-[0-9a-f]+$/), quote: z.string().min(1).optional() }).strict()).optional(),
  /** The task's acceptance lines (`  - [ ] <criterion>` under it), each checked off with its evidence on the line. */
  lines: z.array(z.object({ checked: z.boolean(), text: z.string().min(1) }).strict()).optional(),
}).strict();

export const KanbanRelationSchema = z.object({ type: z.literal('blocked-by'), issueId: z.string().min(1) }).strict();

export const KanbanCardSchema = z.object({
  id: z.string().min(1),                                 // core
  title: z.string().min(1),                              // core
  summary: z.string(),                                   // core (unused: the opening post is `body`)
  status: KanbanStatusSchema,                            // core (a lane name)
  acceptanceCriteria: z.array(KanbanTaskSchema),         // core: the card's tasks (the session's plan)
  /** The card's acceptance criteria: outcomes, each ticked with one pointer to where it was seen (`- [x] <outcome>: <pointer>`). */
  acceptance: z.array(z.object({ checked: z.boolean(), text: z.string().min(1) }).strict()).optional(),
  assignee: z.string().min(1).optional(),
  relations: z.array(KanbanRelationSchema).optional(),   // primitive: `Blocked by:`
  workspace: z.string().regex(/^(scratch|worktree|worktree:.+|dir:.+)$/).optional(),
  branch: z.string().min(1).optional(),
  priority: z.number().int().optional(),
  /** The board's open run: a worker's claim and the session it names. Written by the board's
   *  dispatcher, never by the file (a sync overwrites it). */
  run: z.string().min(1).optional(),
  machine: z.string().min(1).optional(),
  session: z.string().min(1).optional(),
  /** The message (m-… or a-…) whose answer the card's block waits for; the board unblocks it when one lands. */
  waitingOn: z.string().regex(/^[ma]-[0-9a-f]{6,}$/).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  paused: z.object({ by: z.string().min(1), reason: z.string().min(1) }).strict().optional(),
  every: z.string().regex(/^[1-9]\d*(?:\.\d+)?\s*(?:s|m|h|d|w)?$/).optional(),
  body: z.string(),
  /** Lines under Tasks that are not a task; kept verbatim and reported by `kanban_line_unparsed`. */
  unparsed: z.array(z.string()).min(1).optional(),
}).strict();

export const KanbanRootSchema = z.object({ issues: z.array(KanbanCardSchema) }).strict();
export type KanbanRoot = z.infer<typeof KanbanRootSchema>;
export type KanbanCard = KanbanRoot['issues'][number];

// ── parse: one card's record -> the schema shape (line grammar, no prose mining) ─────────────
const META_KEYS: Record<string, string> = {
  'blocked by': 'blockedBy', workspace: 'workspace', branch: 'branch', priority: 'priority',
  run: 'run', machine: 'machine', session: 'session', 'waiting on': 'waitingOn', paused: 'paused', every: 'every', metadata: 'metadata',
};
const META_LINE = /^(Blocked by|Waiting on|Workspace|Worktree path|Branch|Priority|Run|Machine|Session|Paused|Every|Metadata):\s*(.*)$/i;
const TASKS_HEADING = /^##\s+Tasks\s*$/i;
const ACCEPTANCE_HEADING = /^##\s+Acceptance\s*$/i;
const OUTCOME_LINE = /^[-*] \[( |x|X)\]\s+(.+)$/;
// The escape a body line carries so it can't read as a heading or as a metadata line.
const ESCAPED = /^\\(?=#|(?:Blocked by|Waiting on|Workspace|Worktree path|Branch|Priority|Run|Machine|Session|Paused|Every|Metadata):)/i;
const TASK_LINE = /^[-*] \[( |x|X)\]\s+(?:([a-z]+\d+)\s+)?(.+)$/;
const BLOCKED_LINE = /^\s{2,}[-*] blocked-by:\s*(.+)$/i;
const WAITING_LINE = /^\s{2,}[-*] waiting-on:\s*(\S+)\s*$/i;
const SOURCE_LINE = /^\s{2,}[-*] source:\s*(\S+)(?:\s+"(.*)")?\s*$/i;
const CRITERION_LINE = /^\s{2,}[-*] \[( |x|X)\]\s+(.+)$/;

const splitList = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const trimBlankLines = (lines: string[]) => {
  let a = 0; let b = lines.length;
  while (a < b && lines[a]!.trim() === '') a++;
  while (b > a && lines[b - 1]!.trim() === '') b--;
  return lines.slice(a, b);
};

type TaskSource = { id: string; quote?: string };
type TaskLine = { checked: boolean; text: string };
type ParsedTask = { metadata?: Record<string, unknown>; id: string; status: 'pending' | 'passed'; evidence: never[]; text: string; blockedBy?: RawBlockRef[]; waitingOn?: string; sources?: TaskSource[]; lines?: TaskLine[] };

function parseTasks(cardId: string, lines: string[]): { tasks: ParsedTask[]; unparsed: string[] } {
  const tasks: ParsedTask[] = [];
  const unparsed: string[] = [];
  const unnamed: ParsedTask[] = [];
  for (const line of lines) {
    const t = TASK_LINE.exec(line);
    if (t) {
      const task: ParsedTask = { id: t[2] ?? '', status: t[1] === ' ' ? 'pending' : 'passed', evidence: [], text: t[3]!.trim() };
      tasks.push(task);
      if (!task.id) unnamed.push(task);
      continue;
    }
    const metadata = /^\s{2,}[-*] metadata:\s*(.+)$/.exec(line);
    if (metadata && tasks.length) { tasks[tasks.length - 1]!.metadata = JSON.parse(metadata[1]!); continue; }
    const b = BLOCKED_LINE.exec(line);
    if (b && tasks.length) {
      const last = tasks[tasks.length - 1]!;
      last.blockedBy = [...(last.blockedBy ?? []), ...splitList(b[1]!).map((tok) => parseBlockToken(tok, cardId)).filter((r): r is RawBlockRef => r !== null)];
      continue;
    }
    const w = WAITING_LINE.exec(line);
    if (w && tasks.length) {
      tasks[tasks.length - 1]!.waitingOn = w[1]!;
      continue;
    }
    const crit = CRITERION_LINE.exec(line);
    if (crit && tasks.length) {
      const last = tasks[tasks.length - 1]!;
      last.lines = [...(last.lines ?? []), { checked: crit[1] !== ' ', text: crit[2]!.trim() }];
      continue;
    }
    const src = SOURCE_LINE.exec(line);
    if (src && tasks.length) {
      const last = tasks[tasks.length - 1]!;
      last.sources = [...(last.sources ?? []), { id: src[1]!, ...(src[2] ? { quote: src[2] } : {}) }];
      continue;
    }
    if (line.trim() !== '') unparsed.push(line);
  }
  // A task written without an id takes the card's next free `c<N>`, in line order.
  let next = tasks.reduce((m, t) => Math.max(m, /^c\d+$/.test(t.id) ? Number(t.id.slice(1)) : 0), 0);
  for (const t of unnamed) t.id = `c${++next}`;
  return { tasks, unparsed };
}

function parseCard(record: IssueRecord): Record<string, unknown> {
  const lines = record.body.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => TASKS_HEADING.test(l));
  const acc = lines.findIndex((l) => ACCEPTANCE_HEADING.test(l));
  // the prose runs to the first of the card's two sections; Acceptance runs to Tasks (or the end), Tasks to the end
  const firstSection = [at, acc].filter((i) => i >= 0).reduce((m, i) => Math.min(m, i), lines.length);
  const head = lines.slice(0, firstSection);
  const tail = at < 0 ? [] : lines.slice(at + 1, acc > at ? acc : lines.length);
  const outcomeLines = acc < 0 ? [] : lines.slice(acc + 1, at > acc ? at : lines.length);
  const acceptance: Array<{ checked: boolean; text: string }> = [];
  const accUnparsed: string[] = [];
  for (const l of outcomeLines) {
    const m = OUTCOME_LINE.exec(l);
    if (m) acceptance.push({ checked: m[1] !== ' ', text: m[2]!.trim() });
    else if (l.trim() !== '') accUnparsed.push(l);
  }

  // The metadata block: the leading paragraphs made wholly of metadata lines (written as one
  // paragraph, read from several, so a blank line inside the block loses nothing).
  const content = trimBlankLines(head);
  const meta: Record<string, string> = {};
  let at2 = 0;
  for (;;) {
    let end = content.slice(at2).findIndex((l) => l.trim() === '');
    end = end < 0 ? content.length : at2 + end;
    const para = content.slice(at2, end);
    if (!para.length || !para.every((l) => META_LINE.test(l))) break;
    for (const l of para) { const m = META_LINE.exec(l)!; meta[META_KEYS[m[1]!.toLowerCase()]!] = m[2]!.trim(); }
    at2 = end;
    while (at2 < content.length && content[at2]!.trim() === '') at2++;
  }
  const bodyLines = trimBlankLines(content.slice(at2)).map((l) => l.replace(ESCAPED, ''));

  const { tasks, unparsed: taskUnparsed } = parseTasks(record.id, tail);
  const unparsed = [...accUnparsed, ...taskUnparsed];
  const card: Record<string, unknown> = {
    id: record.id,
    title: record.title,
    summary: '',
    // A document item with no `status:` line reads as `draft`; on a board that is a card not yet
    // started — `todo`.
    status: !record.status || record.status === 'draft' ? 'todo' : record.status,
    acceptanceCriteria: tasks,
    body: bodyLines.join('\n'),
  };
  if (acceptance.length) card.acceptance = acceptance;
  if (record.assignee) card.assignee = record.assignee;
  const blockers = [...new Set([...splitList(meta.blockedBy ?? ''), ...splitList(meta.waitingOn ?? '')])];
  if (blockers.length) card.relations = blockers.map((issueId) => ({ type: 'blocked-by', issueId }));
  for (const k of ['workspace', 'branch', 'machine', 'every'] as const) if (meta[k]) card[k] = meta[k];
  if (meta.metadata) card.metadata = JSON.parse(meta.metadata);
  if (meta.paused) {
    const pause = /^(.+?)\s+—\s+(.+)$/.exec(meta.paused);
    card.paused = pause ? { by: pause[1], reason: pause[2] } : { by: '', reason: meta.paused };
  }
  if (meta.priority) card.priority = /^-?\d+$/.test(meta.priority) ? Number(meta.priority) : meta.priority;
  if (unparsed.length) card.unparsed = unparsed;
  return card;
}

export function parseKanban(records: IssueRecord[]): unknown {
  const issues = records.map(parseCard);
  // Bare task refs resolve now that every card and task is known: a task of this card, else a card.
  normalizeBlockRefs(issues as unknown as Parameters<typeof normalizeBlockRefs>[0]);
  return { issues };
}

// ── serialize: the validated card -> its STORED form (content body + metadata columns) ───────
export function serializeKanbanCard(card: KanbanCard): { body: string; columns: IssueColumns } {
  const out: string[] = [];
  const blockers = [...new Set([...(card.relations ?? []).map((r) => r.issueId), ...(card.waitingOn ? [card.waitingOn] : [])])];
  if (blockers.length) out.push(`Blocked by: ${blockers.join(', ')}`);
  if (card.metadata && Object.keys(card.metadata).length) out.push(`Metadata: ${JSON.stringify(card.metadata)}`);
  if (card.paused) out.push(`Paused: ${card.paused.by} — ${card.paused.reason}`);
  if (card.every) out.push(`Every: ${card.every}`);
  if (card.workspace) out.push(`Workspace: ${card.workspace}`);
  if (card.branch) out.push(`Branch: ${card.branch}`);
  if (card.priority !== undefined) out.push(`Priority: ${card.priority}`);
  if (card.machine) out.push(`Machine: ${card.machine}`);
  if (card.body) {
    if (out.length) out.push('');
    out.push(...card.body.split('\n').map((l, i) => (/^\s{0,3}#/.test(l) ? `\\${l.trimStart()}` : i === 0 && META_LINE.test(l) ? `\\${l}` : l)));
  }
  if (card.acceptance?.length) {
    if (out.length) out.push('');
    out.push('## Acceptance', '');
    for (const o of card.acceptance) out.push(`- [${o.checked ? 'x' : ' '}] ${o.text}`);
  }
  if (card.acceptanceCriteria.length || card.unparsed?.length) {
    if (out.length) out.push('');
    out.push('## Tasks', '');
    // a ref into this card is written bare (`c1`), anything else in full (`t-…:c2`, `t-…`)
    const renderRef = (r: BlockRef) => (r.ac !== undefined && r.issue === card.id ? r.ac : formatRef(r));
    for (const t of card.acceptanceCriteria) {
      out.push(`- [${t.status === 'passed' ? 'x' : ' '}] ${t.id} ${t.text}`);
      if (t.metadata && Object.keys(t.metadata).length) out.push(`  - metadata: ${JSON.stringify(t.metadata)}`);
      if (t.blockedBy?.length) out.push(`  - blocked-by: ${t.blockedBy.map(renderRef).join(', ')}`);
      if (t.waitingOn) out.push(`  - waiting-on: ${t.waitingOn}`);
      for (const src of t.sources ?? []) out.push(`  - source: ${src.id}${src.quote ? ` "${src.quote}"` : ''}`);
      for (const l of t.lines ?? []) out.push(`  - [${l.checked ? 'x' : ' '}] ${l.text}`);
    }
    out.push(...(card.unparsed ?? []));
  }
  return {
    body: out.length ? `${out.join('\n')}\n` : '',
    columns: { title: card.title, status: card.status, ...(card.assignee ? { assignee: card.assignee } : {}) },
  };
}

// ── rules: declarative records over the engine's derived model ───────────────────────────────
type Relation = NonNullable<KanbanCard['relations']>[number];

const KANBAN_RULES = [
  rule<KanbanRoot, { issueId: string }>({
    code: 'duplicate_issue_id', select: (m) => m.duplicateIssueIds,
    message: ({ issueId }) => `Card ${issueId} appears more than once.`,
  }),
  rule<KanbanRoot, { issueId: string; acId: string }>({
    code: 'duplicate_task_id', select: (m) => m.duplicateAcIds,
    message: ({ issueId, acId }) => `Card ${issueId} has two tasks ${acId}.`,
  }),
  rule<KanbanRoot, { issueId: string; target: string }>({
    code: 'card_blocker_missing',
    select: (m) => {
      const ids = new Set(m.root.issues.map((i) => i.id));
      return m.root.issues.flatMap((i) => (i.relations ?? []).filter((r: Relation) => !/^[ma]-[0-9a-f]{6,}$/.test(r.issueId) && !ids.has(r.issueId)).map((r: Relation) => ({ issueId: i.id, target: r.issueId })));
    },
    message: ({ issueId, target }) => `Card ${issueId} is blocked by ${target}, which is not on the board.`,
  }),
  rule<KanbanRoot, { issueId: string; acId?: string; kind: string; refText: string }>({
    code: 'task_blocker_missing', select: (m) => m.graph.blockerProblems.filter((r) => !/^[ma]-[0-9a-f]{6,}$/.test(r.refText)),
    message: ({ issueId, acId, kind, refText }) => kind === 'self'
      ? `Task ${issueId}:${acId} is blocked by itself.`
      : `Task ${issueId}:${acId} is blocked by ${refText}, which is not on the board.`,
  }),
  rule<KanbanRoot, { issueId: string; cycle: string[] }>({
    code: 'card_block_cycle', select: (m) => m.graph.cycles,
    message: ({ cycle }) => `Cards or tasks block each other in a loop: ${cycle.join(' -> ')}.`,
  }),
  rule<KanbanRoot, { issueId: string; nodeKey: string; depKey: string }>({
    code: 'done_before_blocker', severity: 'warning', select: (m) => m.graph.completionViolations,
    message: ({ nodeKey, depKey }) => `${nodeKey} is done but ${depKey}, which blocks it, is not.`,
  }),
  rule<KanbanRoot, { issueId: string; line: string }>({
    code: 'card_header_unended',
    select: (m) => m.root.issues.flatMap((i) => {
      const first = i.body.split('\n')[0] ?? '';
      return /^(status|assignee):/i.test(first) ? [{ issueId: i.id, line: first }] : [];
    }),
    message: ({ issueId, line }) => `Card ${issueId}: "${line.trim()}" reads as prose, not as the card's lane or assignee — the \`status:\`/\`assignee:\` lines must be followed by a blank line.`,
  }),
  rule<KanbanRoot, { issueId: string; text: string }>({
    code: 'acceptance_tick_unpointed', severity: 'warning',
    select: (m) => m.root.issues.flatMap((i) => (i.acceptance ?? []).filter((o) => o.checked && !/:\s*\S/.test(o.text)).map((o) => ({ issueId: i.id, text: o.text }))),
    message: ({ issueId, text }) => `Card ${issueId}: the ticked outcome "${text}" names no pointer to where it was seen (\`- [x] <outcome>: <pointer>\`).`,
  }),
  rule<KanbanRoot, { issueId: string; line: string }>({
    code: 'kanban_line_unparsed',
    select: (m) => m.root.issues.flatMap((i) => (i.unparsed ?? []).map((line) => ({ issueId: i.id, line }))),
    message: ({ issueId, line }) => `Card ${issueId}: "${line.trim()}" under Tasks is not a task (\`- [ ] c<N> <text>\`, or its \`  - blocked-by:\` or \`  - source:\` line).`,
  }),
  rule<KanbanRoot, { issueId: string; acId: string; source: string; quote?: string; problem: 'not_found' | 'unreachable' | 'quote' }>({
    code: 'task_source_unverified',
    // Judged only where the messages were read (`check` loads them; a sync's parse does not).
    select: (m) => {
      if (!m.context.world) return [];
      const events = new Map((m.context.world.events ?? []).filter((e) => e.service === SUPERCODE_SERVICE).map((e) => [e.id, e]));
      type Problem = 'not_found' | 'unreachable' | 'quote';
      return m.root.issues.flatMap((i) => i.acceptanceCriteria.flatMap((t) => (t.sources ?? []).flatMap((src) => {
        const event = events.get(src.id);
        const problem: Problem | null = !event ? 'not_found'
          : event.type === 'unreachable' ? 'unreachable'
            : src.quote && !quoteIn(event.text ?? '', src.quote) ? 'quote' : null;
        return problem ? [{ issueId: i.id, acId: t.id, source: src.id, ...(src.quote ? { quote: src.quote } : {}), problem }] : [];
      })));
    },
    message: ({ issueId, acId, source, quote, problem }) => problem === 'not_found'
      ? `Task ${issueId}:${acId} cites ${source}, which no supercode mailbox on this machine holds (\`supercode message show ${source}\`).`
      : problem === 'unreachable'
        ? `Task ${issueId}:${acId} cites ${source}, but supercode could not be asked (\`supercode message show ${source}\`; SUPERCODE_BIN names another supercode).`
        : `Task ${issueId}:${acId} quotes ${source} as "${quote}", which is not in that message's words (\`supercode message show ${source}\`).`,
  }),
];

// The cited messages' ids: from the parsed root when there is one, else from the bundle's lines.
function citedSources(input: PresetContextInput): string[] {
  if (input.root) {
    return (input.root as unknown as KanbanRoot).issues.flatMap((i) => (i.acceptanceCriteria ?? []).flatMap((t) => (t.sources ?? []).map((src) => src.id)));
  }
  return [...(input.bundle ?? '').matchAll(/^\s{2,}[-*] source:\s*(\S+)/gim)].map((match) => match[1]!);
}

// ── the dashboard's vocabulary, as plain data ──────────────────────────────────────────────
const KANBAN_VISUALIZER: VisualizerSpec = {
  statusOrder: ['todo', 'running', 'review', 'done', 'cancelled'], // the common lanes, in board order
  acUnitLabel: 'Tasks',
  assignee: 'assignee',
  acText: { id: 'id', text: 'text' },
};

export const KanbanPreset: Preset<KanbanRoot> = {
  name: 'kanban',
  schema: KanbanRootSchema,
  visualizer: KANBAN_VISUALIZER,
  parse: parseKanban,
  serialize: serializeKanbanCard, // card -> { body, columns }; the inverse of parse
  rules: KANBAN_RULES,
  // this preset's observed facts: the messages its tasks cite, read from supercode's mailboxes.
  loadContext: (input) => {
    return { world: { events: supercodeMessages(citedSources(input)) } };
  },
  // a task-less card is done (for the block graph) in the done or archived lane; a card with
  // tasks, when every task is ticked. Cancelled is an end; archived is accepted on import.
  isIssueDone: (i) => i.status === 'done' || i.status === 'cancelled' || i.status === 'archived',
  primitives: { relations: true, blocking: true, labels: false, children: false, proof: false, sources: false, category: false },
  scaffold: (_title) => `Machine: <machine>\n\nWhat stands: the context, the owner's words with their sources, links to ADRs.\n\n## Acceptance\n\n- [ ] the first outcome\n\n## Tasks\n\n- [ ] c1 the first step of the plan\n`,
};

export function checkKanban(records: IssueRecord[], ctx?: Context) {
  return runCheck(KanbanPreset, records, ctx);
}

// The installed entrypoint: the resolver reads the preset off `default`.
export default KanbanPreset;
