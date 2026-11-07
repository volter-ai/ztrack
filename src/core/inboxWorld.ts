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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Context } from './engine.ts';

type WorldEvent = NonNullable<NonNullable<Context['world']>['events']>[number];

/** The service name of a supercode message event. */
export const SUPERCODE_SERVICE = 'supercode';

interface ShowRow { id: string; found: boolean; message?: { envelope?: { kind?: string; body?: string } } }

// A filed message never changes, so one read once is kept: a check asks supercode only for the
// ids it has not read before. An id no mailbox held is asked for again after ten minutes.
type Known = Record<string, { type: string; text: string } | { missing: number }>;
const MISSING_SECONDS = 600;
const knownPath = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ztrack', 'supercode-messages.json');
function readKnown(): Known {
  try { return JSON.parse(readFileSync(knownPath(), 'utf8')) as Known; } catch { return {}; }
}
function remember(found: Known): void {
  if (!Object.keys(found).length) return;
  try {
    const path = knownPath();
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...readKnown(), ...found }));
    renameSync(temporary, path);
  } catch { /* a cache that cannot be written only costs the next check a read */ }
}

/** The messages with `ids`, as world events. `SUPERCODE_BIN` names the supercode to ask. */
export function supercodeMessages(ids: string[]): WorldEvent[] {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const known = readKnown();
  const at = Math.floor(Date.now() / 1000);
  const event = (id: string, { type, text }: { type: string; text: string }): WorldEvent => ({ id, service: SUPERCODE_SERVICE, type, text, annotationRequired: false });
  const held = (id: string) => { const entry = known[id]; return entry && 'type' in entry ? entry : null; };
  const recentlyMissing = (id: string) => { const entry = known[id]; return Boolean(entry && 'missing' in entry && at - entry.missing < MISSING_SECONDS); };
  const cached = unique.filter((id) => held(id)).map((id) => event(id, held(id)!));
  const wanted = unique.filter((id) => !held(id) && !recentlyMissing(id));
  if (!wanted.length) return cached;
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
    return [...cached, ...wanted.map((id) => ({ id, service: SUPERCODE_SERVICE, type: 'unreachable', annotationRequired: false }))];
  }
  const found = Object.fromEntries(rows.filter((row) => row.found).map((row) => [row.id, { type: row.message?.envelope?.kind ?? 'message', text: row.message?.envelope?.body ?? '' }]));
  const missing = Object.fromEntries(wanted.filter((id) => !found[id]).map((id) => [id, { missing: at }]));
  remember({ ...found, ...missing });
  return [...cached, ...Object.entries(found).map(([id, message]) => event(id, message))];
}

/** Whether `quote` is in `text`, ignoring differences in whitespace. */
export function quoteIn(text: string, quote: string): boolean {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  return flat(text).includes(flat(quote));
}
