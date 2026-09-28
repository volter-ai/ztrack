// The Hermes kanban, read and written ONLY through its own CLI (`hermes kanban …`), never its
// SQLite file: every write goes through the door Hermes itself runs, so its events, notifications
// and dispatcher see a sync's edits exactly as they see a person's. `HermesExec` is the one seam —
// the real one spawns `hermes`; tests inject a fake board behind the same argv contract.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

export interface HermesComment { author: string; body: string; createdAt: number }

/** One card as the board holds it (the fields the sync reads; the rest stay the board's). */
export interface HermesCard {
  id: string;                 // t_65a8d101
  title: string;
  body: string;
  status: string;             // triage | todo | ready | running | review | blocked | scheduled | done | archived
  assignee: string | null;
  priority: number;
  workspaceKind: string;      // scratch | worktree | dir
  workspacePath: string | null;
  branch: string | null;
  createdAt: number;
  parents: string[];          // cards that must finish first (Hermes `link parent child`)
  comments: HermesComment[];
}

export type HermesExec = (args: string[]) => Promise<string>;

export interface HermesTarget {
  /** HERMES_HOME of the board's profile. Absent: the caller's environment decides (Hermes's own default). */
  home?: string;
  /** A named board (`hermes kanban --board <slug>`). Absent: the home's default board. */
  board?: string;
  /** The `hermes` executable. Default `hermes` on PATH. */
  bin?: string;
}

const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? `${homedir()}${p.slice(1)}` : p);

/** The real exec: `hermes kanban [--board b] <args>` with HERMES_HOME set. Rejects with Hermes's
 *  own stderr on a non-zero exit, so a refused transition reads in Hermes's words. */
export function hermesExec(target: HermesTarget = {}): HermesExec {
  const env = { ...process.env, ...(target.home ? { HERMES_HOME: expandHome(target.home) } : {}) };
  const prefix = ['kanban', ...(target.board ? ['--board', target.board] : [])];
  return (args) => new Promise((resolveP, reject) => {
    execFile(target.bin ?? 'hermes', [...prefix, ...args], { env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`hermes kanban ${args[0]}: ${(stderr || stdout || err.message).trim()}`));
      else resolveP(stdout);
    });
  });
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toCard(task: Json, parents: string[], comments: HermesComment[]): HermesCard {
  return {
    id: String(task.id),
    title: String(task.title ?? ''),
    body: str(task.body) ?? '',
    status: String(task.status),
    assignee: str(task.assignee),
    priority: typeof task.priority === 'number' ? task.priority : 0,
    workspaceKind: str(task.workspace_kind) ?? 'scratch',
    workspacePath: str(task.workspace_path),
    branch: str(task.branch_name),
    createdAt: typeof task.created_at === 'number' ? task.created_at : 0,
    parents,
    comments,
  };
}

async function mapLimit<T, U>(items: T[], limit: number, fn: (t: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Every card on the board except archived ones (Hermes's own `list` default), each with its
 *  parents and full comment thread (`show --json`). */
export async function readBoard(exec: HermesExec): Promise<HermesCard[]> {
  const list = JSON.parse(await exec(['list', '--json'])) as Json[];
  const onBoard = new Set(list.map((row) => String(row.id)));
  return mapLimit(list, 8, async (row) => {
    const shown = JSON.parse(await exec(['show', String(row.id), '--json'])) as { task: Json; parents?: unknown[]; comments?: Json[] };
    // A link to an archived card stays in Hermes but no longer gates anything the board shows;
    // only parents still on the board are the card's dependencies here.
    const parents = (shown.parents ?? []).map((p) => (typeof p === 'string' ? p : String((p as Json).id))).filter((p) => onBoard.has(p));
    const comments = (shown.comments ?? []).map((c) => ({ author: String(c.author ?? ''), body: String(c.body ?? ''), createdAt: Number(c.created_at ?? 0) }));
    return toCard(shown.task, parents, comments);
  });
}

export interface NewCard {
  title: string; body: string; assignee?: string | null; parents: string[];
  workspace?: string; branch?: string | null; priority?: number;
}

/** The board's write doors, one method per Hermes verb the sync uses. */
export function boardWriter(exec: HermesExec) {
  const run = (args: string[]) => exec(args).then(() => undefined);
  return {
    async create(c: NewCard): Promise<string> {
      const args = ['create', c.title, '--body', c.body, '--json'];
      if (c.assignee) args.push('--assignee', c.assignee);
      for (const p of c.parents) args.push('--parent', p);
      if (c.workspace && c.workspace !== 'scratch') args.push('--workspace', c.workspace);
      if (c.branch) args.push('--branch', c.branch);
      if (c.priority) args.push('--priority', String(c.priority));
      const out = JSON.parse(await exec(args)) as Json;
      return String(out.id);
    },
    comment: (id: string, text: string) => run(['comment', id, text]),
    assign: (id: string, who: string | null) => run(['assign', id, who ?? 'none']),
    link: (parent: string, child: string) => run(['link', parent, child]),
    unlink: (parent: string, child: string) => run(['unlink', parent, child]),
    complete: (id: string) => run(['complete', id]),
    block: (id: string) => run(['block', id]),
    schedule: (id: string) => run(['schedule', id]),
    unblock: (id: string) => run(['unblock', id]),
    promote: (id: string) => run(['promote', id]),
    requestReview: (id: string) => run(['request-review', id]),
    reopenReview: (id: string) => run(['reopen-review', id]),
    archive: (id: string) => run(['archive', id]),
  };
}
export type BoardWriter = ReturnType<typeof boardWriter>;
