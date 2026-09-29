// `ztrack sync hermes --watch`: the sync, run the moment either side moves, so nobody runs it by
// hand. The file side is a watch on the board file's directory (an editor's save-by-rename
// replaces the file's inode, so the file itself can't be watched). The board side is the board's
// event stream, `supercode workflow watch`, one line per card event, whoever made it (a person, a
// dispatcher, a session, this sync). Every trigger is debounced and coalesced into one sync at a
// time; a sync's own writes trigger one more sync, which finds nothing to do and writes nothing.
import { spawn } from 'node:child_process';
import { watch as watchFs } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { boardFlags } from './board.ts';
import type { HermesSyncResult } from './sync.ts';

// Events that change nothing the file shows: a live claim's lease renewal, a heartbeat, the
// dispatcher's asks and notes, and comments (the file carries no thread). On a busy board these
// are most of the stream.
const QUIET_KINDS = new Set(['claim_extended', 'goal_continued', 'heartbeat', 'decision_asked', 'idle_surfaced', 'respawn_guarded', 'commented', 'suspected_hallucinated_references']);
const quiet = (kind: string) => QUIET_KINDS.has(kind);

export interface HermesWatchLink { file: string; home?: string; board?: string; bin?: string }

export interface HermesWatchOpts {
  projectRoot: string;
  link: HermesWatchLink;
  /** One sync of the linked file (the caller binds preset and policy). */
  sync: () => Promise<HermesSyncResult>;
  /** Why each sync ran and what it did, or why it failed. */
  onSync: (why: string, r: HermesSyncResult | Error) => void;
  debounceMs?: number;
}

/** Runs until the board's event stream ends, then rejects: a supervisor restarts it. */
export function watchHermes(o: HermesWatchOpts): Promise<never> {
  const abs = isAbsolute(o.link.file) ? o.link.file : resolve(o.projectRoot, o.link.file);
  const debounceMs = o.debounceMs ?? 300;
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  const reasons = new Set<string>();

  const run = async () => {
    timer = null;
    if (running) return;
    running = true;
    const why = [...reasons].join(', ');
    reasons.clear();
    try { o.onSync(why, await o.sync()); } catch (e) { o.onSync(why, e as Error); }
    running = false;
    if (reasons.size) trigger(); // what arrived while syncing, this sync's own writes included
  };
  const trigger = (why?: string) => {
    if (why) reasons.add(why);
    if (running) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  };

  const name = basename(abs);
  const fsWatcher = watchFs(dirname(abs), (_event, f) => { if (f === name) trigger('file'); });

  const child = spawn(o.link.bin ?? 'supercode', ['workflow', 'watch', '--interval', '0.3', ...boardFlags(o.link)], { stdio: ['ignore', 'pipe', 'inherit'] });
  createInterface({ input: child.stdout! }).on('line', (line) => {
    const m = /^\[[^\]]*\]\s+(\S+)\s+(\S+)/.exec(line); // `[ts] t_… kind payload`
    if (m && !quiet(m[2]!)) trigger(`board ${m[2]} ${m[1]}`);
  });

  trigger('start');
  return new Promise<never>((_, reject) => {
    const stop = (why: string) => { fsWatcher.close(); if (timer) clearTimeout(timer); reject(new Error(`ztrack sync hermes --watch: ${why}`)); };
    child.on('error', (e) => stop(`\`hermes kanban watch\` could not start: ${e.message}`));
    child.on('exit', (code, signal) => stop(`\`hermes kanban watch\` ended (${signal ?? `exit ${code}`})`));
    fsWatcher.on('error', (e) => { child.kill(); stop(`the watch on ${dirname(abs)} failed: ${e.message}`); });
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { child.kill(); fsWatcher.close(); process.exit(0); });
  });
}
