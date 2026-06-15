import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TrackerConfig } from './types.ts';

/**
 * The Python storage backend ships inside this package; its location is an
 * implementation detail. Every spawner (local backend, sync relay, ingress
 * reflection) must resolve it through here, never via a repo-relative path.
 */
export function trackerBackendScriptPath(): string {
  return fileURLToPath(new URL('../backend/tracker-local.py', import.meta.url));
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

/**
 * Initialize a tracker project: write the local backend config, install the
 * generic validation preset, and add a managed .gitignore block. Idempotent and
 * shared by `tracker init` and the tracker_init MCP tool so an MCP-only agent
 * can bootstrap a fresh repo without the CLI.
 */
export function initTrackerProject(root: string, teamKey = 'LOCAL'): { configPath: string; alreadyInitialized: boolean; teamKey: string } {
  const configPath = trackerConfigPath(root);
  if (existsSync(configPath)) return { configPath, alreadyInitialized: true, teamKey };
  const key = teamKey.toUpperCase();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({
    backend: 'local',
    local: { teamKey: key },
    organization: {
      validationPreset: 'generic',
      check: { categories: { sourced: 1, code: 2 } },
    },
  }, null, 2)}\n`);
  const gitignorePath = resolve(root, '.gitignore');
  const ignoreMarker = '# ztrack (added by ztrack init)';
  const ignoreBlock = [ignoreMarker, '.volter/tracker/', 'node_modules/', 'bun.lock', ''].join('\n');
  const existingIgnore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (!existingIgnore.includes(ignoreMarker)) {
    const prefix = existingIgnore && !existingIgnore.endsWith('\n') ? '\n' : '';
    writeFileSync(gitignorePath, `${existingIgnore}${prefix}${existingIgnore ? '\n' : ''}${ignoreBlock}`);
  }
  return { configPath, alreadyInitialized: false, teamKey: key };
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
    throw new Error(`No tracker config found at ${configPath}. Run 'tracker init' to create one.`);
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<TrackerConfig>;
  return { ...raw, backend: raw.backend === 'markdown' ? 'markdown' : 'local' };
}

/**
 * Canonical resolution of the local tracker SQLite path. Every reader
 * (tracker snapshot exporter, sync relay, drift audit) must use this — copies
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
