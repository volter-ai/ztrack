// ZTB-14: `ztrack import <path-or-glob>...` CLI wiring — a separate front door onto the strict
// document-source grammar (src/documentParser.ts et al. are UNTOUCHED). All the actual planning/
// materializing/multi-input logic lives in src/importBacklog.ts and src/importDriver.ts; this
// module is flag parsing + terminal rendering only, following the existing verb-module pattern
// (cliCheck.ts / cliWaiver.ts / cliLoop.ts).
import { relative } from 'node:path';
import { optionValue } from './cliArgs.ts';
import { positionalArgs } from './cliTarget.ts';
import { loadTrackerConfig, projectRootFrom, trackerConfigPath } from './config.ts';
import type { ImportPlan } from './importBacklog.ts';
import { IdAllocator } from './importBacklog.ts';
import {
  applyRegister, collectConfiguredIds, expandInputs, issuePerFileSourceDirs, planRegister, runImportBatch,
  type FileOutcome,
} from './importDriver.ts';
import { statusMark, ui } from './cliStyle.ts';
import type { TrackerConfig } from './types.ts';

const VALUE_FLAGS = new Set(['--prefix']);
const KNOWN_FLAGS = new Set(['--prefix', '--dry-run', '--register']);

const USAGE = 'Usage: ztrack import <path-or-glob>... [--dry-run] [--prefix <ID-PREFIX>] [--register]\n\n' +
  'Materializes a freeform/mixed-markdown backlog (headings, prose, checkboxes, TODO: lines) into\n' +
  "the strict document-source grammar, IN PLACE, idempotently. <path-or-glob> is one or more of a\n" +
  ".md file, a directory (recursive), or a quoted glob (e.g. \"notes/**/backlog*.md\"). Default\n" +
  'excludes for directory/glob inputs: node_modules, .volter, and any configured issue-per-file\n' +
  'source directory.\n' +
  '  --dry-run          print the planned issue tree + diff for every file; write nothing.\n' +
  '  --prefix <PREFIX>  the issue-id prefix to mint (e.g. APP). Else inferred from an id already\n' +
  '                     in the file, else the tracker config teamKey, else an error.\n' +
  '  --register         append the resulting sources entries to tracker-config.json (only\n' +
  '                     appends; never mutates config without this flag — the exact snippet is\n' +
  '                     printed either way).\n' +
  'Pre-checked `- [x]` items import as UNCHECKED, with a preserved-claim marker and a report\n' +
  '(ztrack check rejects a checked AC with no evidence — a materialized file must check green).\n' +
  'See docs/SOURCES.md -> "Importing a freeform backlog".\n';

function planTreeLines(plan: ImportPlan): string[] {
  const byId = new Map(plan.issues.map((i) => [i.id, i]));
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const issue of plan.issues) {
    if (issue.parentId && byId.has(issue.parentId)) childrenOf.set(issue.parentId, [...(childrenOf.get(issue.parentId) ?? []), issue.id]);
    else roots.push(issue.id);
  }
  const lines: string[] = [];
  const render = (id: string, depth: number) => {
    const issue = byId.get(id)!;
    const tag = issue.status === 'existing' ? ui.dim('(existing)') : ui.green('(new)');
    const acCount = issue.acs.length ? ui.dim(` — ${issue.acs.length} AC${issue.acs.length === 1 ? '' : 's'}`) : '';
    lines.push(`${'  '.repeat(depth)}${ui.cyan(id)} ${issue.title} ${tag}${acCount}`);
    for (const child of childrenOf.get(id) ?? []) render(child, depth + 1);
  };
  for (const id of roots) render(id, 0);
  return lines;
}

/** A compact line-level diff (LCS-based) for `--dry-run` display — readable, not a byte-exact
 *  patch format (nothing consumes this programmatically; the writer's own tests pin exact bytes). */
function unifiedDiffLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push(`  ${a[i]}`); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push(ui.red(`- ${a[i]}`)); i++; }
    else { out.push(ui.green(`+ ${b[j]}`)); j++; }
  }
  while (i < a.length) { out.push(ui.red(`- ${a[i]}`)); i++; }
  while (j < b.length) { out.push(ui.green(`+ ${b[j]}`)); j++; }
  return out;
}

function outcomeLine(o: FileOutcome, cwd: string): string {
  const path = relative(cwd, o.path) || o.path;
  if (o.kind === 'noop') return `${statusMark('pass')} ${path} ${ui.dim('no-op (already canonical)')}`;
  if (o.kind === 'skipped') return `${statusMark('warn')} ${path} ${ui.yellow(`skipped: ${o.reason}`)}`;
  const acCount = o.plan.issues.reduce((sum, i) => sum + i.acs.length, 0);
  return `${statusMark('pass')} ${path} ${ui.green(`materialized (${o.plan.issues.length} issue${o.plan.issues.length === 1 ? '' : 's'}, ${acCount} AC${acCount === 1 ? '' : 's'})`)}`;
}

function registerSnippet(entries: ReturnType<typeof planRegister>): string {
  return JSON.stringify({ sources: entries }, null, 2);
}

export async function handleImportCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'import') return false;
  const flagArgs = args.slice(1);
  if (flagArgs[0] === '--help' || flagArgs[0] === '-h' || flagArgs[0] === 'help') {
    process.stdout.write(USAGE);
    return true;
  }
  const unknown = flagArgs.filter((t) => t.startsWith('--') && !t.includes('=') && !KNOWN_FLAGS.has(t))
    .concat(flagArgs.filter((t) => t.startsWith('--') && t.includes('=') && !KNOWN_FLAGS.has(t.split('=')[0]!)));
  if (unknown.length) throw new Error(`ztrack import: unknown flag(s) ${unknown.join(', ')}. Valid flags: ${[...KNOWN_FLAGS].join(' ')}`);

  const positionals = positionalArgs(flagArgs, VALUE_FLAGS);
  if (positionals.length === 0) throw new Error(`ztrack import: provide at least one <path-or-glob>.\n\n${USAGE}`);

  const dryRun = flagArgs.includes('--dry-run');
  const register = flagArgs.includes('--register');
  const prefix = optionValue(flagArgs, '--prefix') || undefined;

  const cwd = process.cwd();
  const projectRoot = projectRootFrom(cwd);
  const configPath = trackerConfigPath(projectRoot);
  let config: TrackerConfig | undefined;
  try { config = loadTrackerConfig(projectRoot); } catch { /* no project yet — import can still run against bare files */ }

  if (register && !config) {
    throw new Error(`ztrack import: --register needs a tracker config (none found at ${configPath}) — run \`ztrack init\` first, or omit --register.`);
  }

  const excludeDirs = config ? issuePerFileSourceDirs(projectRoot, config) : [];
  const files = expandInputs(positionals, cwd, excludeDirs);
  if (files.length === 0) throw new Error(`ztrack import: no .md file(s) found for ${positionals.join(', ')}.`);

  const allocator = new IdAllocator();
  if (config) for (const id of collectConfiguredIds(projectRoot, config)) allocator.note(id);

  const outcomes = runImportBatch(files, {
    ...(prefix ? { prefix } : {}),
    ...(config?.local?.teamKey ? { teamKey: config.local.teamKey } : {}),
    allocator,
    write: !dryRun,
  });

  if (dryRun) {
    for (const o of outcomes) {
      process.stdout.write(`${outcomeLine(o, cwd)}\n`);
      if (o.kind === 'materialized') {
        for (const line of planTreeLines(o.plan)) process.stdout.write(`  ${line}\n`);
        for (const line of unifiedDiffLines(o.before, o.after)) process.stdout.write(`  ${line}\n`);
        process.stdout.write('\n');
      }
    }
  } else {
    for (const o of outcomes) process.stdout.write(`${outcomeLine(o, cwd)}\n`);
  }

  const preCheckedTotal = outcomes.flatMap((o) => (o.kind === 'materialized' ? o.plan.preChecked : [])).length;
  if (preCheckedTotal > 0) {
    process.stdout.write(`\n${statusMark('warn')} ${ui.yellow(`${preCheckedTotal} previously-checked item${preCheckedTotal === 1 ? '' : 's'} imported UNCHECKED`)} ${ui.dim('(a checked AC needs evidence — see the (imported: …) marker on each):')}\n`);
    for (const o of outcomes) {
      if (o.kind !== 'materialized') continue;
      for (const pc of o.plan.preChecked) process.stdout.write(`  ${ui.dim(`${pc.issueId} ${pc.acId}: ${pc.text}`)}\n`);
    }
  }
  const unmappedTotal = outcomes.flatMap((o) => (o.kind === 'materialized' ? o.plan.unmapped : []));
  if (unmappedTotal.length > 0) {
    process.stdout.write(`\n${statusMark('info')} ${ui.dim(`${unmappedTotal.length} unmapped item(s) left in place, untouched:`)}\n`);
    for (const u of unmappedTotal) process.stdout.write(`  ${ui.dim(`line ${u.line}: ${u.reason} — "${u.excerpt}"`)}\n`);
  }

  const registerCandidates = outcomes.filter((o): o is Extract<FileOutcome, { kind: 'materialized' | 'noop' }> => o.kind !== 'skipped').map((o) => o.path);
  if (config && registerCandidates.length) {
    const toAdd = planRegister(projectRoot, config, registerCandidates);
    if (toAdd.length) {
      if (register && !dryRun) {
        applyRegister(configPath, toAdd);
        process.stdout.write(`\n${statusMark('pass')} ${ui.green(`registered ${toAdd.length} source${toAdd.length === 1 ? '' : 's'}`)} ${ui.dim(`in ${configPath}`)}\n`);
      } else {
        process.stdout.write(`\n${ui.dim(register ? '--dry-run: would register these sources (nothing written):' : `not registered — add to ${configPath}, or re-run with --register:`)}\n${registerSnippet(toAdd)}\n`);
      }
    }
  }
  return true;
}
