// The board — a kanban in Hermes's format — read and written ONLY through supercode's board door
// (`supercode workflow …`), never its SQLite file and never Hermes's own code. supercode answers
// every `hermes kanban` verb, and its board's workflow (its IR) decides what each write does: the
// statuses, who may move a card and how, what reaches the card's session. So a sync's writes are
// the same events a person's are. `BoardExec` is the one seam — the real one spawns `supercode`;
// tests inject a fake board behind the same argv contract.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

/** One card as the board holds it (the fields the sync reads; the rest stay the board's). */
export interface BoardCard {
  id: string;                 // t_65a8d101
  title: string;
  body: string;
  /** The status the board's workflow names (its own statuses: `stopped`, `reviewing`, …). */
  status: string;
  assignee: string | null;
  priority: number;
  workspaceKind: string;      // scratch | worktree | dir
  workspacePath: string | null;
  branch: string | null;
  machine: string | null;
  createdAt: number;
  parents: string[];          // cards that must finish first (`link parent child`), open ones only
  /** The arc this card is a subtask of, or null. */
  subtaskOf: string | null;
  /** The card's open run (a claim, not yet ended), with the session it names, if any. */
  run: BoardRun | null;
}

export interface BoardRun { id: number; status: string; startedAt: number; session: string | null }

export type BoardExec = (args: string[]) => Promise<string>;

export interface BoardTarget {
  /** The home the board lives in (`supercode workflow --root`). Absent: the environment's. */
  home?: string;
  /** A named board (`--board <slug>`). Absent: the home's default board. */
  board?: string;
  /** The `supercode` executable. Default `supercode` on PATH. */
  bin?: string;
}

const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? `${homedir()}${p.slice(1)}` : p);

/** Where each call names the board: `--root <home> [--board <slug>]`, after the verb's own words. */
export const boardFlags = (target: BoardTarget) => [...(target.home ? ['--root', expandHome(target.home)] : []), ...(target.board ? ['--board', target.board] : [])];

/** The real exec: `supercode workflow <args> [--root …] [--board …]`. Rejects with the board's
 *  own words on a non-zero exit, so a refused move reads as the workflow refused it. */
export function boardExec(target: BoardTarget = {}): BoardExec {
  return (args) => new Promise((resolveP, reject) => {
    execFile(target.bin ?? 'supercode', ['workflow', ...args, ...boardFlags(target)], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`supercode workflow ${args[0]}: ${(stderr || stdout || err.message).trim()}`));
      else resolveP(stdout);
    });
  });
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Every card on the board except archived ones, in one read (`list --json`: each card with its
 *  workflow status, parents, arc and open run). */
export async function readBoard(exec: BoardExec): Promise<BoardCard[]> {
  const list = JSON.parse(await exec(['list', '--json'])) as Json[];
  const open = new Set(list.filter((row) => row.status !== 'done').map((row) => String(row.id)));
  return list.map((row) => {
    const run = row.run as Json | null | undefined;
    return {
      id: String(row.id),
      title: String(row.title ?? ''),
      body: str(row.body) ?? '',
      status: String(row.workflow_status ?? row.status),
      assignee: str(row.assignee),
      priority: typeof row.priority === 'number' ? row.priority : 0,
      workspaceKind: str(row.workspace_kind) ?? 'scratch',
      workspacePath: str(row.workspace_path),
      branch: str(row.branch_name),
      machine: str(row.machine),
      createdAt: typeof row.created_at === 'number' ? row.created_at : 0,
      // a link to a done or archived card no longer gates anything; only open parents are dependencies here
      parents: (Array.isArray(row.parents) ? row.parents.map(String) : []).filter((p) => open.has(p)),
      subtaskOf: str(row.subtask_of),
      run: run ? { id: Number(run.id), status: String(run.status ?? 'running'), startedAt: Number(run.started_at ?? 0), session: str(run.session) } : null,
    };
  });
}

export interface NewCard {
  title: string; body: string; assignee?: string | null; parents: string[];
  workspace?: string; branch?: string | null; priority?: number; machine?: string | null;
  /** File it as a subtask of this arc. */
  subtaskOf?: string;
}

/** The board's write doors, one method per verb the sync uses. `author` is who the board records for each write
 *  (the board file the edit was made in): the sync runs in no session, and the board would otherwise name the
 *  machine's user, so a session reads an edit anyone made in the file as its owner's words. */
export function boardWriter(exec: BoardExec, author = 'the board file') {
  const run = (args: string[]) => exec(args).then(() => undefined);
  return {
    async create(c: NewCard): Promise<string> {
      // the board's dispatcher starts what it starts; a card written in the file is filed, never launched by the write
      const args = ['create', c.title, '--body', c.body, '--no-start', '--json', '--created-by', author];
      if (c.assignee) args.push('--assignee', c.assignee);
      for (const p of c.parents) args.push('--parent', p);
      if (c.workspace && c.workspace !== 'scratch') args.push('--workspace', c.workspace);
      if (c.branch) args.push('--branch', c.branch);
      if (c.priority) args.push('--priority', String(c.priority));
      if (c.machine) args.push('--machine', c.machine);
      if (c.subtaskOf) args.push('--subtask-of', c.subtaskOf);
      const out = JSON.parse(await exec(args)) as Json;
      return String(out.id);
    },
    /** The card's title and body, edited where it stands. */
    specify: (id: string, edit: { title?: string; body?: string }) =>
      run(['specify', id, ...(edit.title !== undefined ? ['--title', edit.title] : []), ...(edit.body !== undefined ? ['--body', edit.body] : []), '--author', author]),
    comment: (id: string, text: string) => run(['comment', id, text, '--author', author]),
    assign: (id: string, who: string | null) => run(['assign', id, who ?? 'none']),
    move: (id: string, machine: string | null) => run(['move', id, machine ?? 'none']),
    link: (parent: string, child: string) => run(['link', parent, child]),
    unlink: (parent: string, child: string) => run(['unlink', parent, child]),
    /** Take the card to `status` by whichever event the board's workflow says goes there. */
    goto: (id: string, status: string) => run(['goto', id, status]),
    archive: (id: string) => run(['archive', id]),
  };
}
export type BoardWriter = ReturnType<typeof boardWriter>;
