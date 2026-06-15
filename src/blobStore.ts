// Content-addressed evidence blob store, in the tracker's own sqlite DB.
//
// Why this exists: evidence (screenshots, frames) used to be referenced by a
// filesystem PATH (`uploads/<issue>/x.png`). A path's existence depends on
// WHICH checkout you stat — a develop run writes it into an isolated worktree
// (often a gitignored dir), the validator stats `main`, and they perpetually
// disagree; the file then vanishes when the worktree is reaped. The fix is to
// stop addressing evidence by location and address it by CONTENT: the bytes
// are stored once, keyed by their sha256, in the tracker DB — the same shared,
// symlinked store that issues live in. "Does this evidence exist" becomes a DB
// query, identical from every worktree and from main. No path, no gitignore,
// no land-to-main step.
//
// The digest form (`sha256:<hex>`) matches the OCI / git-object idiom: a blob
// is immutable and self-verifying, so a put is idempotent (dedup for free).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { stateDirName, trackerConfigPath } from './config.ts';

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

type SqliteDb = {
  query: (sql: string) => { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => unknown };
  run: (sql: string, ...args: unknown[]) => unknown;
  exec: (sql: string) => unknown;
  close: () => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Resolve the local sqlite DB path the same way the exporter does, so the blob
// store always lives in the one shared DB the rest of the tracker uses.
export function trackerDbPath(projectRoot: string): string | null {
  const config = readJson(trackerConfigPath(projectRoot));
  if (!isObject(config) || config.backend !== 'local') return null;
  const local = isObject(config.local) ? config.local : {};
  const rel = typeof local.database === 'string' && local.database
    ? local.database
    : join(stateDirName(), 'tracker.sqlite');
  const dbPath = isAbsolute(rel) ? rel : join(projectRoot, rel);
  return existsSync(dbPath) ? dbPath : null;
}

function openDb(projectRoot: string): SqliteDb | null {
  const dbPath = trackerDbPath(projectRoot);
  if (!dbPath) return null;
  const { Database } = require('bun:sqlite') as { Database: new (path: string) => SqliteDb };
  const db = new Database(dbPath);
  db.exec(
    `CREATE TABLE IF NOT EXISTS tracker_blob (
       hash TEXT PRIMARY KEY,
       bytes BLOB NOT NULL,
       media_type TEXT,
       size INTEGER NOT NULL,
       created_at TEXT NOT NULL
     )`,
  );
  return db;
}

export type BlobRef = string; // canonical form: `sha256:<hex>`

const SHA256_REF_RE = /^sha256:([0-9a-f]{64})$/i;

export function isBlobRef(value: unknown): value is BlobRef {
  return typeof value === 'string' && SHA256_REF_RE.test(value.trim());
}

export function blobHashFromRef(ref: string): string | null {
  const m = SHA256_REF_RE.exec(ref.trim());
  return m ? m[1].toLowerCase() : null;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Store bytes content-addressed; return the canonical `sha256:<hex>` ref.
// Idempotent: identical content yields the same ref and writes nothing the
// second time (INSERT OR IGNORE on the hash primary key).
export function putBlob(
  projectRoot: string,
  bytes: Uint8Array,
  mediaType?: string,
): BlobRef {
  const hash = sha256(bytes);
  const db = openDb(projectRoot);
  if (!db) throw new Error('tracker blob store: no local sqlite DB resolved (is backend `local` configured?)');
  try {
    db.run(
      'INSERT OR IGNORE INTO tracker_blob(hash, bytes, media_type, size, created_at) VALUES(?, ?, ?, ?, ?)',
      hash,
      bytes,
      mediaType ?? null,
      bytes.byteLength,
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
  return `sha256:${hash}`;
}

// Existence check — the validator's question. Accepts a `sha256:<hex>` ref or a
// bare hex hash. Pure DB query: identical from every checkout/worktree.
export function hasBlob(projectRoot: string, refOrHash: string): boolean {
  const hash = blobHashFromRef(refOrHash) ?? (/^[0-9a-f]{64}$/i.test(refOrHash.trim()) ? refOrHash.trim().toLowerCase() : null);
  if (!hash) return false;
  const db = openDb(projectRoot);
  if (!db) return false;
  try {
    const row = db.query('SELECT 1 AS present FROM tracker_blob WHERE hash = ?').get(hash) as { present?: number } | null;
    return Boolean(row?.present);
  } finally {
    db.close();
  }
}

// Retrieve bytes (e.g. to re-extract or serve). Null if absent.
export function getBlob(projectRoot: string, refOrHash: string): { bytes: Uint8Array; mediaType: string | null } | null {
  const hash = blobHashFromRef(refOrHash) ?? (/^[0-9a-f]{64}$/i.test(refOrHash.trim()) ? refOrHash.trim().toLowerCase() : null);
  if (!hash) return null;
  const db = openDb(projectRoot);
  if (!db) return null;
  try {
    const row = db.query('SELECT bytes, media_type FROM tracker_blob WHERE hash = ?').get(hash) as
      | { bytes?: Uint8Array; media_type?: string | null }
      | null;
    if (!row?.bytes) return null;
    return { bytes: row.bytes, mediaType: row.media_type ?? null };
  } finally {
    db.close();
  }
}
