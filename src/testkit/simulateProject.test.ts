// Regression guard for the full-scale development simulation (see simulateProject.ts). Runs a
// SMALL instance in CI; the documented full run is `SIM_FEATURES=25 SIM_STREAMS=4`. It proves
// ztrack's core guarantee end to end at scale: across parallel worktrees, every attempted FAKE
// completion (adversarial cheat corpus) is caught and every real completion passes — and the
// finished project verifies green. A fake slipping through here is a critical ztrack failure.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

describe('project development simulation (parallel, adversarial)', () => {
  test('every fake is caught, every real passes, the project verifies green', () => {
    const r = spawnSync('bun', ['run', join(import.meta.dir, 'simulateProject.ts')], {
      cwd: join(import.meta.dir, '..', '..'),
      env: { ...process.env, SIM_FEATURES: '6', SIM_STREAMS: '2' },
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(out, out).toMatch(/SIMULATION PASSED/);
    expect(r.status).toBe(0);
  }, 180_000);
});
