// Broken-oracle surfacing: preset-less commands (issue list …) succeed even when the validation
// oracle can't run, which used to leave a tracker looking healthy right up until the first
// `check`/`loop` died (observed in the field: a Node build without type-stripping ran list/import
// fine for a whole session while the entire gate was dead). These tests drive the REAL CLI in a
// REAL init'd tracker and assert the stderr warning fires exactly when the environment is broken
// — and never when it is healthy. The probe itself must stay non-executing (it must not run the
// repo's preset code on read-only commands), which the unit cases pin via oracleUnavailableReason.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oracleUnavailableReason } from './presetRegistry.ts';

const CLI = join(import.meta.dirname, 'cli.ts');

function freshTracker(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-'));
  const init = Bun.spawnSync(['bun', 'run', CLI, 'init'], { cwd: dir });
  expect(init.exitCode).toBe(0);
  return dir;
}

function runIssueList(cwd: string): { exitCode: number; stderr: string } {
  const proc = Bun.spawnSync(['bun', 'run', CLI, 'issue', 'list'], { cwd });
  return { exitCode: proc.exitCode, stderr: proc.stderr.toString() };
}

describe('broken-oracle surfacing (issue list still works, but says the gate is dead)', () => {
  test('healthy tracker: no oracle warning on issue list', () => {
    const dir = freshTracker();
    // make ztrack resolvable from the project, as a real `npm i -D ztrack` install would
    mkdirSync(join(dir, 'node_modules', 'ztrack'), { recursive: true });
    const { exitCode, stderr } = runIssueList(dir);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('validation oracle');
  });

  test('missing entrypoint: issue list succeeds AND warns that check/loop are dead', () => {
    const dir = freshTracker();
    mkdirSync(join(dir, 'node_modules', 'ztrack'), { recursive: true });
    rmSync(join(dir, '.volter', 'tracker', 'validation', 'preset.mts'));
    const { exitCode, stderr } = runIssueList(dir);
    expect(exitCode).toBe(0); // the command itself still works — the warning must not break it
    expect(stderr).toContain('validation oracle cannot run here');
    expect(stderr).toContain('missing');
  });

  test('ztrack not installed as a dependency: the warning names the npm install fix', () => {
    const dir = freshTracker(); // tmpdir has no node_modules/ztrack anywhere up its walk
    const { exitCode, stderr } = runIssueList(dir);
    expect(exitCode).toBe(0);
    expect(stderr).toContain('validation oracle cannot run here');
    expect(stderr).toContain('npm install -D ztrack');
  });

  test('no tracker at all: no probe, no warning, command errors its own way', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oracle-none-'));
    const { stderr } = runIssueList(dir);
    expect(stderr).not.toContain('validation oracle');
  });
});

describe('oracleUnavailableReason (the non-executing probe)', () => {
  test('is null with no tracker config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oracle-unit-'));
    expect(oracleUnavailableReason(dir)).toBeNull();
  });

  test('names a missing entrypoint without ever importing anything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oracle-unit-'));
    mkdirSync(join(dir, '.volter'), { recursive: true });
    writeFileSync(join(dir, '.volter', 'tracker-config.json'), JSON.stringify({
      backend: 'markdown', local: { teamKey: 'T' },
      validation: { entrypoint: '.volter/tracker/validation/preset.mts' },
    }));
    expect(oracleUnavailableReason(dir)).toContain('missing');
  });

  test('a preset that would CRASH on import is never executed by the probe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oracle-unit-'));
    mkdirSync(join(dir, '.volter', 'tracker', 'validation'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'ztrack'), { recursive: true });
    writeFileSync(join(dir, '.volter', 'tracker-config.json'), JSON.stringify({
      backend: 'markdown', local: { teamKey: 'T' },
      validation: { entrypoint: '.volter/tracker/validation/preset.mts' },
    }));
    // A booby-trapped preset: if the probe executed it, it would throw synchronously at import.
    writeFileSync(join(dir, '.volter', 'tracker', 'validation', 'preset.mts'),
      'throw new Error("the oracle probe must never execute preset code");\n');
    expect(oracleUnavailableReason(dir)).toBeNull(); // environment looks fine; execution is check's job
  });
});
