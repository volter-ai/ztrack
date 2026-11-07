import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TrackerConfig } from './types.ts';
import { parseTrackerConfig, type RawTrackerConfig } from './configSchema.ts';

/**
 * Name of the per-project state directory holding tracker config and data
 * (`<root>/<stateDir>/tracker-config.json`, database, …). Defaults to
 * `.volter`; hosts that need a different directory set VOLTER_STATE_DIR.
 * Every path in this package must go through these helpers, never the
 * literal.
 */
export function stateDirName(): string {
  return process.env.VOLTER_STATE_DIR || '.volter';
}

export function trackerConfigPath(projectRoot: string): string {
  return join(projectRoot, stateDirName(), 'tracker-config.json');
}

/** Absolute path to the shared `.git` dir — identical for every worktree of a clone — or null
 *  when `projectRoot` isn't in a git repo. Linked-mode machine-local cache lives under it so it's
 *  shared across worktrees and (being inside `.git`) is never committed or pushed. */
const gitCommonDirCache = new Map<string, string | null>();
export function gitCommonDir(projectRoot: string): string | null {
  // Memoized per process: a ztrack command resolves the board store via several config helpers, each of
  // which needs the common dir — without this they'd each spawn `git rev-parse` (3× per backend op).
  const cached = gitCommonDirCache.get(projectRoot);
  if (cached !== undefined) return cached;
  const r = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  const out = r.status !== 0 ? null : ((r.stdout ?? '').trim() || null);
  gitCommonDirCache.set(projectRoot, out);
  return out;
}

/** Is this tracker linked to an external provider? Linked issue data is the provider's truth;
 *  locally it's a per-clone cache, not committed (vs. a local tracker, whose store is committed). */
export function isLinkedTracker(projectRoot: string): boolean {
  try { return !!loadTrackerConfig(projectRoot).sync; } catch { return false; }
}

/** Board scope for a LOCAL tracker (see TrackerConfig.board). `shared` only takes effect for an
 *  unlinked tracker inside a git repo (linked already has one central store; no git → nothing to share). */
export function boardScope(projectRoot: string): 'branch' | 'shared' {
  if (isLinkedTracker(projectRoot)) return 'branch'; // linked already has one central store (the cache)
  let cfg: 'branch' | 'shared' = 'shared'; // DEFAULT: a central, cross-worktree board (opt out with board:'branch')
  try { if (loadTrackerConfig(projectRoot).board === 'branch') cfg = 'branch'; } catch { /* no config → default */ }
  // Shared needs git (the index lives in <git-common-dir>); no git → fall back to the per-dir store.
  return cfg === 'shared' && gitCommonDir(projectRoot) ? 'shared' : 'branch';
}

/** The central board INDEX dir — a folder of symlinks, one per issue, each pointing at the real
 *  committed md in whatever worktree currently owns it. Shared mode only; in branch mode it equals the
 *  committed store, so the index layer is a transparent no-op. Lives inside `.git`, so never committed. */
export function boardIndexDir(projectRoot: string): string {
  if (boardScope(projectRoot) === 'shared') {
    const common = gitCommonDir(projectRoot);
    if (common) return join(common, 'ztrack', 'board');
  }
  return markdownStoreDir(projectRoot);
}

/** The MAIN (trunk) worktree's committed issue store — the read fallback when an index symlink dangles
 *  (its worktree was removed: the truth is now on trunk post-merge, or the issue is gone). Null without git. */
export function mainWorktreeMarkdownDir(projectRoot: string): string | null {
  const common = gitCommonDir(projectRoot);
  return common ? join(dirname(common), stateDirName(), 'tracker', 'markdown') : null;
}

/** Root for machine-local cache (linked issue store, sync state, blobs, evidence staging).
 *  - Linked: `<git-common-dir>/ztrack` — ONE cache shared by every worktree of the clone, never
 *    pushed (it's inside `.git`). A fresh worktree sees the same issues with no per-worktree sync.
 *  - Local (or no git available): the per-worktree `<stateDir>` — the issue store there is
 *    committed and branch-scoped on purpose (work + proof + issue-state merge with the code). */
export function cacheRoot(projectRoot: string): string {
  if (isLinkedTracker(projectRoot)) {
    const common = gitCommonDir(projectRoot);
    if (common) return join(common, 'ztrack');
  }
  return join(projectRoot, stateDirName());
}

/** The markdown issue store — committed `<stateDir>/tracker/markdown` when local, the shared
 *  per-clone `<git-common-dir>/ztrack/tracker/markdown` when linked. Every reader/writer of the
 *  issue store MUST go through this, never the literal path. */
export function markdownStoreDir(projectRoot: string): string { return join(cacheRoot(projectRoot), 'tracker', 'markdown'); }
/** Sync bookkeeping (reconcile base, conflicts, identity bindings) — under the linked cache root. */
export function syncStateDir(projectRoot: string): string { return join(cacheRoot(projectRoot), 'sync'); }
/** Provider connector cache (poll cursors, twin event log) — under the linked cache root. */
export function providerCacheDir(projectRoot: string): string { return join(cacheRoot(projectRoot), 'github'); }

/** The effective evidence store mode (resolves `auto`). `commit` for a local tracker, `attach`
 *  for a linked one — overridable via `config.evidence.store`. */
export function evidenceStore(projectRoot: string): 'commit' | 'attach' | 'external' {
  let cfgStore: string | undefined;
  try { cfgStore = loadTrackerConfig(projectRoot).evidence?.store; } catch { /* no config */ }
  if (cfgStore === 'commit' || cfgStore === 'attach' || cfgStore === 'external') return cfgStore;
  // auto → `commit`: the default everywhere. Committed evidence is offline-verifiable at the cited
  // commit and travels with the code — the strongest model. `attach` (upload to the linked GitHub
  // release host, cite a URL pinned by digest) is opt-in via `evidence.store` or `evidence add --attach`.
  return 'commit';
}

/** Relevance-anchor enforcement (`config.relevance`). Default `optional` (anchors opt-in, the
 *  non-breaking default everywhere). `required` makes a preset enforce that every passed AC
 *  declares its `paths` anchor — read by the default preset's loadContext and surfaced on the
 *  validation context so its rules can mandate the anchor without re-reading disk. */
export function relevanceMode(projectRoot: string): 'optional' | 'required' {
  try { return loadTrackerConfig(projectRoot).relevance === 'required' ? 'required' : 'optional'; }
  catch { return 'optional'; }
}

/** Directory for evidence files (relative paths cited as `image=`). Default `.volter/evidence`;
 *  committed (not gitignored) when the store mode is `commit`, so it travels and verifies at the
 *  cited commit. */
export function evidenceDir(projectRoot: string): string {
  let dir: string | undefined;
  try { dir = loadTrackerConfig(projectRoot).evidence?.dir; } catch { /* no config */ }
  return join(projectRoot, dir || join(stateDirName(), 'evidence'));
}

export function ensureTrackerGitignore(root: string): void {
  const gitignorePath = resolve(root, '.gitignore');
  const ignoreMarker = '# ztrack (added by ztrack init)';
  const stateDir = stateDirName();
  // The issue store is COMMITTED for a local-only tracker (so clones, CI, and git worktrees see
  // the issues — `ztrack check` in CI must not silently pass an empty tracker, and a per-worktree
  // gate needs the issues present), but IGNORED for a tracker LINKED to GitHub (there the provider
  // is the source of truth and `ztrack sync` repopulates the local cache). The twin/sync runtime
  // (event log, poll cursors, bindings/base/conflicts) is always machine-local cache.
  const linked = (() => { try { return !!loadTrackerConfig(root).sync; } catch { return false; } })();
  const managed = [
    ignoreMarker,
    `${stateDir}/tracker/tracker.sqlite`,
    `${stateDir}/tracker/tracker.sqlite-*`,
    `${stateDir}/tracker/tracker.sqlite.lock`,
    `${stateDir}/tracker/local-store.json`,
    ...(linked ? [`${stateDir}/tracker/markdown/`] : []),
    `${stateDir}/agent-dispatch/`,
    `${stateDir}/github/`,
    `${stateDir}/sync/`,
    `${stateDir}/.ztrack-loop.json`,
    `${stateDir}/.ztrack-loop-iter-*`,
    `${stateDir}/.ztrack-loop-exempt-*`,
    `${stateDir}/.ztrack-loop-capped.json`,
  ];
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (!existing.includes(ignoreMarker)) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(gitignorePath, `${existing}${prefix}${existing ? '\n' : ''}${managed.join('\n')}\n`);
    return;
  }
  const present = new Set(existing.split('\n').map((s) => s.trim()));
  const missing = managed.filter((line) => line !== ignoreMarker && !present.has(line));
  if (missing.length) {
    const prefix = existing.endsWith('\n') ? '' : '\n';
    writeFileSync(gitignorePath, `${existing}${prefix}${missing.join('\n')}\n`);
  }
}

export function projectRootFrom(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(trackerConfigPath(current))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export function loadTrackerConfig(projectRoot = projectRootFrom()): TrackerConfig {
  const configPath = trackerConfigPath(projectRoot);
  if (!existsSync(configPath)) {
    throw new Error(`No tracker config found at ${configPath}. Run 'ztrack init' to create one.`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Tracker config at ${configPath} is not valid JSON: ${(error as Error).message}`);
  }
  // Fail closed on shape: an unrecognized key anywhere in the config (top-level or nested —
  // e.g. `source:` typo'd for `sources:`) used to be silently spread through and ignored. Now
  // it's a config error naming the key and its nearest valid sibling. (ZTB-3) `parseTrackerConfig`
  // returns the validated, typed shape — no unvalidated `as TrackerConfig` cast needed (ZTB-26).
  let raw: RawTrackerConfig;
  try {
    raw = parseTrackerConfig(parsedJson);
  } catch (error) {
    throw new Error(`Tracker config at ${configPath} is invalid:\n  - ${(error as Error).message}`);
  }
  // markdown is the default and only live backend; a config still naming the removed
  // Python `local` backend is preserved verbatim so the client can point the user at
  // `ztrack migrate-local` instead of silently reading an empty store.
  return { ...raw, backend: raw.backend === 'local' ? 'local' : 'markdown' };
}

/**
 * Canonical resolution of the local tracker SQLite path. Every reader
 * (tracker loader/exporter, sync relay, drift audit) must use this — copies
 * with diverging defaults read an empty store and silently stall instead of
 * failing.
 */
export function trackerDatabasePath(projectRoot = projectRootFrom()): string {
  const config = loadTrackerConfig(projectRoot);
  const database = config.local?.database || join(stateDirName(), 'tracker', 'tracker.sqlite');
  return database.startsWith('/') ? database : resolve(projectRoot, database);
}

export function loadEnvFiles(projectRoot: string): void {
  for (const envPath of [join(projectRoot, '.env'), join(projectRoot, stateDirName(), 'secrets.env')]) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      process.env[key.trim()] ??= rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  }
}
