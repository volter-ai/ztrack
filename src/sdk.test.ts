// ztrack issue #19 (snapshot is a stub): the markdown backend's `snapshot` verb
// (backends/markdownBackend.ts) has no real implementation — it returns an empty stdout and a
// "not yet implemented" stderr message. sdk.ts's `snapshot()` used `parseJsonOrText(stdout)`,
// which only reads stdout, so it silently resolved to `null` — an SDK/MCP caller couldn't tell
// "no snapshot data" from "this feature doesn't exist yet". It must now surface an explicit error.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerClient } from './sdk.ts';

test('client.snapshot() rejects with the backend\'s "not yet implemented" message, not null', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-sdk-snapshot-'));
  try {
    mkdirSync(join(root, '.volter'), { recursive: true });
    writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({ backend: 'markdown', local: { teamKey: 'PH' } }));
    const client = createTrackerClient({ projectRoot: root });
    await expect(client.snapshot()).rejects.toThrow(/not yet implemented/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
