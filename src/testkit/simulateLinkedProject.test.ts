// Regression guard for the LINKED (real GitHub) development simulation. Gated behind
// ZTRACK_GITHUB_E2E (it creates + deletes a real repo and needs gh auth with repo+delete_repo),
// like the other live GitHub e2es. Runs a small instance; the documented full run is
// SIM_FEATURES=25. Proves the real-GitHub sync round-trip holds: pull at scale, develop+push so
// GitHub reflects the work, the adversarial gate still catches fakes, and a settled re-sync is
// idempotent.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ENABLED = process.env.ZTRACK_GITHUB_E2E === '1';
const suite = ENABLED ? describe : describe.skip;

suite('linked development simulation (real GitHub)', () => {
  test('pull → develop+push (GitHub reflects) → gate catches fakes → idempotent re-sync', () => {
    const r = spawnSync('bun', ['run', join(import.meta.dir, 'simulateLinkedProject.ts')], {
      cwd: join(import.meta.dir, '..', '..'),
      env: { ...process.env, SIM_FEATURES: '4' },
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(out, out).toMatch(/LINKED SIMULATION PASSED/);
    expect(r.status).toBe(0);
  }, 300_000);
});
