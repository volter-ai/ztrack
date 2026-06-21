import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { putBlob, hasBlob, getBlob, markdownBlobDir } from './blobStore.ts';

// The markdown backend has no sqlite blob table; blobs are content-addressed files
// in a blobs/ dir peer to the markdown issue store. This is the parity that lets
// `evidence add --file` (screenshot upload) work on the markdown backend.
test('markdown backend: blobs round-trip via the file store (put/has/get, idempotent)', () => {
  const root = mkdtempSync(join(tmpdir(), 'ztrack-mdblob-'));
  try {
    mkdirSync(join(root, '.volter'), { recursive: true });
    writeFileSync(
      join(root, '.volter', 'tracker-config.json'),
      JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }),
    );
    const bytes = new TextEncoder().encode('hello-screenshot-bytes');
    const ref = putBlob(root, bytes, 'image/png');
    expect(ref).toMatch(/^sha256:[0-9a-f]{64}$/);
    // stored as a file in the peer blobs/ dir (committed alongside the markdown issues)
    expect(markdownBlobDir(root)).toBe(join(root, '.volter', 'tracker', 'markdown', 'blobs'));
    expect(existsSync(join(markdownBlobDir(root)!, ref.slice('sha256:'.length)))).toBe(true);

    expect(hasBlob(root, ref)).toBe(true);
    const got = getBlob(root, ref);
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!.bytes)).toBe('hello-screenshot-bytes');
    expect(got!.mediaType).toBe('image/png');

    // content-addressed → idempotent put, same ref, no throw
    expect(putBlob(root, bytes, 'image/png')).toBe(ref);
    // an unknown blob is absent (not an error)
    expect(hasBlob(root, `sha256:${'0'.repeat(64)}`)).toBe(false);
    expect(getBlob(root, `sha256:${'0'.repeat(64)}`)).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
