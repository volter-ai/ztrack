// `ztrack preset upgrade`: 3-way merge new upstream preset rules into an EDITED
// repo-local preset without clobbering edits. We simulate "installed an older version"
// by rewriting the pristine base, apply a local edit, and assert the merge.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initTrackerProject, trackerValidationBasePath, trackerValidationEntrypointPath, upgradeTrackerPreset } from './config.ts';

// a line the current bundled template contains, vs an older form of it.
const NEW = "message: () => 'Non-canceled cases must have an assignee.'";
const OLD = "message: () => 'Cases need an assignee.'";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'ztrack-upgrade-'));
  initTrackerProject(root, 'APP', { preset: 'simple-sdlc' });
  return root;
}

describe('ztrack preset upgrade (3-way merge)', () => {
  test('init records a pristine base alongside the entrypoint', () => {
    const root = tempProject();
    try {
      expect(existsSync(trackerValidationEntrypointPath(root))).toBe(true);
      expect(existsSync(trackerValidationBasePath(root))).toBe(true);
      expect(readFileSync(trackerValidationBasePath(root), 'utf8')).toBe(readFileSync(trackerValidationEntrypointPath(root), 'utf8'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('no-op when the base already matches the bundled template', () => {
    const root = tempProject();
    try {
      expect(upgradeTrackerPreset(root).status).toBe('up-to-date');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('cleanly merges an upstream change while preserving a local edit', () => {
    const root = tempProject();
    try {
      const ep = trackerValidationEntrypointPath(root);
      const bp = trackerValidationBasePath(root);
      const current = readFileSync(ep, 'utf8');
      expect(current).toContain(NEW); // sanity: current template has the new form

      // simulate having installed an OLDER version: base + our file carried OLD.
      const old = current.replace(NEW, OLD);
      writeFileSync(bp, old);
      // local edit (non-overlapping): append a project-owned rule record.
      const ours = `${old}\nmodule.exports.rules.push(rule({ code: 'custom_demo', select: (m) => m.issues, message: () => 'x' }));\n`;
      writeFileSync(ep, ours);

      const r = upgradeTrackerPreset(root);
      expect(r.status).toBe('updated');
      expect(r.conflicts).toBe(0);

      const merged = readFileSync(ep, 'utf8');
      expect(merged).toContain(NEW);           // upstream change applied
      expect(merged).not.toContain(OLD);
      expect(merged).toContain('custom_demo'); // local edit preserved
      expect(readFileSync(bp, 'utf8')).toContain(NEW); // base advanced to upstream
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('marks conflicts when local and upstream edited the same line', () => {
    const root = tempProject();
    try {
      const ep = trackerValidationEntrypointPath(root);
      const bp = trackerValidationBasePath(root);
      const current = readFileSync(ep, 'utf8');
      const old = current.replace(NEW, OLD);
      writeFileSync(bp, old);                                       // base: OLD
      writeFileSync(ep, old.replace(OLD, "message: () => 'Assignee required by policy.'")); // ours edited the same line

      const r = upgradeTrackerPreset(root);
      expect(r.status).toBe('conflicts');
      expect(r.conflicts).toBeGreaterThan(0);
      const merged = readFileSync(ep, 'utf8');
      expect(merged).toContain('<<<<<<< your edits');
      expect(merged).toContain('>>>>>>> new upstream');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('reports no-base when the pristine base is absent (pre-feature repo)', () => {
    const root = tempProject();
    try {
      rmSync(trackerValidationBasePath(root));
      expect(upgradeTrackerPreset(root).status).toBe('no-base');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
