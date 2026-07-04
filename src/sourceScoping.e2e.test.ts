// ZTB-33 e2e: `--source` scoping — a real black-box CLI drive (spawns `bun run cli.ts`, same style
// as sourcesConfig.e2e.test.ts). Two declared issue-per-file sources, one NAMED (`alpha` at path
// `store-a`) and one UNNAMED (`store-b`, addressable by its path/basename). We prove, end to end:
//   - `issue list` unions both sources and the selectable `source` field reports each row's name;
//   - `issue list --source <sel>` scopes by name, by path-basename, and unions repeated selectors;
//   - an unknown `--source` fails loudly, listing the available names (never a silent empty result);
//   - `ztrack check --source <sel>` scopes validation — a finding that lives in an EXCLUDED source
//     is absent when scoped away and present when unscoped / scoped to its own source;
//   - `--source` on the `--actionable/--blocked` frontier is rejected (the frontier is whole-graph).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const runIn = (cwd: string, cmd: string, args: string[]) => spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const gitIn = (cwd: string, ...a: string[]) => runIn(cwd, 'git', a);
const ztIn = (cwd: string, ...a: string[]) => { const r = runIn(cwd, 'bun', ['run', CLI, ...a]); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const configPath = (root: string) => join(root, '.volter', 'tracker-config.json');
const setSources = (root: string, sources: Array<{ path: string; name?: string; readonly?: boolean }>) => {
  const cfg = JSON.parse(readFileSync(configPath(root), 'utf8')) as Record<string, unknown>;
  cfg.sources = sources;
  writeFileSync(configPath(root), `${JSON.stringify(cfg, null, 2)}\n`);
};
// A clean issue: one PENDING AC on a draft issue — no gating finding.
const pendingBody = (title: string) => `Summary: ${title}\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 ${title} works.\n  - status: pending\n`;
// A defective issue: a PASSED AC with no evidence — fires `passed_ac_missing_evidence`, scoped to
// whichever source holds it.
const passedNoEvidenceBody = (title: string) => `Summary: ${title}\n\n## Acceptance Criteria\n\n- [x] dev/01 v1 ${title} done.\n  - status: passed\n`;
const idOf = (out: string): string => /\b([A-Z]+-\d+)\b/.exec(out)?.[1] ?? `NO_ID: ${out}`;
const rows = (out: string) => JSON.parse(out) as Array<Record<string, string>>;

let root = '';
let idAlpha = ''; // clean, lives in `store-a` (name `alpha`)
let idBeta = '';  // defective (passed-no-evidence), lives in `store-b` (unnamed)

describe('`--source` scoping (ZTB-33): list/check by source name, basename, and the frontier guard', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-srcscope-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    gitIn(root, 'init', '-q'); gitIn(root, 'config', 'user.email', 't@t.co'); gitIn(root, 'config', 'user.name', 't');
    expect(ztIn(root, 'init', '--team', 'APP').code).toBe(0);
    // Two issue-per-file sources: `store-a` carries the friendly name `alpha`; `store-b` is unnamed
    // (addressable by its path `store-b`). Neither is the implicit default store, so no board index.
    setSources(root, [{ path: 'store-a', name: 'alpha' }, { path: 'store-b' }]);

    // APP-1 (clean) mints into the first writable source, store-a/alpha.
    const fa = join(root, 'alpha.md'); writeFileSync(fa, pendingBody('Alpha'));
    const ca = ztIn(root, 'issue', 'create', '--title', 'Alpha', '--state', 'draft', '--body-file', fa);
    expect(ca.code).toBe(0); idAlpha = idOf(ca.out);

    // APP-2 (defective) must land in store-b — reorder so store-b is first-writable, create, restore.
    setSources(root, [{ path: 'store-b' }, { path: 'store-a', name: 'alpha' }]);
    const fb = join(root, 'beta.md'); writeFileSync(fb, passedNoEvidenceBody('Beta'));
    const cb = ztIn(root, 'issue', 'create', '--title', 'Beta', '--state', 'draft', '--body-file', fb);
    expect(cb.code).toBe(0); idBeta = idOf(cb.out);
    setSources(root, [{ path: 'store-a', name: 'alpha' }, { path: 'store-b' }]); // restore declared order

    // Sanity: they really landed in different dirs.
    expect(() => readFileSync(join(root, 'store-a', `${idAlpha}.md`), 'utf8')).not.toThrow();
    expect(() => readFileSync(join(root, 'store-b', `${idBeta}.md`), 'utf8')).not.toThrow();
  }, 60_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('1. `issue list` unions both sources and the `source` field names each row\'s owning source', () => {
    const list = ztIn(root, 'issue', 'list', '--json', 'identifier,source');
    expect(list.code).toBe(0);
    const byId = new Map(rows(list.out).map((r) => [r.identifier, r.source]));
    expect(byId.get(idAlpha)).toBe('alpha');      // named source reports its name
    expect(byId.get(idBeta)).toBe('store-b');     // unnamed source reports its declared path
    expect([...byId.keys()].sort()).toEqual([idAlpha, idBeta].sort());
  });

  test('2. `--source <name>` scopes to that source; `--source <path-basename>` also matches', () => {
    const byName = ztIn(root, 'issue', 'list', '--source', 'alpha', '--json', 'identifier');
    expect(rows(byName.out).map((r) => r.identifier)).toEqual([idAlpha]);
    // store-a's basename is `store-a` — a source with an explicit name is still addressable by path.
    const byBasename = ztIn(root, 'issue', 'list', '--source', 'store-a', '--json', 'identifier');
    expect(rows(byBasename.out).map((r) => r.identifier)).toEqual([idAlpha]);
    const other = ztIn(root, 'issue', 'list', '--source', 'store-b', '--json', 'identifier');
    expect(rows(other.out).map((r) => r.identifier)).toEqual([idBeta]);
  });

  test('3. repeated `--source` unions the named sources', () => {
    const both = ztIn(root, 'issue', 'list', '--source', 'alpha', '--source', 'store-b', '--json', 'identifier');
    expect(rows(both.out).map((r) => r.identifier).sort()).toEqual([idAlpha, idBeta].sort());
  });

  test('4. an unknown `--source` fails loudly, listing the available source names', () => {
    const bad = ztIn(root, 'issue', 'list', '--source', 'nope', '--json', 'identifier');
    expect(bad.code).not.toBe(0);
    expect(bad.out).toContain('no declared source matches');
    expect(bad.out).toContain('alpha');
    expect(bad.out).toContain('store-b');
  });

  test('5. `check --source` scopes validation: the store-b finding is absent when scoped to alpha, present otherwise', () => {
    // Unscoped: the defective APP-2 (passed AC, no evidence) fails the check.
    const unscoped = ztIn(root, 'check');
    expect(unscoped.out).toContain('passed_ac_missing_evidence');
    expect(unscoped.code).not.toBe(0);
    // Scoped to store-b: still fails on the same finding.
    const toBeta = ztIn(root, 'check', '--source', 'store-b');
    expect(toBeta.out).toContain('passed_ac_missing_evidence');
    expect(toBeta.code).not.toBe(0);
    // Scoped to alpha: store-b is excluded, so the finding is gone and the scoped check is green.
    const toAlpha = ztIn(root, 'check', '--source', 'alpha');
    expect(toAlpha.out).not.toContain('passed_ac_missing_evidence');
    expect(toAlpha.code).toBe(0);
  });

  test('6. `check --source` accepts a comma-separated list (both sources) — the finding is present', () => {
    const both = ztIn(root, 'check', '--source', 'alpha,store-b');
    expect(both.out).toContain('passed_ac_missing_evidence');
    expect(both.code).not.toBe(0);
  });

  test('7. an unknown `check --source` fails loudly, listing the available names', () => {
    const bad = ztIn(root, 'check', '--source', 'ghost');
    expect(bad.code).not.toBe(0);
    expect(bad.out).toContain('no declared source matches');
    expect(bad.out).toContain('alpha');
  });

  test('8. `--source` is rejected on the --actionable/--blocked frontier (it is whole-graph)', () => {
    const act = ztIn(root, 'issue', 'list', '--actionable', '--source', 'alpha');
    expect(act.code).not.toBe(0);
    expect(act.out).toContain('--source is not supported on this view');
    const blk = ztIn(root, 'issue', 'list', '--blocked', '--source', 'alpha');
    expect(blk.code).not.toBe(0);
    expect(blk.out).toContain('--source is not supported on this view');
  });
});
