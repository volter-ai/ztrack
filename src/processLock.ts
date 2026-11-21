// A lock file names its holder by pid, that pid's process start time and a nonce of its own take (docs/adr/0002). A
// pid alone names nothing once its process ends: a reboot hands it to another program, and a later run of the same
// program may get it too. The start time tells them apart; the nonce tells one take from another, so a holder lets go
// only of the lock it took.
//
// The record is written whole before the lock exists (a hard link of a finished file), so a lock file is never empty
// or half written. A lock whose record cannot be read, or whose process is not the one that took it, is stale: it is
// moved aside, read again, and removed, or put back when another taker's fresh lock was moved instead.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { win32 } from 'node:path';

interface LockRecord { pid: number; start: string; nonce: string }

/** When `pid`'s process started, as text that differs for any other process given the same pid; null when no process
 *  has that pid, undefined when it could not be read. */
function processStart(pid: number): string | null | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const win = process.platform === 'win32';
  const observed = win
    ? spawnSync(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`],
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    : spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 1_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' } });
  if (observed.error || observed.signal) return undefined;
  const start = observed.stdout.trim();
  if (observed.status === 0 && start) return start;
  // ps answers a pid with no process by exiting 1 and saying nothing; Get-Process says so on stderr
  return (!win && observed.status === 1 && !observed.stderr) || (win && /Cannot find a process/.test(observed.stderr)) ? null : undefined;
}

/** Whether `record` names a process running now: that pid, started at that time. When the start cannot be read the
 *  pid's liveness decides, so a live holder is never taken for stale. */
function processIsOwner(record: LockRecord): boolean {
  const start = processStart(record.pid);
  if (start !== undefined) return start === record.start;
  try { process.kill(record.pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function readLock(path: string): LockRecord | null {
  try {
    const record = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>;
    return Number.isInteger(record?.pid) && typeof record.start === 'string' && typeof record.nonce === 'string' ? record as LockRecord : null;
  } catch { return null; }
}

function removeStale(path: string, judged: LockRecord | null): void {
  const aside = `${path}.stale.${randomBytes(8).toString('hex')}`;
  try { renameSync(path, aside); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  // another taker removed the stale lock and took its own between our read and the move: its lock goes back
  if ((readLock(aside)?.nonce ?? null) !== (judged?.nonce ?? null)) {
    try { linkSync(aside, path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
  rmSync(aside, { force: true });
}

let ownStart: string | null | undefined;
/** Take the lock at `path` for this process: `{ release }` when taken, `{ holder }` (the live holder's pid) when
 *  another process holds it. A stale lock is taken over. */
export function acquireLock(path: string): { release: () => void } | { holder: number } {
  ownStart ??= processStart(process.pid);
  if (typeof ownStart !== 'string') throw new Error(`the start time of pid ${process.pid} could not be read`);
  const record: LockRecord = { pid: process.pid, start: ownStart, nonce: randomBytes(16).toString('hex') };
  const pending = `${path}.${record.nonce}.tmp`;
  writeFileSync(pending, JSON.stringify(record), { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        linkSync(pending, path);
        return { release: () => { if (readLock(path)?.nonce === record.nonce) rmSync(path, { force: true }); } };
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      const holder = readLock(path);
      if (holder && processIsOwner(holder)) return { holder: holder.pid };
      removeStale(path, holder);
    }
  } finally { rmSync(pending, { force: true }); }
  throw new Error(`could not take ${path}: it was taken and let go repeatedly`);
}
