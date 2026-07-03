// ZTB-19 (ZL-E4): `organization.check.categories` was written by every fresh `init` even though
// nothing reads it — no shipped preset assigns any rule a category for it to select among, and
// `ztrack check --categories` reads its own CLI flag, never this config block. Pinning that a
// fresh init no longer writes it (existing configs that already have it keep working — this only
// changes what a NEW init writes).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initTrackerProject } from './presetCatalog.ts';
import { trackerConfigPath } from './config.ts';

describe('initTrackerProject — no dead categories block (ZL-E4)', () => {
  test('a fresh init writes no organization.check.categories', () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrack-init-'));
    try {
      initTrackerProject(root, 'APP', { preset: 'default' });
      const config = JSON.parse(readFileSync(trackerConfigPath(root), 'utf8'));
      expect(config.organization?.check?.categories).toBeUndefined();
      // and organization itself, having nothing else to carry at init time, is absent entirely
      expect(config.organization).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
