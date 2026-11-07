// Upload evidence files to the linked GitHub repo as RELEASE ASSETS (a durable, public download
// URL), via the gh CLI. GitHub has no public API to attach a file to an issue, so a dedicated
// `ztrack-evidence` release is the asset host. The returned URL is cited as `image=<url>` and
// pinned by `sha256` so the gate accepts it as a tamper-evident commitment (no fetch on check)
// and `ztrack evidence verify` can fetch + compare. Auth is the gh CLI (or its token).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export const EVIDENCE_RELEASE_TAG = 'ztrack-evidence';

/** Upload `filePath` to `repo`'s evidence release and return the download URL + content digest.
 *  Idempotent: re-uploading the same asset name clobbers. Throws (with a clear message) if gh is
 *  unavailable/unauthed or the upload fails. */
export function uploadEvidenceToGithub(repo: string, filePath: string, name?: string): { url: string; sha256: string } {
  const bytes = readFileSync(filePath);
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const assetName = name || basename(filePath);
  // gh names the asset after the file's basename, so stage under the desired name when they differ.
  let upPath = filePath;
  if (assetName !== basename(filePath)) {
    upPath = join(mkdtempSync(join(tmpdir(), 'ztrk-ev-')), assetName);
    copyFileSync(filePath, upPath);
  }
  // Ensure the evidence release exists (idempotent — a second create just fails, which we ignore).
  spawnSync('gh', ['release', 'create', EVIDENCE_RELEASE_TAG, '-R', repo, '-t', 'ztrack evidence',
    '-n', 'Evidence artifacts uploaded by ztrack — pinned by sha256 in the tracker. Do not delete.'], { stdio: 'ignore' });
  const up = spawnSync('gh', ['release', 'upload', EVIDENCE_RELEASE_TAG, upPath, '--clobber', '-R', repo], { encoding: 'utf8' });
  if (up.status !== 0) {
    throw new Error(`gh release upload failed (need the gh CLI installed + \`gh auth login\`): ${(up.stderr || up.stdout || '').trim()}`);
  }
  return { url: `https://github.com/${repo}/releases/download/${EVIDENCE_RELEASE_TAG}/${encodeURIComponent(assetName)}`, sha256 };
}

/** Fetch a URL-hosted evidence artifact and verify its content matches the pinned digest.
 *  Network — used by `ztrack evidence verify`, NEVER by `check` (the gate stays offline). GitHub
 *  release assets are fetched via the gh CLI so PRIVATE repos work too; everything else over fetch. */
export async function verifyUrlDigest(url: string, expectedSha256: string): Promise<{ ok: boolean; reason?: string }> {
  const bytes = await fetchEvidenceBytes(url);
  if (!bytes.ok) return { ok: false, reason: bytes.reason };
  const actual = `sha256:${createHash('sha256').update(bytes.bytes).digest('hex')}`;
  return actual === expectedSha256.toLowerCase()
    ? { ok: true }
    : { ok: false, reason: `digest mismatch: ${url} is ${actual}, pinned ${expectedSha256}` };
}

async function fetchEvidenceBytes(url: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  // A GitHub release-asset URL: download via gh (authenticated → works for private repos), else fetch.
  const gh = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/(.+)$/i.exec(url);
  if (gh) {
    const [, repo, tag, name] = gh;
    const dest = join(mkdtempSync(join(tmpdir(), 'ztrk-ver-')), 'asset');
    const r = spawnSync('gh', ['release', 'download', tag!, '-R', repo!, '-p', decodeURIComponent(name!), '-O', dest, '--clobber'], { encoding: 'utf8' });
    if (r.status !== 0) {
      // gh missing/unauthed → try an unauthenticated fetch (works for public repos).
      try { const res = await fetch(url); if (res.ok) return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) }; } catch { /* fall through */ }
      return { ok: false, reason: `gh release download failed for ${url}: ${(r.stderr || r.stdout || '').trim()}` };
    }
    return { ok: true, bytes: new Uint8Array(readFileSync(dest)) };
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: `fetch ${url} → HTTP ${res.status}` };
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch (e) {
    return { ok: false, reason: `fetch ${url} failed: ${(e as Error).message}` };
  }
}
