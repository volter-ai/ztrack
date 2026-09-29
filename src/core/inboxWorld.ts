// Preset-agnostic message facts for a preset's `loadContext`: the messages a tracker cites by id,
// read from supercode's mailboxes on this machine (`supercode message show --json <id>…`), as
// world events a rule can check a citation against. Every message a session receives or sends has
// an id there: mail from another session, a channel or a Room (`m-…`), a line a session's user
// typed (`u-…`), a session's answer to its user (`a-…`).
//
// Each cited id becomes one event of service `supercode`: `type` is the message's kind and `text`
// its words when a mailbox holds it; `type: 'unreachable'` (no text) when supercode could not be
// asked, so a rule can say which. An id no mailbox holds has no event.

import { execFileSync } from 'node:child_process';
import type { Context } from './engine.ts';

type WorldEvent = NonNullable<NonNullable<Context['world']>['events']>[number];

/** The service name of a supercode message event. */
export const SUPERCODE_SERVICE = 'supercode';

interface ShowRow { id: string; found: boolean; message?: { envelope?: { kind?: string; body?: string } } }

/** The messages with `ids`, as world events. `SUPERCODE_BIN` names the supercode to ask. */
export function supercodeMessages(ids: string[]): WorldEvent[] {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return [];
  let rows: ShowRow[];
  try {
    // `show` exits 3 when an id is not found; its stdout still answers for every id.
    let stdout: string;
    try {
      stdout = execFileSync(process.env.SUPERCODE_BIN || 'supercode', ['message', 'show', '--json', ...wanted], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024,
      });
    } catch (error) {
      const out = (error as { status?: number; stdout?: string }).status === 3 ? (error as { stdout?: string }).stdout : undefined;
      if (out === undefined) throw error;
      stdout = out;
    }
    rows = JSON.parse(stdout) as ShowRow[];
  } catch {
    return wanted.map((id) => ({ id, service: SUPERCODE_SERVICE, type: 'unreachable', annotationRequired: false }));
  }
  return rows.filter((row) => row.found).map((row) => ({
    id: row.id, service: SUPERCODE_SERVICE, type: row.message?.envelope?.kind ?? 'message',
    text: row.message?.envelope?.body ?? '', annotationRequired: false,
  }));
}

/** Whether `quote` is in `text`, ignoring differences in whitespace. */
export function quoteIn(text: string, quote: string): boolean {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  return flat(text).includes(flat(quote));
}
