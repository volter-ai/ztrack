// VIZ-15 dev/02 + dev/04: `ztrack preset upgrade` also 3-way merges the repo-owned dashboard
// `extension.tsx` against its pristine `.extension.base.tsx`, REUSING `threeWayMerge` — the exact
// same technique `presetUpgrade.test.ts` uses for `preset.mts` (simulate "installed an older
// version" by rewriting the pristine base, apply a local edit, assert the merge), applied to the
// extension artifact instead. Also covers the one-of-file cases (never silent) and the
// pre-existing-repo seed-by-command path (dev/04).
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initTrackerProject, trackerVisualizerExtensionBasePath, trackerVisualizerExtensionPath, upgradeTrackerPreset } from './presetCatalog.ts';

// a line the current starter template contains, vs an "older" form of it — same simulate-an-
// upstream-change technique as presetUpgrade.test.ts's NEW/OLD constants.
const NEW = '// Your repo-owned dashboard extension (see docs/VISUALIZER.md). It compiles into the served';
const OLD = '// Your repo-owned dashboard extension. It compiles into the served';

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'ztrack-upgrade-ext-'));
  initTrackerProject(root, 'APP', { preset: 'default' });
  return root;
}

describe('ztrack preset upgrade — dashboard extension.tsx (3-way merge, VIZ-15)', () => {
  test('grep parity: ONE threeWayMerge implementation serves both preset.mts and extension.tsx', () => {
    const src = readFileSync(new URL('./presetCatalog.ts', import.meta.url), 'utf8');
    const defs = src.match(/function threeWayMerge\(/g) ?? [];
    expect(defs.length).toBe(1); // never forked — see upgradeExtension's call site reusing it
    expect(src).toContain('threeWayMerge(ours, base, upstream)'); // preset's own call site
    expect(src).toContain('threeWayMerge(ours, base, STARTER_EXTENSION_TEMPLATE)'); // extension's call site, same function
  });

  test('a fresh init records a pristine base alongside the installed extension', () => {
    const root = tempProject();
    try {
      const r = upgradeTrackerPreset(root);
      expect(r.extension.status).toBe('up-to-date'); // base already matches the bundled starter
      expect(r.extension.conflicts).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('cleanly merges an upstream starter change while preserving a local edit (dev/02)', () => {
    const root = tempProject();
    try {
      const ep = trackerVisualizerExtensionPath(root);
      const bp = trackerVisualizerExtensionBasePath(root);
      const current = readFileSync(ep, 'utf8');
      expect(current).toContain(NEW); // sanity: current starter template has the new form

      // simulate having installed an OLDER starter: base + our file carried OLD.
      const old = current.replace(NEW, OLD);
      writeFileSync(bp, old);
      // the user's local edit (non-overlapping): a panel line added to their extension.
      const ours = `${old}\n// MY-CUSTOM-PANEL-EDIT: a panel line the user added\n`;
      writeFileSync(ep, ours);

      const r = upgradeTrackerPreset(root);
      expect(r.extension.status).toBe('updated');
      expect(r.extension.conflicts).toBe(0);

      const merged = readFileSync(ep, 'utf8');
      expect(merged).toContain(NEW);                    // upstream change applied
      expect(merged).not.toContain(OLD);
      expect(merged).toContain('MY-CUSTOM-PANEL-EDIT'); // the user's edit survived
      expect(readFileSync(bp, 'utf8')).toContain(NEW);  // base advanced to the new upstream
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('marks conflicts when the local edit and the upstream change land on the same line', () => {
    const root = tempProject();
    try {
      const ep = trackerVisualizerExtensionPath(root);
      const bp = trackerVisualizerExtensionBasePath(root);
      const current = readFileSync(ep, 'utf8');
      const old = current.replace(NEW, OLD);
      writeFileSync(bp, old); // base: OLD
      writeFileSync(ep, old.replace(OLD, '// A DIFFERENT hand-edit of the very same line')); // ours edits the same line

      const r = upgradeTrackerPreset(root);
      expect(r.extension.status).toBe('conflicts');
      expect(r.extension.conflicts).toBeGreaterThan(0);
      const merged = readFileSync(ep, 'utf8');
      expect(merged).toContain('<<<<<<< your edits');
      expect(merged).toContain('>>>>>>> new upstream');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // One-of-file cases are never silent (frozen spec).
  test('one-of-file: extension present, base missing -> "no-base" status naming the re-seed path', () => {
    const root = tempProject();
    try {
      rmSync(trackerVisualizerExtensionBasePath(root));
      const r = upgradeTrackerPreset(root);
      expect(r.extension.status).toBe('no-base');
      expect(existsSync(trackerVisualizerExtensionPath(root))).toBe(true); // untouched — never clobbered
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('one-of-file: extension deleted, base present -> explicit "skipped" status, never silently reinstalled', () => {
    const root = tempProject();
    try {
      rmSync(trackerVisualizerExtensionPath(root));
      const r = upgradeTrackerPreset(root);
      expect(r.extension.status).toBe('skipped');
      expect(existsSync(trackerVisualizerExtensionPath(root))).toBe(false); // the deletion is respected, not silently undone
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // dev/04 — a repo init'd BEFORE this feature: config exists, neither extension file is present
  // (mirrors the preset's own no-base re-seed convention: `ztrack preset upgrade` seeds by command).
  test('seeds extension.tsx + .extension.base.tsx for a pre-existing repo missing both (dev/04)', () => {
    const root = tempProject();
    try {
      const ep = trackerVisualizerExtensionPath(root);
      const bp = trackerVisualizerExtensionBasePath(root);
      rmSync(ep); rmSync(bp); // simulate: init'd before VIZ-15 existed

      const r1 = upgradeTrackerPreset(root);
      expect(r1.extension.status).toBe('seeded');
      expect(existsSync(ep)).toBe(true);
      expect(existsSync(bp)).toBe(true);
      expect(readFileSync(ep, 'utf8')).toBe(readFileSync(bp, 'utf8'));

      // a second run is idempotent — up to date, no rewrite.
      const before = readFileSync(ep, 'utf8');
      const r2 = upgradeTrackerPreset(root);
      expect(r2.extension.status).toBe('up-to-date');
      expect(readFileSync(ep, 'utf8')).toBe(before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
