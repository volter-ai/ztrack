// ZTB-13: black-box e2e for `ztrack check --preset <path>` — runs the real CLI (no network).
// The action.yml/SECURITY.md "safe path" (`--input --verify-commits`) claimed the repo's
// preset.mts is NOT executed; that was false (it's always loaded via the configured
// `validation.entrypoint`). This suite proves the fix: an operator-supplied `--preset <path>`
// loads instead of the configured entrypoint, unconfined to the project, in every check mode.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');        // src/ -> repo root
const CLI = join(import.meta.dir, 'cli.ts');

function ztrackIn(cwd: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const FAILING_AC = `## Acceptance Criteria

- [x] dev/01 v1 does the thing
  - status: passed
  - evidence ev1: commit=deadbeef acv=1
  - proof: "shows it" -> ev1
`;

function initProjectWithZtrack(dir: string): void {
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(dir, 'node_modules', 'ztrack')); // the installed preset imports 'ztrack/preset-kit'
}

// ── (a) identical gating through --preset and the entrypoint route, both --input and live-tracker ──
describe('check --preset — identical gating to the entrypoint route (ZTB-13 dev/29)', () => {
  let root = '';
  let trustedDir = '';
  let trustedPreset = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-preset-gate-'));
    initProjectWithZtrack(root);
    ztrackIn(root, ['init', '--team', 'ZT']);
    ztrackIn(root, ['issue', 'create', '--title', 'Clean', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# Clean\n\n## Summary\n\nok']); // ZT-1, green
    ztrackIn(root, ['issue', 'create', '--title', 'Bad', '--label', 'type:case', '--state', 'ready', '--assignee', 'me', '--body', FAILING_AC]); // ZT-2, red (fake commit)

    // A trusted copy of the SAME preset, OUTSIDE this project — mirrors the real fork-PR
    // pattern (a base-ref checkout, its own installed 'ztrack', a preset.mts that is a plain
    // copy of the repo's own). It needs its own node_modules/ztrack for 'ztrack/preset-kit' to
    // resolve when Node walks up from ITS location, not the project's.
    trustedDir = mkdtempSync(join(tmpdir(), 'ztrk-preset-trusted-'));
    initProjectWithZtrack(trustedDir);
    const entrypoint = join(root, '.volter', 'tracker', 'validation', 'preset.mts');
    trustedPreset = join(trustedDir, 'preset.mts');
    writeFileSync(trustedPreset, readFileSync(entrypoint, 'utf8'));

    ztrackIn(root, ['export', '--out', 'root.json']);
  });
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (trustedDir) rmSync(trustedDir, { recursive: true, force: true });
  });

  test('live-tracker mode: a clean issue passes identically with and without --preset', () => {
    const withEntrypoint = ztrackIn(root, ['check', 'ZT-1']);
    const withPreset = ztrackIn(root, ['check', 'ZT-1', '--preset', trustedPreset]);
    expect(withEntrypoint.code).toBe(0);
    expect(withPreset.code).toBe(0);
  });

  test('live-tracker mode: a red issue fails identically with and without --preset', () => {
    const withEntrypoint = ztrackIn(root, ['check', 'ZT-2']);
    const withPreset = ztrackIn(root, ['check', 'ZT-2', '--preset', trustedPreset]);
    expect(withEntrypoint.code).not.toBe(0);
    expect(withPreset.code).not.toBe(0);
    expect(withPreset.out).toMatch(/deadbeef/);
  });

  test('--input mode: a committed root gates identically with and without --preset', () => {
    const withEntrypoint = ztrackIn(root, ['check', '--input', 'root.json']);
    const withPreset = ztrackIn(root, ['check', '--input', 'root.json', '--preset', trustedPreset]);
    expect(withEntrypoint.code).not.toBe(0); // ZT-2's fabricated commit fails the whole root
    expect(withPreset.code).toBe(withEntrypoint.code);
    expect(withPreset.out).toMatch(/deadbeef/);
  });

  test('--preset works on a loose-file check too (the third check mode)', () => {
    writeFileSync(join(root, 'loose.md'), `Status: ready\n\n${FAILING_AC}`);
    const withEntrypoint = ztrackIn(root, ['check', './loose.md']);
    const withPreset = ztrackIn(root, ['check', './loose.md', '--preset', trustedPreset]);
    expect(withEntrypoint.code).not.toBe(0);
    expect(withPreset.code).toBe(withEntrypoint.code);
    expect(withPreset.out).toMatch(/deadbeef/);
  });

  // (c) clear errors on bad --preset input.
  test('a nonexistent --preset path fails with a clear error', () => {
    const r = ztrackIn(root, ['check', 'ZT-1', '--preset', './does-not-exist.mts']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/--preset path does not exist/);
  });

  test('a --preset module that is not a core preset fails with a clear error', () => {
    const badPath = join(root, 'not-a-preset.mts');
    writeFileSync(badPath, 'export default { just: "a plain object" };\n');
    const r = ztrackIn(root, ['check', 'ZT-1', '--preset', badPath]);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/is not a core preset/);
  });

  // (d) zero behavior change without the flag: the exact assertions from cliCheckLoop.e2e.test.ts's
  // "check targets" suite, re-run here to pin that adding --preset did not perturb the bare route.
  test('bare check (no --preset) is unaffected: same pass/fail split as always', () => {
    expect(ztrackIn(root, ['check', 'ZT-1']).code).toBe(0);
    expect(ztrackIn(root, ['check', 'ZT-2']).code).not.toBe(0);
  });
});

// ── (b) the configured entrypoint is genuinely NOT imported when --preset is given ──
describe('check --preset — the configured entrypoint is not imported (ZTB-13 dev/29, the sentinel proof)', () => {
  let root = '';
  let trustedPreset = '';
  let sentinelPath = '';
  let entrypointPath = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-preset-sentinel-'));
    initProjectWithZtrack(root);
    ztrackIn(root, ['init', '--team', 'ZT']);
    ztrackIn(root, ['issue', 'create', '--title', 'Clean', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body', '# Clean\n\n## Summary\n\nok']); // ZT-1, green

    entrypointPath = join(root, '.volter', 'tracker', 'validation', 'preset.mts');
    // A trusted preset OUTSIDE the project: a plain copy of the entrypoint's content, taken
    // BEFORE the sentinel side effect is added below.
    const trustedDir = mkdtempSync(join(tmpdir(), 'ztrk-preset-sentinel-trusted-'));
    initProjectWithZtrack(trustedDir);
    trustedPreset = join(trustedDir, 'preset.mts');
    writeFileSync(trustedPreset, readFileSync(entrypointPath, 'utf8'));

    // A validated root, exported BEFORE the sentinel is added (export itself loads the
    // entrypoint, so doing this after would trip the sentinel during setup).
    ztrackIn(root, ['export', '--out', 'root.json']);

    // Now make the CONFIGURED entrypoint write a sentinel file as a top-level side effect at
    // import time, while still exporting a valid preset (the rest of the original module is
    // untouched, so it still validates for real).
    sentinelPath = join(root, 'ENTRYPOINT_WAS_IMPORTED');
    const original = readFileSync(entrypointPath, 'utf8');
    const withSentinel = `import { writeFileSync as __ztb13SentinelWrite } from 'node:fs';\n${original}\n`
      + `__ztb13SentinelWrite(${JSON.stringify(sentinelPath)}, String(Date.now()));\n`;
    writeFileSync(entrypointPath, withSentinel);
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('(i) --input WITHOUT --preset: the documented bug — the sentinel appears', () => {
    if (existsSync(sentinelPath)) unlinkSync(sentinelPath);
    const r = ztrackIn(root, ['check', '--input', 'root.json']);
    expect(existsSync(sentinelPath)).toBe(true); // the configured entrypoint WAS imported and executed
    expect(r.code).toBe(0); // ZT-1 alone is clean, so this also proves the preset still validates for real
  });

  test('(ii) --input WITH --preset <trusted, outside the project>: validates green, sentinel absent', () => {
    if (existsSync(sentinelPath)) unlinkSync(sentinelPath);
    const r = ztrackIn(root, ['check', '--input', 'root.json', '--preset', trustedPreset]);
    expect(r.code).toBe(0);
    expect(existsSync(sentinelPath)).toBe(false); // the configured (sentinel-carrying) entrypoint was never imported
  });

  test('live-tracker mode: --preset also avoids importing the configured entrypoint', () => {
    if (existsSync(sentinelPath)) unlinkSync(sentinelPath);
    const r = ztrackIn(root, ['check', 'ZT-1', '--preset', trustedPreset]);
    expect(r.code).toBe(0);
    expect(existsSync(sentinelPath)).toBe(false);
  });

  test('sanity: without --preset in live-tracker mode too, the sentinel-carrying entrypoint IS imported', () => {
    if (existsSync(sentinelPath)) unlinkSync(sentinelPath);
    const r = ztrackIn(root, ['check', 'ZT-1']);
    expect(r.code).toBe(0);
    expect(existsSync(sentinelPath)).toBe(true);
  });
});
