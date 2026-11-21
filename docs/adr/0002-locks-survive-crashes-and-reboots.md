# Locks survive crashes and reboots

Accepted 2026-11-08 for card VO-3829 (`locks-survive-reboot`), on the owner's rule for every lock.

Every lock in ztrack recovers by itself after its holder crashes or the machine reboots. A lock is either one the OS
releases when its holder dies (an flock or fcntl lock, a held-open descriptor, a bound socket), or a record that names
its holder by pid **and** that pid's process start time, with a nonce of its own take so a holder releases only the
lock it took.

Each lock is judged on three cases: (a) a crash leaves the lock behind, including an empty or half-written record;
(b) a reboot hands its pid to another live process; (c) its pid is reused by a process of the same program. A record
is written whole before the lock exists (a finished temporary file hard-linked into place), and a record that cannot
be read is stale. A lock in an earlier format is stale; there is no reader for old formats.

`src/processLock.ts` holds that lock. It reads a process's start time with `ps -o lstart=` (in UTC and the C locale),
or PowerShell's `StartTime` ticks on Windows. No such process means the lock is stale, and a different start means it
is held by another process. When the start cannot be read, the pid's liveness decides, so a live holder is never taken
for stale. A stale lock is moved aside, read again and removed. If another taker's fresh lock was moved instead, it is
put back.

The locks this covers:

- `ztrack sync hermes`'s per-board-file lock (`<syncStateDir>/hermes-sync.<file>.lock`, `src/sync/hermes/sync.ts`):
  one sync at a time per board file. Survives (a), (b) and (c).
