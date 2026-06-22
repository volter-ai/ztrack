import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TrackerConfig } from './types.ts';

/**
 * The Python storage backend ships inside this package; its location is an
 * implementation detail. Every spawner (local backend, sync relay, ingress
 * reflection) must resolve it through here, never via a repo-relative path.
 */
export function trackerBackendScriptPath(): string {
  const candidates = [
    fileURLToPath(new URL('../backend/tracker-local.py', import.meta.url)),
    fileURLToPath(new URL('../../backend/tracker-local.py', import.meta.url)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

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

export type InitTrackerPreset = 'basic' | 'simple-sdlc' | 'simple-spec' | 'speckit';

const INIT_TRACKER_PRESETS = ['basic', 'simple-sdlc', 'simple-spec', 'speckit'] as const;

export function initTrackerPresets(): readonly InitTrackerPreset[] {
  return INIT_TRACKER_PRESETS;
}

export type InitTrackerProjectOptions = {
  preset?: InitTrackerPreset;
};

function presetTemplate(): string {
  return readFileSync(fileURLToPath(new URL('../boilerplates/presets/preset.cjs', import.meta.url)), 'utf8');
}

export function trackerValidationEntrypointPath(projectRoot: string): string {
  return join(projectRoot, stateDirName(), 'tracker', 'validation', 'preset.cjs');
}

// The pristine copy of the installed template, recorded at init so `ztrack preset
// upgrade` can 3-way merge new upstream rules into an edited preset without clobbering
// edits. Committed (not gitignored) so the merge base is reproducible.
export function trackerValidationBasePath(projectRoot: string): string {
  return join(projectRoot, stateDirName(), 'tracker', 'validation', '.preset.base.cjs');
}

function presetBooleans(preset: InitTrackerPreset): Record<string, string> {
  return {
    __ZTRACK_PRESET_NAME__: preset,
    __ZTRACK_REQUIRE_SOURCE_MARKER__: preset === 'basic' ? 'false' : 'true',
    __ZTRACK_REQUIRE_SDLC_GATES__: preset === 'simple-sdlc' ? 'true' : 'false',
    __ZTRACK_REQUIRE_SPEC_SECTIONS__: preset === 'simple-spec' ? 'true' : 'false',
    __ZTRACK_REQUIRE_SPECKIT_SECTIONS__: preset === 'speckit' ? 'true' : 'false',
  };
}

function installedPresetTemplate(preset: InitTrackerPreset): string {
  let text = presetTemplate();
  for (const [token, value] of Object.entries(presetBooleans(preset))) {
    text = text.replaceAll(token, value);
  }
  return text;
}

function installPreset(projectRoot: string, preset: InitTrackerPreset): string {
  const entrypoint = trackerValidationEntrypointPath(projectRoot);
  mkdirSync(dirname(entrypoint), { recursive: true });
  const rendered = `${installedPresetTemplate(preset)}\n`;
  if (!existsSync(entrypoint)) writeFileSync(entrypoint, rendered);
  // record the pristine base for `ztrack preset upgrade`'s 3-way merge.
  const basePath = trackerValidationBasePath(projectRoot);
  if (!existsSync(basePath)) writeFileSync(basePath, rendered);
  return entrypoint;
}

export interface UpgradePresetResult {
  status: 'updated' | 'up-to-date' | 'conflicts' | 'no-base';
  entrypoint: string;
  installedFrom: InitTrackerPreset;
  conflicts: number;
}

// 3-way merge: apply the diff `base` -> `theirs` (new upstream) onto `ours` (the edited
// file), via `git merge-file`. Returns the merged text and conflict count (0 = clean).
function threeWayMerge(ours: string, base: string, theirs: string): { text: string; conflicts: number } {
  const dir = mkdtempSync(join(tmpdir(), 'ztrack-preset-merge-'));
  try {
    const o = join(dir, 'ours'); const b = join(dir, 'base'); const t = join(dir, 'theirs');
    writeFileSync(o, ours); writeFileSync(b, base); writeFileSync(t, theirs);
    const r = spawnSync('git', ['merge-file', '-p', '-L', 'your edits', '-L', 'installed base', '-L', 'new upstream', o, b, t], { encoding: 'utf8' });
    if (r.error) throw new Error(`git merge-file unavailable: ${r.error.message}`);
    const status = r.status ?? 0;
    if (status < 0) throw new Error(`git merge-file failed: ${r.stderr || 'unknown error'}`);
    return { text: r.stdout, conflicts: status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Upgrade the repo-local preset: 3-way merge the current bundled template (for the
 * variant this repo installed) into the edited preset.cjs, preserving local edits.
 * Conflicts are written as `<<<<<<<` markers for a human/agent to resolve. The pristine
 * base advances to the new upstream on a clean OR conflicted merge.
 */
export function upgradeTrackerPreset(projectRoot: string): UpgradePresetResult {
  const config = loadTrackerConfig(projectRoot);
  const installedFrom = config.validation?.installedFrom;
  const entrypoint = trackerValidationEntrypointPath(projectRoot);
  if (!installedFrom || !(INIT_TRACKER_PRESETS as readonly string[]).includes(installedFrom) || !existsSync(entrypoint)) {
    throw new Error("No bundled preset to upgrade from. `ztrack preset upgrade` only applies to a repo init'd with `ztrack init --preset <basic|simple-sdlc|simple-spec|speckit>`.");
  }
  const variant = installedFrom as InitTrackerPreset;
  const basePath = trackerValidationBasePath(projectRoot);
  if (!existsSync(basePath)) return { status: 'no-base', entrypoint, installedFrom: variant, conflicts: 0 };
  const base = readFileSync(basePath, 'utf8');
  const upstream = `${installedPresetTemplate(variant)}\n`;
  if (base === upstream) return { status: 'up-to-date', entrypoint, installedFrom: variant, conflicts: 0 };
  const ours = readFileSync(entrypoint, 'utf8');
  const merged = threeWayMerge(ours, base, upstream);
  writeFileSync(entrypoint, merged.text);
  writeFileSync(basePath, upstream);
  return { status: merged.conflicts > 0 ? 'conflicts' : 'updated', entrypoint, installedFrom: variant, conflicts: merged.conflicts };
}

/**
 * Initialize a tracker project: write the local backend config, install a
 * repo-local validation preset, and add a managed .gitignore block. Idempotent and
 * shared by `ztrack init` and the tracker_init MCP tool so an MCP-only agent
 * can bootstrap a fresh repo without the CLI.
 */
export function initTrackerProject(
  root: string,
  teamKey = 'LOCAL',
  options: InitTrackerProjectOptions = {},
): { configPath: string; alreadyInitialized: boolean; teamKey: string; preset: InitTrackerPreset; validationEntrypoint?: string } {
  const configPath = trackerConfigPath(root);
  const preset = options.preset ?? 'basic';
  if (existsSync(configPath)) return { configPath, alreadyInitialized: true, teamKey, preset };
  const key = teamKey.toUpperCase();
  mkdirSync(dirname(configPath), { recursive: true });
  const validationEntrypoint = installPreset(root, preset);
  const config: TrackerConfig = {
    backend: 'local',
    local: { teamKey: key },
    validation: {
      entrypoint: `${stateDirName()}/tracker/validation/preset.cjs`,
      installedFrom: preset,
    },
    organization: { check: { categories: { sourced: 1, code: 2 } } },
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const gitignorePath = resolve(root, '.gitignore');
  const ignoreMarker = '# ztrack (added by ztrack init)';
  const stateDir = stateDirName();
  const ignoreBlock = [
    ignoreMarker,
    `${stateDir}/tracker/tracker.sqlite`,
    `${stateDir}/tracker/tracker.sqlite-*`,
    `${stateDir}/tracker/tracker.sqlite.lock`,
    `${stateDir}/tracker/local-store.json`,
    `${stateDir}/tracker/markdown/`,
    `${stateDir}/agent-dispatch/`,
    `${stateDir}/.ztrack-loop.json`,
    `${stateDir}/.ztrack-loop-iter-*`,
    `${stateDir}/.ztrack-loop-exempt-*`,
    `${stateDir}/.ztrack-loop-capped.json`,
    '',
  ].join('\n');
  const existingIgnore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (!existingIgnore.includes(ignoreMarker)) {
    const prefix = existingIgnore && !existingIgnore.endsWith('\n') ? '\n' : '';
    writeFileSync(gitignorePath, `${existingIgnore}${prefix}${existingIgnore ? '\n' : ''}${ignoreBlock}`);
  }
  return { configPath, alreadyInitialized: false, teamKey: key, preset, ...(validationEntrypoint ? { validationEntrypoint } : {}) };
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
  let raw: Partial<TrackerConfig>;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<TrackerConfig>;
  } catch (error) {
    throw new Error(`Tracker config at ${configPath} is not valid JSON: ${(error as Error).message}`);
  }
  return { ...raw, backend: raw.backend === 'markdown' ? 'markdown' : 'local' };
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
