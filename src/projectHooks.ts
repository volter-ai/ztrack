import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { optionValue } from './cliArgs.ts';
import { commandSpecFor } from './cliRegistry.ts';
import { gitCommonDir } from './config.ts';

export const PROJECT_HOOKS_SCHEMA = 'ztrack.project-hooks.v1' as const;
export const PROJECT_HOOK_EVENT = 'project:invoke' as const;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 15_000;
const MAX_HOOKS = 16;

export interface ProjectHook {
  id: string;
  event: typeof PROJECT_HOOK_EVENT;
  executable: string;
  args: string[];
  timeoutMs: number;
}

export interface ProjectHookRegistry {
  schema: typeof PROJECT_HOOKS_SCHEMA;
  hooks: ProjectHook[];
}

export interface ProjectHookRunResult {
  attempted: number;
  warnings: string[];
}

function hookHome(projectRoot: string): string {
  const root = realpathSync(resolve(projectRoot));
  const commonDir = gitCommonDir(root);
  if (!commonDir) throw new Error('project hooks require a Git repository');
  return join(realpathSync(commonDir), 'ztrack');
}

/** Machine-local registry shared by every worktree of one clone. */
export function projectHookRegistryPath(projectRoot: string): string {
  return join(hookHome(projectRoot), 'hooks.json');
}

function emptyRegistry(): ProjectHookRegistry {
  return { schema: PROJECT_HOOKS_SCHEMA, hooks: [] };
}

function validateHook(value: unknown): ProjectHook {
  if (!value || typeof value !== 'object') throw new Error('hook must be an object');
  const hook = value as Partial<ProjectHook>;
  if (typeof hook.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(hook.id)) {
    throw new Error('hook id must contain 1-128 letters, numbers, dots, underscores, or hyphens');
  }
  if (hook.event !== PROJECT_HOOK_EVENT) throw new Error(`unsupported hook event ${JSON.stringify(hook.event)}`);
  if (typeof hook.executable !== 'string' || !isAbsolute(hook.executable)) {
    throw new Error(`hook ${hook.id} executable must be an absolute path`);
  }
  if (!Array.isArray(hook.args) || !hook.args.every((arg) => typeof arg === 'string')) {
    throw new Error(`hook ${hook.id} args must be an array of strings`);
  }
  if (!Number.isInteger(hook.timeoutMs) || hook.timeoutMs! < 100 || hook.timeoutMs! > MAX_TIMEOUT_MS) {
    throw new Error(`hook ${hook.id} timeoutMs must be an integer from 100 to ${MAX_TIMEOUT_MS}`);
  }
  return hook as ProjectHook;
}

export function readProjectHooks(projectRoot: string): ProjectHookRegistry {
  const path = projectHookRegistryPath(projectRoot);
  if (!existsSync(path)) return emptyRegistry();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`invalid project hook registry at ${path}: ${(error as Error).message}`);
  }
  const registry = parsed as Partial<ProjectHookRegistry>;
  if (registry.schema !== PROJECT_HOOKS_SCHEMA || !Array.isArray(registry.hooks)) {
    throw new Error(`invalid project hook registry at ${path}: expected schema ${PROJECT_HOOKS_SCHEMA}`);
  }
  if (registry.hooks.length > MAX_HOOKS) {
    throw new Error(`invalid project hook registry at ${path}: at most ${MAX_HOOKS} hooks are supported`);
  }
  const hooks = registry.hooks.map(validateHook);
  if (new Set(hooks.map((hook) => hook.id)).size !== hooks.length) {
    throw new Error(`invalid project hook registry at ${path}: hook ids must be unique`);
  }
  return { schema: PROJECT_HOOKS_SCHEMA, hooks };
}

function writeProjectHooks(projectRoot: string, registry: ProjectHookRegistry): void {
  const path = projectHookRegistryPath(projectRoot);
  if (!registry.hooks.length) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(path), 0o700); } catch { /* best effort on non-POSIX filesystems */ }
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  try { chmodSync(path, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
}

export function registerProjectHook(projectRoot: string, hook: ProjectHook): 'registered' | 'updated' {
  const checked = validateHook(hook);
  const executable = realpathSync(checked.executable);
  if (!statSync(executable).isFile()) throw new Error(`hook executable is not a file: ${checked.executable}`);
  const registry = readProjectHooks(projectRoot);
  const index = registry.hooks.findIndex((existing) => existing.id === checked.id);
  const stored = { ...checked, executable };
  const action = index < 0 ? 'registered' : 'updated';
  if (index < 0) registry.hooks.push(stored);
  else registry.hooks[index] = stored;
  if (registry.hooks.length > MAX_HOOKS) throw new Error(`at most ${MAX_HOOKS} project hooks may be registered`);
  writeProjectHooks(projectRoot, registry);
  return action;
}

export function removeProjectHook(projectRoot: string, id: string): boolean {
  const registry = readProjectHooks(projectRoot);
  const hooks = registry.hooks.filter((hook) => hook.id !== id);
  if (hooks.length === registry.hooks.length) return false;
  writeProjectHooks(projectRoot, { schema: PROJECT_HOOKS_SCHEMA, hooks });
  return true;
}

function shortDetail(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 500);
}

/**
 * Invoke explicit machine-local hooks without a shell. Hook failures are returned as warnings:
 * an optional integration must never change the ztrack command's result.
 */
export function runProjectHooks(
  projectRoot: string,
  commandArgs: string[],
  event: typeof PROJECT_HOOK_EVENT = PROJECT_HOOK_EVENT,
): ProjectHookRunResult {
  try {
    if (!gitCommonDir(realpathSync(resolve(projectRoot)))) return { attempted: 0, warnings: [] };
  } catch {
    return { attempted: 0, warnings: [] };
  }
  let registry: ProjectHookRegistry;
  try {
    registry = readProjectHooks(projectRoot);
  } catch (error) {
    return { attempted: 0, warnings: [(error as Error).message] };
  }
  const hooks = registry.hooks.filter((hook) => hook.event === event);
  const warnings: string[] = [];
  for (const hook of hooks) {
    const result = spawnSync(hook.executable, hook.args, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: hook.timeoutMs,
      maxBuffer: 128 * 1024,
      env: {
        ...process.env,
        ZTRACK_HOOK_EVENT: event,
        ZTRACK_PROJECT_ROOT: projectRoot,
        ZTRACK_COMMAND_JSON: JSON.stringify(commandArgs),
      },
    });
    if (result.status === 0 && !result.error) continue;
    const detail = shortDetail(result.error?.message || result.stderr || `exited ${result.status ?? 'without a status'}`);
    warnings.push(`project hook ${hook.id} failed: ${detail}`);
  }
  return { attempted: hooks.length, warnings };
}

export function shouldRunProjectHooks(args: string[]): boolean {
  const [resource] = args;
  if (!resource || ['help', 'completions', 'hooks', 'init', 'migrate-local'].includes(resource)) return false;
  if (args.some((arg) => arg === '--help' || arg === '-h' || arg === 'help')) return false;
  if (resource === 'check' && args.slice(1).some((arg) => arg.endsWith('.md'))) return false;
  return commandSpecFor(args) !== undefined;
}

function commandVector(args: string[]): string[] {
  const delimiter = args.indexOf('--');
  return delimiter < 0 ? [] : args.slice(delimiter + 1);
}

export function handleProjectHooksCommand(args: string[], projectRoot: string, command = 'ztrack'): boolean {
  if (args[0] !== 'hooks') return false;
  const action = args[1];
  if (!action || ['--help', '-h', 'help'].includes(action)) {
    process.stdout.write(
      `Usage: ${command} hooks <add|remove|list>\n\n` +
      `  ${command} hooks add --event ${PROJECT_HOOK_EVENT} --id <id> [--timeout-ms <100-${MAX_TIMEOUT_MS}>] -- <absolute-executable> [args...]\n` +
      `  ${command} hooks remove <id>\n` +
      `  ${command} hooks list [--json]\n\n` +
      `Hooks are explicit machine-local integrations stored under Git's common directory. ` +
      `They run without a shell and cannot be enabled by committed repository files.\n`,
    );
    return true;
  }
  if (action === 'add') {
    const delimiter = args.indexOf('--');
    const registrationArgs = delimiter < 0 ? args : args.slice(0, delimiter);
    const id = optionValue(registrationArgs, '--id');
    const event = optionValue(registrationArgs, '--event');
    const vector = commandVector(args);
    const timeoutMs = Number(optionValue(registrationArgs, '--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
    if (!id || event !== PROJECT_HOOK_EVENT || !vector.length) {
      throw new Error(
        `${command} hooks add: usage: ${command} hooks add --event ${PROJECT_HOOK_EVENT} ` +
        `--id <id> [--timeout-ms <100-${MAX_TIMEOUT_MS}>] -- <absolute-executable> [args...]`,
      );
    }
    const result = registerProjectHook(projectRoot, {
      id,
      event: PROJECT_HOOK_EVENT,
      executable: vector[0]!,
      args: vector.slice(1),
      timeoutMs,
    });
    process.stdout.write(`${result} project hook ${id} (${PROJECT_HOOK_EVENT})\n`);
    return true;
  }
  if (action === 'remove') {
    const id = args[2];
    if (!id) throw new Error(`${command} hooks remove: requires a hook id`);
    const removed = removeProjectHook(projectRoot, id);
    process.stdout.write(`${removed ? 'removed' : 'not registered'} project hook ${id}\n`);
    return true;
  }
  if (action === 'list') {
    const registry = readProjectHooks(projectRoot);
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify(registry, null, 2)}\n`);
    else if (!registry.hooks.length) process.stdout.write('No project hooks registered.\n');
    else {
      for (const hook of registry.hooks) {
        process.stdout.write(`${hook.id}\t${hook.event}\t${hook.executable}\t${hook.timeoutMs}ms\n`);
      }
    }
    return true;
  }
  throw new Error(`${command} hooks: unknown action '${action}'. Try '${command} hooks --help'.`);
}
