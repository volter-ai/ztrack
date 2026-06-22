// Content-addressed evidence blob store for the markdown tracker.
//
// Why this exists: evidence (screenshots, frames) used to be referenced by a
// filesystem PATH (`uploads/<issue>/x.png`). A path's existence depends on
// WHICH checkout you stat — a develop run writes it into an isolated worktree
// (often a gitignored dir), the validator stats `main`, and they perpetually
// disagree; the file then vanishes when the worktree is reaped. The fix is to
// stop addressing evidence by location and address it by CONTENT: the bytes are
// stored once, keyed by their sha256, as files in a `blobs/` dir PEER to the
// markdown issue store (committed alongside the issues — deduped, identical from
// every worktree and from main). "Does this evidence exist" becomes a file stat.
//
// The digest form (`sha256:<hex>`) matches the OCI / git-object idiom: a blob
// is immutable and self-verifying, so a put is idempotent (dedup for free).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Blobs live in a `blobs/` dir peer to the markdown issue store
// (`.volter/tracker/markdown`), content-addressed, deduped, and committed
// alongside the issues — identical from every checkout, no binary DB.
export function markdownBlobDir(projectRoot: string): string {
  return join(projectRoot, '.volter', 'tracker', 'markdown', 'blobs');
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

function hashOf(refOrHash: string): string | null {
  return blobHashFromRef(refOrHash) ?? (/^[0-9a-f]{64}$/i.test(refOrHash.trim()) ? refOrHash.trim().toLowerCase() : null);
}

// Store bytes content-addressed; return the canonical `sha256:<hex>` ref.
// Idempotent: identical content yields the same ref and writes nothing the
// second time (the file already exists at its content hash).
export function putBlob(projectRoot: string, bytes: Uint8Array, mediaType?: string): BlobRef {
  const hash = sha256(bytes);
  const dir = markdownBlobDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, hash);
  if (!existsSync(p)) writeFileSync(p, bytes); // idempotent: content-addressed
  if (mediaType && !existsSync(`${p}.type`)) writeFileSync(`${p}.type`, mediaType);
  return `sha256:${hash}`;
}

// Existence check — the validator's question. Accepts a `sha256:<hex>` ref or a
// bare hex hash. Pure file stat: identical from every checkout/worktree.
export function hasBlob(projectRoot: string, refOrHash: string): boolean {
  const hash = hashOf(refOrHash);
  return hash ? existsSync(join(markdownBlobDir(projectRoot), hash)) : false;
}

// Retrieve bytes (e.g. to re-extract or serve). Null if absent.
export function getBlob(projectRoot: string, refOrHash: string): { bytes: Uint8Array; mediaType: string | null } | null {
  const hash = hashOf(refOrHash);
  if (!hash) return null;
  const p = join(markdownBlobDir(projectRoot), hash);
  if (!existsSync(p)) return null;
  return { bytes: readFileSync(p), mediaType: existsSync(`${p}.type`) ? readFileSync(`${p}.type`, 'utf8') : null };
}
