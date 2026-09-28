// An evidence-free kanban preset: each issue is a CARD on a board whose lanes are the Hermes
// kanban's own statuses. There are no acceptance criteria and no evidence — a card's state is its
// lane, its dependencies, its opening post and its comment thread. Written for a board kept as
// ONE document-source markdown file (docs/SOURCES.md), optionally backed by a Hermes kanban
// through `ztrack sync hermes` (docs/SYNC-HERMES.md), but it validates any card file on its own.
//
// One card, as the document presents it to this preset (the `status:`/`assignee:` header block
// and the `## <id> — <title>` heading are the document grammar's; everything below is this
// preset's, level-shifted so the card's `### Comments` reads as `## Comments` here):
//
//   Blocked by: t-954aa1da, t-12ab34cd     optional: cards that must be done first
//   Workspace: dir:/Users/me/repo          optional: scratch | worktree | worktree:<path> | dir:<path>
//   Branch: wt/t6-wire                     optional
//   Priority: 2                            optional integer
//
//   The card's opening post, verbatim prose. A line of it that starts with `#` is written
//   `\#` so it can never read as a heading.
//
//   ## Comments
//
//   3 earlier comments: hermes kanban show t_65a8d101
//   - 2026-09-28 20:58:37Z default: a comment already on the board
//     a continuation line of the same comment
//   - a new comment (no stamp): posted by the next sync
//
// The metadata block is the body's FIRST paragraph and only when every line of it is one of the
// four keys above; anything else is the opening post.

// A STANDALONE preset: imports ONLY the public mechanism from `@volter/ztrack/preset-kit`.
import {
  z, check as runCheck, rule,
  type Context, type IssueColumns, type IssueRecord, type Preset, type VisualizerSpec,
} from '@volter/ztrack/preset-kit';

// ── the hard schema (core + preset-specific, all strict) ─────────────────────────────────────
// The lanes, in board order. `archived` is a lane too: a card moved there leaves the board.
export const KanbanStatusSchema = z.enum(['triage', 'todo', 'ready', 'running', 'review', 'blocked', 'scheduled', 'done', 'archived']);

export const KanbanCommentSchema = z.object({
  /** When the comment was posted, `YYYY-MM-DD HH:MM:SSZ` (UTC). Absent on a comment written in
   *  the file and not yet posted. */
  at: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z$/).optional(),
  author: z.string().min(1).optional(),
  text: z.string().min(1),
}).strict();

export const KanbanRelationSchema = z.object({ type: z.literal('blocked-by'), issueId: z.string().min(1) }).strict();

export const KanbanCardSchema = z.object({
  id: z.string().min(1),                                 // core
  title: z.string().min(1),                              // core
  summary: z.string(),                                   // core (unused: the opening post is `body`)
  status: KanbanStatusSchema,                            // core (narrowed to the lanes)
  acceptanceCriteria: z.array(z.never()),                // core: a card has no ACs, ever
  assignee: z.string().min(1).optional(),
  relations: z.array(KanbanRelationSchema).optional(),   // primitive: `Blocked by:`
  workspace: z.string().regex(/^(scratch|worktree|worktree:.+|dir:.+)$/).optional(),
  branch: z.string().min(1).optional(),
  priority: z.number().int().optional(),
  body: z.string(),
  comments: z.array(KanbanCommentSchema),
  /** How many older comments the file leaves out (the board keeps them). */
  earlierComments: z.number().int().nonnegative(),
  /** Where the full thread lives, as printed after the count. */
  earlierWhere: z.string().optional(),
  /** Lines under Comments that are neither a comment nor the earlier-count line; kept verbatim
   *  and reported by `kanban_line_unparsed`. */
  unparsed: z.array(z.string()).min(1).optional(),
}).strict();

export const KanbanRootSchema = z.object({ issues: z.array(KanbanCardSchema) }).strict();
export type KanbanRoot = z.infer<typeof KanbanRootSchema>;
export type KanbanCard = KanbanRoot['issues'][number];

// ── parse: one card's record -> the schema shape (line grammar, no prose mining) ─────────────
const META_LINE = /^(Blocked by|Workspace|Branch|Priority):\s*(.*)$/i;
const COMMENTS_HEADING = /^##\s+Comments\s*$/i;
const STAMPED = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z) ([^:\s][^:]*?): ([\s\S]*)$/;
const EARLIER = /^(\d+) earlier comments?(?::\s*(.*))?$/i;

const splitList = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const trimBlankLines = (lines: string[]) => {
  let a = 0; let b = lines.length;
  while (a < b && lines[a]!.trim() === '') a++;
  while (b > a && lines[b - 1]!.trim() === '') b--;
  return lines.slice(a, b);
};

function parseComments(lines: string[]): { comments: unknown[]; earlier: number; where?: string; unparsed: string[] } {
  const comments: Array<{ at?: string; author?: string; text: string }> = [];
  let earlier = 0; let where: string | undefined;
  const unparsed: string[] = [];
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    const raw = cur.join('\n').trim();
    cur = null;
    if (!raw) return;
    const m = STAMPED.exec(raw);
    comments.push(m ? { at: m[1]!, author: m[2]!.trim(), text: m[3]!.trim() || '(empty)' } : { text: raw });
  };
  for (const line of lines) {
    if (/^[-*] /.test(line)) { flush(); cur = [line.slice(2)]; continue; }
    if (cur && (/^ {2,}\S/.test(line) || line.trim() === '')) { cur.push(line.replace(/^ {2}/, '')); continue; }
    flush();
    if (line.trim() === '') continue;
    const e = EARLIER.exec(line.trim());
    if (e) { earlier = Number(e[1]); where = e[2]?.trim() || undefined; continue; }
    unparsed.push(line);
  }
  flush();
  return { comments, earlier, ...(where ? { where } : {}), unparsed };
}

function parseCard(record: IssueRecord): Record<string, unknown> {
  const lines = record.body.replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => COMMENTS_HEADING.test(l));
  const head = at < 0 ? lines : lines.slice(0, at);
  const tail = at < 0 ? [] : lines.slice(at + 1);

  // The metadata block: the first paragraph, iff every line of it is a metadata line.
  const content = trimBlankLines(head);
  let end = content.findIndex((l) => l.trim() === '');
  if (end < 0) end = content.length;
  const first = content.slice(0, end);
  const isMeta = first.length > 0 && first.every((l) => META_LINE.test(l));
  const meta: Record<string, string> = {};
  if (isMeta) for (const l of first) { const m = META_LINE.exec(l)!; meta[m[1]!.toLowerCase()] = m[2]!.trim(); }
  const bodyLines = trimBlankLines(isMeta ? content.slice(end) : content).map((l) => l.replace(/^\\#/, '#'));

  const card: Record<string, unknown> = {
    id: record.id,
    title: record.title,
    summary: '',
    // A document item with no `status:` line reads as `draft`; on a board that is a card not yet
    // started — `todo`.
    status: !record.status || record.status === 'draft' ? 'todo' : record.status,
    acceptanceCriteria: [],
    body: bodyLines.join('\n'),
  };
  if (record.assignee) card.assignee = record.assignee;
  const blockers = splitList(meta['blocked by'] ?? '');
  if (blockers.length) card.relations = blockers.map((issueId) => ({ type: 'blocked-by', issueId }));
  if (meta.workspace) card.workspace = meta.workspace;
  if (meta.branch) card.branch = meta.branch;
  if (meta.priority !== undefined && meta.priority !== '') card.priority = /^-?\d+$/.test(meta.priority) ? Number(meta.priority) : meta.priority;
  const c = parseComments(tail);
  card.comments = c.comments;
  card.earlierComments = c.earlier;
  if (c.where) card.earlierWhere = c.where;
  if (c.unparsed.length) card.unparsed = c.unparsed;
  return card;
}

export function parseKanban(records: IssueRecord[]): unknown {
  return { issues: records.map(parseCard) };
}

// ── serialize: the validated card -> its STORED form (content body + metadata columns) ───────
export function serializeKanbanCard(card: KanbanCard): { body: string; columns: IssueColumns } {
  const out: string[] = [];
  const blockers = (card.relations ?? []).map((r) => r.issueId);
  if (blockers.length) out.push(`Blocked by: ${blockers.join(', ')}`);
  if (card.workspace) out.push(`Workspace: ${card.workspace}`);
  if (card.branch) out.push(`Branch: ${card.branch}`);
  if (card.priority !== undefined) out.push(`Priority: ${card.priority}`);
  if (card.body) {
    if (out.length) out.push('');
    out.push(...card.body.split('\n').map((l) => (/^\s{0,3}#/.test(l) ? `\\${l.trimStart()}` : l)));
  }
  if (card.comments.length || card.earlierComments) {
    if (out.length) out.push('');
    out.push('## Comments', '');
    if (card.earlierComments) out.push(`${card.earlierComments} earlier comment${card.earlierComments === 1 ? '' : 's'}${card.earlierWhere ? `: ${card.earlierWhere}` : ''}`);
    for (const cm of card.comments) {
      const [firstLine, ...rest] = cm.text.split('\n');
      out.push(`- ${cm.at ? `${cm.at} ${cm.author ?? 'unknown'}: ` : ''}${firstLine}`);
      for (const r of rest) out.push(r.trim() === '' ? '' : `  ${r}`);
    }
  }
  if (card.unparsed?.length) {
    if (!card.comments.length && !card.earlierComments) { if (out.length) out.push(''); out.push('## Comments', ''); }
    out.push(...card.unparsed);
  }
  return {
    body: out.length ? `${out.join('\n')}\n` : '',
    columns: { title: card.title, status: card.status, ...(card.assignee ? { assignee: card.assignee } : {}) },
  };
}

// ── rules: declarative records over the engine's derived model ───────────────────────────────
type Relation = NonNullable<KanbanCard['relations']>[number];
interface RelationFact { issueId: string; target: string }

const KANBAN_RULES = [
  rule<KanbanRoot, { issueId: string }>({
    code: 'duplicate_issue_id', select: (m) => m.duplicateIssueIds,
    message: ({ issueId }) => `Card ${issueId} appears more than once.`,
  }),
  rule<KanbanRoot, RelationFact>({
    code: 'card_blocker_missing',
    select: (m) => {
      const ids = new Set(m.root.issues.map((i) => i.id));
      return m.root.issues.flatMap((i) => (i.relations ?? []).filter((r: Relation) => !ids.has(r.issueId)).map((r: Relation) => ({ issueId: i.id, target: r.issueId })));
    },
    message: ({ issueId, target }) => `Card ${issueId} is blocked by ${target}, which is not on the board.`,
  }),
  rule<KanbanRoot, { issueId: string; cycle: string[] }>({
    code: 'card_block_cycle', select: (m) => m.graph.cycles,
    message: ({ cycle }) => `Cards block each other in a loop: ${cycle.join(' -> ')}.`,
  }),
  rule<KanbanRoot, { issueId: string; depKey: string }>({
    code: 'card_done_before_blocker', severity: 'warning', select: (m) => m.graph.completionViolations,
    message: ({ issueId, depKey }) => `Card ${issueId} is done but ${depKey}, which blocks it, is not.`,
  }),
  rule<KanbanRoot, { issueId: string; line: string }>({
    code: 'kanban_line_unparsed',
    select: (m) => m.root.issues.flatMap((i) => (i.unparsed ?? []).map((line) => ({ issueId: i.id, line }))),
    message: ({ issueId, line }) => `Card ${issueId}: "${line.trim()}" under Comments is neither a "- " comment nor the "N earlier comments" line.`,
  }),
];

// ── the dashboard's vocabulary, as plain data ──────────────────────────────────────────────
const KANBAN_VISUALIZER: VisualizerSpec = {
  statusOrder: ['triage', 'todo', 'ready', 'running', 'review', 'blocked', 'scheduled', 'done', 'archived'], // must equal KanbanStatusSchema above
  acUnitLabel: 'Subtasks',
  assignee: 'assignee',
};

export const KanbanPreset: Preset<KanbanRoot> = {
  name: 'kanban',
  schema: KanbanRootSchema,
  visualizer: KANBAN_VISUALIZER,
  parse: parseKanban,
  serialize: serializeKanbanCard, // card -> { body, columns }; the inverse of parse
  rules: KANBAN_RULES,
  // a card is done (for the block graph) when it is in the done or archived lane.
  isIssueDone: (i) => i.status === 'done' || i.status === 'archived',
  primitives: { relations: true, blocking: true, labels: false, children: false, proof: false, sources: false, category: false },
  scaffold: (_title) => `Workspace: scratch\n\nWhat the card is for, and its done state.\n`,
};

export function checkKanban(records: IssueRecord[], ctx?: Context) {
  return runCheck(KanbanPreset, records, ctx);
}

// The installed entrypoint: the resolver reads the preset off `default`.
export default KanbanPreset;
