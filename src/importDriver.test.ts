// ZTB-14 dev/37: the multi-input driver — directory/glob expansion with default excludes,
// batch-wide single-pass id allocation, per-file outcome, whole-batch no-op on re-import, and
// --register (append-only, no duplicates, config byte-untouched without the flag).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { IdAllocator } from './importBacklog.ts';
import { applyRegister, expandInputs, planRegister, resolveIssuePrefix, runImportBatch } from './importDriver.ts';

const FIXTURES = join(import.meta.dirname, 'importBacklog.fixtures');
const MULTI_DIR = join(FIXTURES, 'multi-dir');
const COLLIDE_DIR = join(FIXTURES, 'collide-batch');

const tmpDirs: string[] = [];
function makeTmpCopy(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ztb14-import-'));
  tmpDirs.push(dir);
  // shallow-ish recursive copy via cp -R equivalent using node fs (no shelling out)
  const { cpSync } = require('node:fs');
  cpSync(src, dir, { recursive: true });
  return dir;
}
afterEach(() => { for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('expandInputs — directory / glob expansion with default excludes', () => {
  test('a directory input recursively finds every .md file except node_modules/.volter', () => {
    const files = expandInputs([MULTI_DIR], MULTI_DIR, []).map((f) => f.slice(MULTI_DIR.length + 1));
    expect(files).toEqual(['canonical.md', 'messy.md', 'nothing-importable.md']);
  });

  test('a quoted glob over the same tree excludes the same default paths', () => {
    const files = expandInputs([`${MULTI_DIR}/**/*.md`], MULTI_DIR, []).map((f) => f.slice(MULTI_DIR.length + 1));
    expect(files).toEqual(['canonical.md', 'messy.md', 'nothing-importable.md']);
  });

  test('a single explicit file argument is not excluded even if it looks similar to an excluded name', () => {
    const files = expandInputs([join(MULTI_DIR, 'canonical.md')], MULTI_DIR, []);
    expect(files).toEqual([join(MULTI_DIR, 'canonical.md')]);
  });

  test('a nonexistent literal path throws (not silently empty)', () => {
    expect(() => expandInputs([join(MULTI_DIR, 'nope.md')], MULTI_DIR, [])).toThrow(/no such file/);
  });

  test('an issue-per-file configured source directory is excluded from a directory/glob import', () => {
    const excludeDirs = [join(MULTI_DIR, 'node_modules')]; // simulate a configured issue-per-file source there
    const files = expandInputs([MULTI_DIR], MULTI_DIR, excludeDirs).map((f) => f.slice(MULTI_DIR.length + 1));
    expect(files).not.toContain('node_modules/skip-me.md');
  });
});

describe('runImportBatch — per-file outcome + batch-wide single-pass allocation', () => {
  test('canonical -> noop, messy -> materialized, nothing-importable -> skipped', () => {
    const files = expandInputs([MULTI_DIR], MULTI_DIR, []);
    const allocator = new IdAllocator();
    const outcomes = runImportBatch(files, { allocator, write: false, prefix: 'APP' });
    const byName = new Map(outcomes.map((o) => [o.path.slice(MULTI_DIR.length + 1), o]));
    expect(byName.get('canonical.md')!.kind).toBe('noop');
    expect(byName.get('messy.md')!.kind).toBe('materialized');
    const skipped = byName.get('nothing-importable.md')!;
    expect(skipped.kind).toBe('skipped');
    if (skipped.kind === 'skipped') expect(skipped.reason).toMatch(/nothing importable/);
  });

  test('a fresh file processed BEFORE a file with a pre-existing id never mints that id (mandatory pre-pass)', () => {
    // 1-fresh.md sorts (and processes) first and has no id of its own; 2-existing.md sorts after
    // it but already declares APP-1. Without a whole-batch pre-pass, 1-fresh.md would naively
    // mint APP-1 first (nothing noted yet) and collide with 2-existing.md's own APP-1.
    const dir = join(FIXTURES, 'collide-with-existing');
    const files = expandInputs([dir], dir, []);
    expect(files.map((f) => f.slice(dir.length + 1))).toEqual(['1-fresh.md', '2-existing.md']);
    const outcomes = runImportBatch(files, { allocator: new IdAllocator(), write: false, prefix: 'APP' });
    const fresh = outcomes.find((o) => o.path.endsWith('1-fresh.md'));
    const existing = outcomes.find((o) => o.path.endsWith('2-existing.md'));
    expect(fresh!.kind).toBe('materialized');
    expect(existing!.kind).toBe('noop'); // already canonical — untouched
    if (fresh!.kind === 'materialized') expect(fresh!.plan.issues.map((i) => i.id)).toEqual(['APP-2']);
  });

  test('a batch whose files would collide if allocated per-file mints distinct ids across the whole batch', () => {
    const files = expandInputs([COLLIDE_DIR], COLLIDE_DIR, []);
    const allocator = new IdAllocator();
    const outcomes = runImportBatch(files, { allocator, write: false, prefix: 'APP' });
    const ids = outcomes.flatMap((o) => (o.kind === 'materialized' ? o.plan.issues.map((i) => i.id) : []));
    expect(new Set(ids).size).toBe(ids.length); // no collisions
    expect(ids).toEqual(['APP-1', 'APP-2']); // single-pass, ascending, not both "APP-1"
  });

  test('--dry-run (write:false) never touches disk', () => {
    const tmp = makeTmpCopy(MULTI_DIR);
    const before = readFileSync(join(tmp, 'messy.md'), 'utf8');
    const files = expandInputs([tmp], tmp, []);
    runImportBatch(files, { allocator: new IdAllocator(), write: false, prefix: 'APP' });
    expect(readFileSync(join(tmp, 'messy.md'), 'utf8')).toBe(before);
  });

  test('a real write pass, then re-running the batch, is a whole-batch no-op', () => {
    const tmp = makeTmpCopy(MULTI_DIR);
    const files = expandInputs([tmp], tmp, []);
    const first = runImportBatch(files, { allocator: new IdAllocator(), write: true, prefix: 'APP' });
    expect(first.some((o) => o.kind === 'materialized')).toBe(true);
    const second = runImportBatch(files, { allocator: new IdAllocator(), write: true, prefix: 'APP' });
    for (const o of second) {
      if (o.path.endsWith('nothing-importable.md')) { expect(o.kind).toBe('skipped'); continue; }
      expect(o.kind).toBe('noop');
    }
  });
});

describe('resolveIssuePrefix — --prefix, else infer from the file, else teamKey, else null', () => {
  test('an explicit --prefix always wins', () => {
    expect(resolveIssuePrefix('## APP-1 x\n', 'OTHER', 'TEAM')).toBe('OTHER');
  });
  test('inferred from an id token already in the file when no --prefix is given', () => {
    expect(resolveIssuePrefix('## APP-1 x\n\nmore text APP-9\n', undefined, 'TEAM')).toBe('APP');
  });
  test('inference reads HEADINGS ONLY — a hyphenated prose word never shadows the teamKey', () => {
    // Regression: an any-line fallback matched ordinary hyphenated words ("Follow-up", "Sign-off",
    // "Check-in"), so this exact preamble minted `Follow-1` instead of using the configured team.
    const text = 'Follow-up items are tracked below.\n\n## Auth work\n\n- [ ] add login\n';
    expect(resolveIssuePrefix(text, undefined, 'APP')).toBe('APP');
    expect(resolveIssuePrefix('Sign-off pending.\n\n## Work\n', undefined, 'APP')).toBe('APP');
    // ...and with no teamKey either, it's null (a clear error asking for --prefix), never "Follow".
    expect(resolveIssuePrefix(text, undefined, undefined)).toBeNull();
  });
  test('falls back to the configured teamKey when nothing else resolves', () => {
    expect(resolveIssuePrefix('## Freeform heading\n', undefined, 'TEAM')).toBe('TEAM');
  });
  test('null when nothing resolves — caller reports a clear error asking for --prefix', () => {
    expect(resolveIssuePrefix('## Freeform heading\n', undefined, undefined)).toBeNull();
  });
});

describe('--register: appends exactly the printed sources entries, never duplicates, never mutates without the flag', () => {
  test('planRegister proposes one entry per NEW file, skipping one already declared', () => {
    const projectRoot = MULTI_DIR;
    const config = { sources: [{ path: 'canonical.md', format: 'document' as const }] };
    const toAdd = planRegister(projectRoot, config, [join(MULTI_DIR, 'canonical.md'), join(MULTI_DIR, 'messy.md')]);
    expect(toAdd).toEqual([{ path: 'messy.md', format: 'document' }]);
  });

  test('when config.sources is absent, planRegister ALSO declares the pre-existing implicit default store — registering a new source must never silently stop the tracker reading it', () => {
    const projectRoot = MULTI_DIR;
    const toAdd = planRegister(projectRoot, {}, [join(MULTI_DIR, 'messy.md')]);
    expect(toAdd[0]).toEqual({ path: '.volter/tracker/markdown' }); // the default, format omitted (inferred issue-per-file)
    expect(toAdd[1]).toEqual({ path: 'messy.md', format: 'document' });
    expect(toAdd).toHaveLength(2);
  });

  test('applyRegister appends to sources without touching any other config key, and is idempotent on the same input', () => {
    const tmp = makeTmpCopy(MULTI_DIR);
    const configPath = join(tmp, 'tracker-config.json');
    writeFileSync(configPath, `${JSON.stringify({ backend: 'markdown', local: { teamKey: 'APP' } }, null, 2)}\n`);
    const before = readFileSync(configPath, 'utf8');
    applyRegister(configPath, []); // no entries to add -> byte-untouched
    expect(readFileSync(configPath, 'utf8')).toBe(before);

    applyRegister(configPath, [{ path: 'messy.md', format: 'document' }]);
    const after = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(after.sources).toEqual([{ path: 'messy.md', format: 'document' }]);
    expect(after.local).toEqual({ teamKey: 'APP' }); // untouched

    // Re-planning against the now-updated config proposes nothing further for the same file.
    const toAddAgain = planRegister(tmp, after, [join(tmp, 'messy.md')]);
    expect(toAddAgain).toEqual([]);
  });

  test('without --register (i.e. applyRegister never called), the config file is untouched — verified at the CLI layer (cliImport.test.ts)', () => {
    expect(existsSync(join(MULTI_DIR, 'tracker-config.json'))).toBe(false); // no config was ever written into the fixture dir
  });

  // ZTB-26 dev/03: applyRegister used to `JSON.parse(...) as TrackerConfig` with no validation,
  // so a malformed config was blindly rewritten (sources appended on top of garbage). It now
  // validates through the same schema loadTrackerConfig does, so a malformed config fails loudly
  // and — critically — the file is left byte-untouched rather than partially rewritten.
  test('applyRegister refuses to rewrite a malformed (schema-invalid) config, leaving it byte-untouched', () => {
    const tmp = makeTmpCopy(MULTI_DIR);
    const configPath = join(tmp, 'tracker-config.json');
    const malformed = `${JSON.stringify({ backend: 'markdown', source: [{ path: 'x' }] }, null, 2)}\n`; // typo'd "source"
    writeFileSync(configPath, malformed);
    expect(() => applyRegister(configPath, [{ path: 'messy.md', format: 'document' }])).toThrow(/unknown key "source"/);
    expect(readFileSync(configPath, 'utf8')).toBe(malformed); // untouched, not partially rewritten
  });

  test('applyRegister refuses to rewrite a config that is not valid JSON, leaving it byte-untouched', () => {
    const tmp = makeTmpCopy(MULTI_DIR);
    const configPath = join(tmp, 'tracker-config.json');
    const notJson = '{ this is not json';
    writeFileSync(configPath, notJson);
    expect(() => applyRegister(configPath, [{ path: 'messy.md', format: 'document' }])).toThrow(/not valid JSON/);
    expect(readFileSync(configPath, 'utf8')).toBe(notJson);
  });
});
