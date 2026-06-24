#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportTrackerRoot } from './export.ts';
import { git } from './core/gitWorld.ts';
import { lintIssueBody } from './lint.ts';
import { applyTx, planTx } from './tx.ts';
import type { TxEdit } from './tx.ts';
import { applyModelPatch, canonicalizeBody } from './modelEdit.ts';
import { viewToRecord, columnsToEdit } from './core/loader.ts';
import * as githubSync from './sync/github/index.ts';
import { positionalArgs, resolveTarget } from './cliTarget.ts';
import { describeTarget } from './loopState.ts';
import type { IssueRecord } from './core/engine.ts';
import { ensureTrackerGitignore, initTrackerPresets, initTrackerProject, loadTrackerConfig, projectRootFrom, stateDirName, trackerConfigPath, upgradeTrackerPreset } from './config.ts';
import { migrateLocalToMarkdown } from './migrateLocal.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { serveMcp } from './mcp.ts';
import { serveTrackerApi } from './server.ts';
import { createTrackerClient } from './sdk.ts';
import { optionValue } from './cliArgs.ts';
import { handleEvidenceCommand } from './cliEvidence.ts';
import { commandName, printHelp, printIssueActionHelp, printResourceHelp, scaffoldCaseBody } from './cliHelp.ts';
import { handleCheckCommand } from './cliCheck.ts';
import { handleCompletionsCommand } from './cliCompletions.ts';
import { heading, stackedCommand, statusMark, ui } from './cliStyle.ts';

async function readStdinIfPiped(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length ? text : undefined;
}

// `issue scaffold` produces a starter body. Prefer the active preset's OWN scaffold so
// the body satisfies that preset's rules (required sections, source markers, AC ids);
// fall back to the generic body when no preset is configured or it defines none.
async function activePresetScaffold(title: string): Promise<string | undefined> {
  try {
    const root = projectRootFrom();
    return (await resolveTrackerValidation(loadTrackerConfig(root), root)).scaffold?.(title);
  } catch {
    return undefined;
  }
}

// The issue's `## Waivers` section is a list of located waiver directives, one per row:
// `- code: <finding-code> [ac: <acId>] reason: <text> by: <signer>` (parsed identically by the
// core in engine.parseWaivers). These helpers read/strip/re-render it for `waiver sign|clear`.
type WaiverRow = { code: string; acId?: string; reason: string; approvedBy: string };
function parseWaiverRows(body: string): WaiverRow[] {
  const m = /(?:^|\n)##\s+waivers\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(body);
  if (!m) return [];
  const rows: WaiverRow[] = [];
  for (const line of m[1]!.split('\n')) {
    const code = /\bcode:\s*([A-Za-z0-9_]+)/i.exec(line)?.[1];
    if (!code) continue;
    const acId = /\bac:\s*(\S+)/i.exec(line)?.[1];
    const reason = /\breason:\s*(.+?)\s*(?=\s+by:|$)/i.exec(line)?.[1]?.trim() ?? '';
    const approvedBy = /\bby:\s*(.+?)\s*$/i.exec(line)?.[1]?.trim() ?? '';
    rows.push({ code, reason, approvedBy, ...(acId ? { acId } : {}) });
  }
  return rows;
}
function stripWaiversSection(body: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of body.split('\n')) {
    if (/^##\s+waivers\b/i.test(line)) { skipping = true; continue; }
    if (skipping && /^##\s+/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
function withWaivers(body: string, rows: WaiverRow[]): string {
  const base = stripWaiversSection(body);
  if (!rows.length) return `${base}\n`;
  const render = (w: WaiverRow) => `- code: ${w.code}${w.acId ? ` ac: ${w.acId}` : ''} reason: ${w.reason} by: ${w.approvedBy}`;
  return `${base}\n\n## Waivers\n\n${rows.map(render).join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = commandName();
  if (!args.length || ['help', '--help', '-h'].includes(args[0]!)) {
    printHelp();
    return;
  }

  // `completions` is tracker-independent — handle it before anything touches config/client.
  if (handleCompletionsCommand(args, command)) return;

  if (
    args[0] === 'issue' &&
    args[1] &&
    args.slice(2).some((arg) => arg === '--help' || arg === '-h' || arg === 'help') &&
    printIssueActionHelp(args[1]!)
  ) {
    return;
  }

  if (args.slice(1).some((arg) => arg === '--help' || arg === '-h' || arg === 'help') && printResourceHelp(args[0]!)) {
    return;
  }

  if (args[0] === 'init') {
    const root = resolve(optionValue(args, '--root') || process.cwd());
    const preset = optionValue(args, '--preset', 'default');
    if (!initTrackerPresets().includes(preset as any)) {
      throw new Error(`ztrack init: --preset must be one of ${initTrackerPresets().join(', ')}`);
    }
    // Optional permanent link to an external tracker: `ztrack init --sync github --repo o/n`.
    const syncProvider = optionValue(args, '--sync');
    let sync: { provider: 'github'; repo: string; policy?: 'hub-wins' | 'twin-wins' | 'merge' } | undefined;
    if (syncProvider) {
      if (syncProvider !== 'github') throw new Error(`ztrack init: --sync only supports 'github' today (got '${syncProvider}')`);
      const repo = optionValue(args, '--repo');
      if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("ztrack init --sync github: --repo <owner/name> is required (e.g. --repo volter-ai/ztrack)");
      const policy = optionValue(args, '--policy');
      if (policy && !['hub-wins', 'twin-wins', 'merge'].includes(policy)) throw new Error(`ztrack init: --policy must be merge | hub-wins | twin-wins (got '${policy}')`);
      sync = { provider: 'github', repo, ...(policy ? { policy: policy as 'hub-wins' | 'twin-wins' | 'merge' } : {}) };
    }
    const result = initTrackerProject(root, optionValue(args, '--team') || 'LOCAL', { preset: preset as any, ...(sync ? { sync } : {}) });
    if (result.alreadyInitialized) {
      process.stdout.write(`${statusMark('pass')} ${ui.green('Already initialized')} ${ui.dim(result.configPath)}\n`);
      return;
    }
    // Initial pull so the linked repo's issues populate the fresh tracker (best-effort:
    // a network/auth failure leaves init successful — `ztrack sync` retries later).
    let pulled = false;
    if (sync) {
      process.stdout.write(`${statusMark('info')} ${ui.dim(`linked to github ${sync.repo} — pulling issues…`)}\n`);
      try {
        const r = await githubSync.pull({ projectRoot: root, owner: sync.repo.split('/')[0]!, repo: sync.repo.split('/')[1]!, execute: githubSync.resolveGithubExecute(), client: createTrackerClient({ projectRoot: root }), occurredAt: new Date().toISOString() });
        process.stdout.write(`${statusMark('pass')} ${ui.dim(`pulled ${r.total} GitHub issue(s) → ${r.created.length} created locally`)}\n`);
        pulled = true;
      } catch (e) {
        process.stdout.write(`${statusMark('warn')} ${ui.yellow(`initial pull skipped: ${(e as Error).message.split('\n')[0]}`)} ${ui.dim('— run `ztrack sync` once auth is set up')}\n`);
      }
    }
    const configPath = result.configPath;
    const teamKey = result.teamKey;
    // Next steps adapt to the scenario: a LINKED project already has its issues (pulled from
    // the tracker), so it goes straight to verify/loop/sync; a LOCAL project authors one first.
    const nextSteps = sync
      ? [
          pulled
            ? stackedCommand(1, 'Verify an issue', `${command} check <issue-id>`, `${ui.dim('or')} ${command} check ${ui.dim('for the whole tracker — your GitHub issues were just pulled in.')}`)
            : stackedCommand(1, 'Pull your GitHub issues', `${command} sync github`, 'The initial pull was skipped (set up `gh auth login` or GITHUB_TOKEN first), then `ztrack check`.'),
          '',
          stackedCommand(2, 'Drive one to done in a loop', `${command} loop start <issue-id>`, 'The Stop-hook gate holds the turn until that issue passes check (a ralph loop).'),
          '',
          stackedCommand(3, 'Re-sync with GitHub', `${command} sync github`, 'Bidirectional + conflict-aware; no --repo needed (it uses the link).'),
        ]
      : [
          stackedCommand(1, 'Write a starter issue', `${command} issue scaffold --title "First case" > body.md`, 'Creates a markdown body with acceptance criteria and evidence sections.'),
          '',
          stackedCommand(2, 'Create work in the local tracker', `${command} issue create --title "First case" --label type:case --state draft --assignee me --body-file body.md`, 'Stores the issue where ztrack can validate it.'),
          '',
          stackedCommand(3, 'Verify checked claims', `${command} check`, 'Fails if checked work lacks real evidence.'),
        ];
    process.stdout.write([
      `${statusMark('pass')} ${heading('Initialized ztrack', sync ? `team ${teamKey} • linked ${sync.repo}` : `team ${teamKey}`)}`,
      `  ${ui.dim(configPath)}`,
      ...(result.validationEntrypoint ? [`  ${ui.dim(`validation ${result.validationEntrypoint}`)}`] : []),
      '',
      ui.bold('Next steps'),
      ...nextSteps,
      '',
      ui.dim(`Check anything: ${command} check <id> · ${command} check ./file.md · ${command} check (in a worktree, auto-scopes to the branch's issue).`),
      ui.dim('Edit the installed validation preset to encode your project rules.'),
      '',
    ].join('\n'));
    return;
  }

  if (args[0] === 'migrate-local') {
    const root = projectRootFrom(resolve(optionValue(args, '--root') || process.cwd()));
    const result = migrateLocalToMarkdown(root);
    if (!result.ran) {
      process.stdout.write(`${statusMark('pass')} ${ui.green('Nothing to migrate')} ${ui.dim(`(no ${result.sqlitePath})`)}\n`);
      return;
    }
    // flip the project onto the markdown backend now that its issues are markdown files
    const configPath = trackerConfigPath(root);
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    raw.backend = 'markdown';
    writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);
    process.stdout.write([
      `${statusMark('pass')} ${heading('Migrated to the markdown backend', `${result.migrated} issue${result.migrated === 1 ? '' : 's'}`)}`,
      `  ${ui.dim(`from ${result.sqlitePath} (left in place as a backup)`)}`,
      `  ${ui.dim(`backend set to "markdown" in ${configPath}`)}`,
      '',
      ui.dim('Verify with `ztrack check`, then delete the old tracker.sqlite when satisfied.'),
      '',
    ].join('\n'));
    return;
  }

  if (args[0] === 'preset') {
    const action = args[1];
    if (!action || action === '--help' || action === '-h' || action === 'help') {
      process.stdout.write(
        `Usage: ${command} preset upgrade\n\n` +
        `upgrade  3-way merge new upstream preset rules into your edited\n` +
        `         .volter/tracker/validation/preset.mts, preserving your edits. Conflicts are\n` +
        `         written as <<<<<<< markers to resolve; then run '${command} check'.\n`);
      return;
    }
    if (action === 'upgrade') {
      const result = upgradeTrackerPreset(projectRootFrom());
      if (result.status === 'up-to-date') {
        process.stdout.write(`${statusMark('pass')} ${ui.green('Preset is up to date')} ${ui.dim(`with the installed ztrack (${result.installedFrom})`)}\n`);
      } else if (result.status === 'no-base') {
        process.stdout.write(`${statusMark('warn')} ${ui.yellow('No pristine base recorded')} ${ui.dim("— this repo was init'd before upgrade support.")}\n  ${ui.dim('Seed')} ${ui.dim(result.entrypoint.replace('preset.mts', '.preset.base.mts'))} ${ui.dim('from the ztrack version you installed, then re-run.')}\n`);
      } else if (result.status === 'updated') {
        process.stdout.write(`${statusMark('pass')} ${ui.green('Merged new upstream rules')} ${ui.dim(`into ${result.entrypoint} (no conflicts)`)}\n  ${ui.dim(`Review the diff, then run '${command} check'.`)}\n`);
      } else {
        process.stdout.write(`${statusMark('warn')} ${ui.yellow(`Merged with ${result.conflicts} conflict(s)`)} ${ui.dim(`in ${result.entrypoint}`)}\n  ${ui.dim(`Resolve the <<<<<<< markers, then run '${command} check'.`)}\n`);
        process.exitCode = 1;
      }
      return;
    }
    throw new Error(`ztrack preset: unknown action '${action}'. Try '${command} preset upgrade'.`);
  }

  if (args[0] === 'loop') {
    // The explicit-start that makes the gate loop-scoped instead of always-on: while
    // armed, the Stop hook holds the agent's turn until <issue> passes `ztrack check`.
    const action = args[1];
    const root = projectRootFrom();
    const stateDir = join(root, stateDirName());
    const marker = join(stateDir, '.ztrack-loop.json');
    const cappedPath = join(stateDir, '.ztrack-loop-capped.json');
    // Sweep every session's runtime state (iter counters + leftover exemptions), so a
    // disarm/arm leaves nothing stale behind — mirrors the hook's sweep_loop_state.
    const sweepRuntime = (): void => {
      for (const f of existsSync(stateDir) ? readdirSync(stateDir) : []) {
        if (f.startsWith('.ztrack-loop-iter-') || f.startsWith('.ztrack-loop-exempt-')) rmSync(join(stateDir, f), { force: true });
      }
    };
    if (!action || action === '--help' || action === '-h' || action === 'help') {
      process.stdout.write(`Usage: ${command} loop <start [<issue>|<file.md>] [--max N] | stop | status>\n\nArms a loop-scoped ztrack gate (a ralph loop). While armed, the Stop hook keeps the agent going until the target passes \`${command} check\` (then it disarms), or the iteration cap trips. The target uses the same grammar as \`check\`: an issue id, a markdown file, or — with no argument — this worktree's issue (resolved from the branch/worktree name). start writes ${stateDirName()}/.ztrack-loop.json; stop removes it.\n`);
      return;
    }
    if (action === 'start') {
      // Same target grammar as `check`: <issue id> | <file.md> | (bare) -> this branch's issue.
      const positionals = positionalArgs(args.slice(2), new Set(['--max']));
      const resolved = resolveTarget({ positionals, forceAuto: false, cwd: process.cwd() });
      const target = resolved.kind === 'all' ? { kind: 'auto' as const } : resolved; // bare loop = ralph on the active branch
      const label = describeTarget(target);
      const maxRaw = optionValue(args, '--max');
      const maxIterations = maxRaw && Number.isInteger(Number(maxRaw)) && Number(maxRaw) > 0 ? Number(maxRaw) : 8;
      mkdirSync(stateDir, { recursive: true });
      ensureTrackerGitignore(root); // so the loop's runtime/exempt files are ignored even on a repo init'd before the loop existed
      sweepRuntime();
      if (existsSync(cappedPath)) rmSync(cappedPath); // a fresh arm clears any prior cap breadcrumb
      writeFileSync(marker, `${JSON.stringify({ target, maxIterations, startedAt: new Date().toISOString(), label }, null, 2)}\n`);
      // Pull the latest from a linked tracker before the ralph loop starts (best-effort).
      await githubSync.syncLinked(root, { pull: true }).catch(() => {});
      process.stdout.write(`${statusMark('pass')} ${ui.green('loop armed')} ${ui.dim(`→ ${label} (max ${maxIterations}); the Stop gate now holds the turn until ${label} is green`)}\n`);
      return;
    }
    if (action === 'stop') {
      if (existsSync(marker)) rmSync(marker);
      if (existsSync(cappedPath)) rmSync(cappedPath);
      sweepRuntime();
      process.stdout.write(`${statusMark('pass')} ${ui.dim('loop disarmed')}\n`);
      return;
    }
    if (action === 'status') {
      // A torn write of a runtime file must not crash `status`; treat unreadable as absent.
      const readJson = (p: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { return null; } };
      const m = existsSync(marker) ? readJson(marker) : null;
      if (m) {
        const label = m.label ?? m.issue ?? 'target';
        process.stdout.write(`${statusMark('info')} ${ui.bold(`loop armed → ${label}`)} ${ui.dim(`(max ${m.maxIterations}, since ${m.startedAt})`)}\n`);
        return;
      }
      const c = existsSync(cappedPath) ? readJson(cappedPath) : null;
      if (c) {
        process.stdout.write(`${statusMark('warn')} ${ui.yellow(`loop capped → ${c.issue}`)} ${ui.dim(`(hit the iteration cap after ${c.iterations} iterations, still red as of ${c.cappedAt}; run \`${command} check\` then \`${command} loop start ${c.issue}\` to re-arm)`)}\n`);
        return;
      }
      process.stdout.write(`${statusMark('info')} ${ui.dim('no loop armed')}\n`);
      return;
    }
    throw new Error(`${command} loop: unknown action '${action}'. Try 'start <issue>', 'stop', or 'status'.`);
  }

  if (args[0] === 'waiver') {
    // eslint-`disable`-style escape: an authority acknowledges ONE specific check finding (by
    // its code, optionally scoped to an AC) on <issue>, recorded in the `## Waivers` section.
    // The core downgrades the matching finding to 'acknowledged'; a waiver that matches nothing
    // is reported (`waiver_unused`). Sign-off is the git identity, captured automatically.
    const action = args[1];
    const projectRoot = projectRootFrom();
    if (!action || ['--help', '-h', 'help'].includes(action)) {
      process.stdout.write(`Usage: ${command} waiver <sign <issue> --code <finding-code> [--ac <acId>] --reason "..." | clear <issue> [--code <code>] | status <issue>>\n\nAcknowledges ONE check finding (by its code) on <issue>, signed off as your git identity, in the issue's \`## Waivers\` section. The core downgrades that finding to 'acknowledged' so \`${command} check\` passes; a waiver that matches no finding is reported (\`waiver_unused\`). Prefer fixing the issue — waive only a finding you knowingly accept.\n`);
      return;
    }
    const id = args[2];
    if (!id || id.startsWith('-')) throw new Error(`${command} waiver ${action}: needs an issue id, e.g. \`${command} waiver ${action} APP-1\``);
    const wClient = createTrackerClient();
    const issueView = await wClient.issue.view(id, { json: 'body' });
    const body = String((issueView as Record<string, unknown>).body ?? '');
    const rows = parseWaiverRows(body);
    if (action === 'sign') {
      const reason = optionValue(args, '--reason');
      const code = optionValue(args, '--code');
      const acId = optionValue(args, '--ac');
      if (!code) throw new Error(`${command} waiver sign: --code <finding-code> is required — the check finding you are accepting (e.g. evidence_commit_not_found).`);
      if (!reason) throw new Error(`${command} waiver sign: --reason "<why this failing state is acceptable>" is required`);
      const gitName = git(projectRoot, ['config', 'user.name']);
      const gitEmail = git(projectRoot, ['config', 'user.email']);
      // `Name (email)`, not git's `Name <email>` — angle brackets get mangled by the markdown
      // round-trip; parens survive. The signer is the git identity (authors commits too).
      const approvedBy = gitName && gitEmail ? `${gitName} (${gitEmail})` : (gitName || gitEmail);
      if (!approvedBy) throw new Error(`${command} waiver sign: no git identity configured. Set one (\`git config user.name\` / \`user.email\`) — a waiver must record who signed it.`);
      const next = rows.filter((w) => !(w.code === code && (w.acId ?? '') === (acId ?? '')));  // replace a same code+ac waiver
      next.push({ code, reason, approvedBy, ...(acId ? { acId } : {}) });
      await wClient.issue.edit(id, { body: withWaivers(body, next) });
      process.stdout.write(`${statusMark('pass')} ${ui.green('waiver signed')} ${ui.dim(`→ ${id}${acId ? ` (${acId})` : ''} for '${code}' by ${approvedBy}. Honored only while '${code}' actually fires — otherwise check reports waiver_unused.`)}\n`);
      return;
    }
    if (action === 'clear') {
      const code = optionValue(args, '--code');
      const next = code ? rows.filter((w) => w.code !== code) : [];
      await wClient.issue.edit(id, { body: withWaivers(body, next) });
      process.stdout.write(`${statusMark('pass')} ${ui.dim(code ? `waiver for '${code}' cleared on ${id}` : `all waivers cleared on ${id}`)}\n`);
      return;
    }
    if (action === 'status') {
      process.stdout.write(rows.length
        ? `${statusMark('info')} ${ui.bold(`${id} carries ${rows.length} waiver${rows.length === 1 ? '' : 's'}`)}\n${rows.map((w) => `  ${ui.dim(`${w.code}${w.acId ? ` (${w.acId})` : ''} — ${w.reason} [${w.approvedBy}]`)}`).join('\n')}\n`
        : `${statusMark('info')} ${ui.dim(`${id} has no waivers`)}\n`);
      return;
    }
    throw new Error(`${command} waiver: unknown action '${action}'. Try 'sign <issue> --code <code> --reason "..."', 'clear <issue> [--code <code>]', or 'status <issue>'.`);
  }

  if (args[0] === 'issue' && args[1] === 'scaffold') {
    const title = optionValue(args, '--title') || 'New case';
    process.stdout.write((await activePresetScaffold(title)) ?? (await scaffoldCaseBody(title)));
    return;
  }

  if (args[0] === 'fmt') {
    const inputPath = optionValue(args, '--input');
    const issueId = optionValue(args, '--issue');
    const write = args.includes('--write');
    const checkOnly = args.includes('--check');
    const projRoot = projectRootFrom();
    const preset = await resolveTrackerValidation(loadTrackerConfig(projRoot), projRoot);
    const fmtClient = (issueId !== '') ? createTrackerClient() : null;
    let record: IssueRecord;
    if (inputPath) {
      // a standalone file carries no columns; canonicalize the body content with a placeholder
      record = { id: 'fmt', title: 'fmt', status: 'draft', body: readFileSync(isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath), 'utf8') };
    } else if (issueId) {
      const issue = await fmtClient!.issue.view(issueId, { json: 'identifier,title,state,stateType,assignee,labels,children,body' });
      record = viewToRecord(issue as Record<string, unknown>, issueId);
    } else {
      throw new Error("tracker fmt: provide --issue <id> or --input <file> (plus --write to apply, --check to verify)");
    }
    const result = canonicalizeBody(preset, record);
    const canonical = result.body === record.body;
    if (checkOnly) {
      process.stdout.write(canonical ? 'canonical\n' : 'NOT canonical (run tracker fmt --write)\n');
      process.exitCode = canonical ? 0 : 1;
      return;
    }
    if (write) {
      if (canonical) { process.stdout.write('already canonical\n'); return; }
      if (issueId) {
        await fmtClient!.issue.edit(issueId, columnsToEdit(result.body, result.columns, record));
        process.stdout.write(`formatted ${issueId}\n`);
      } else {
        writeFileSync(isAbsolute(inputPath!) ? inputPath! : resolve(process.cwd(), inputPath!), result.body);
        process.stdout.write(`formatted ${inputPath}\n`);
      }
      return;
    }
    process.stdout.write(result.body);
    return;
  }

  if (args[0] === 'mcp' && args[1] === 'serve') {
    await serveMcp();
    return;
  }

  if (args[0] === 'visualizer' || args[0] === 'viz') {
    // The visualizer is a standalone Bun app shipped alongside the CLI. Resolve
    // it relative to the package root, which holds for both the source checkout
    // (src/cli.ts) and the published bundle (dist/cli.js).
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const visualizerDir = join(packageRoot, 'visualizer');
    const serverEntry = join(visualizerDir, 'server.ts');
    if (!existsSync(serverEntry)) {
      throw new Error(`ztrack visualizer: visualizer not found at ${serverEntry}`);
    }
    if (spawnSync('bun', ['--version'], { stdio: 'ignore' }).status !== 0) {
      throw new Error('ztrack visualizer requires Bun (https://bun.sh) — the visualizer is a Bun app.');
    }
    // One-time install of the visualizer's client deps (react) if missing.
    if (!existsSync(join(visualizerDir, 'node_modules', 'react'))) {
      process.stderr.write(`${ui.dim('Installing visualizer dependencies (one-time)…')}\n`);
      const install = spawnSync('bun', ['install'], { cwd: visualizerDir, stdio: 'inherit' });
      if (install.status !== 0) throw new Error('ztrack visualizer: failed to install visualizer dependencies');
    }
    const project = optionValue(args, '--project') || (() => { try { return projectRootFrom(); } catch { return process.cwd(); } })();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PROJECT_DIR: resolve(project),
      PRESET: optionValue(args, '--preset') || process.env.PRESET || 'default',
    };
    const port = optionValue(args, '--port');
    if (port) env.PORT = port;
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn('bun', ['run', serverEntry], { stdio: 'inherit', env });
      child.on('error', (error) => rejectPromise(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error('ztrack visualizer requires Bun (https://bun.sh) — the visualizer is a Bun app.')
          : error,
      ));
      child.on('exit', (code) => { process.exitCode = code ?? 0; resolvePromise(); });
    });
    return;
  }

  // `check`/`export` resolve their own project (and `check <file.md>` needs none) — dispatch
  // before createTrackerClient so zero-config file mode doesn't trip the no-config error.
  // A user-facing `check` on a LINKED tracker best-effort reconciles first (one bidirectional
  // three-way merge: pull the latest, push local changes, merge non-conflicting edits) — but
  // NEVER the Stop-hook gate (`--auto-scope`), which must not hit the API mid-loop, and never a
  // file check (`<x>.md`) which isn't tracker-bound. (check is read-only, so before suffices.)
  if (args[0] === 'check') {
    const userCheck = !args.includes('--auto-scope') && !args.slice(1).some((a) => a.endsWith('.md') || a === '--help' || a === '-h' || a === 'help');
    let root = '';
    try { root = projectRootFrom(); } catch { /* no project: nothing to sync */ }
    if (userCheck && root) await githubSync.syncLinked(root, { pull: true, push: true }).catch(() => {});
    if (await handleCheckCommand(args)) return;
  } else if (await handleCheckCommand(args)) return;

  const client = createTrackerClient();
  if (args[0] === 'api') {
    const action = args[1];
    if (!action || action === '--help' || action === '-h' || action === 'help') {
      process.stdout.write(`Usage: ${command} api <query|serve> [args...]

GraphQL-shaped query against the local tracker store.

  ${command} api query --query '{ issues(first: 10) { nodes { identifier title } } }'
  ${command} api serve --host 127.0.0.1 --port 8765
`);
      return;
    }
    if (action === 'query') {
      const query = optionValue(args, '--query');
      if (!query) throw new Error('tracker api query: --query required');
      process.stdout.write(`${JSON.stringify(await client.graphql(query), null, 2)}\n`);
      return;
    }
    if (action === 'serve') {
      await serveTrackerApi({
        host: optionValue(args, '--host', '127.0.0.1'),
        port: Number(optionValue(args, '--port', '8765')),
      });
      return;
    }
    throw new Error(`tracker api: unknown action '${action ?? ''}'`);
  }


  if (args[0] === 'tx') {
    const action = args[1];
    const filePath = optionValue(args, '--file');
    if (!action || !['plan', 'apply'].includes(action) || !filePath) {
      throw new Error('usage: tracker tx <plan|apply> --file tx.json   (tx.json: {"edits": [{"issue": "A-1", "op": "check", "acId": "dev/01", ...}]}; apply accepts {"base": {...}} from a prior plan)');
    }
    const spec = JSON.parse(readFileSync(isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath), 'utf8')) as { edits: TxEdit[]; base?: Record<string, string> };
    if (action === 'plan') {
      const plan = await planTx(spec.edits);
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      return;
    }
    const result = await applyTx(spec.edits, { projectRoot: projectRootFrom(), ...(spec.base ? { base: spec.base } : {}) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.committed ? 0 : 1;
    return;
  }

  if (args[0] === 'lint') {
    const projectRoot = projectRootFrom();
    const issuesFilter = optionValue(args, '--issues');
    const issueSet = issuesFilter ? new Set(issuesFilter.split(',').map((s) => s.trim()).filter(Boolean)) : null;
    const { loadTrackerConfig } = await import('./config.ts');
    const config = loadTrackerConfig(projectRoot);
    const rows = await client.issue.list({ state: 'all', limit: 5000, json: 'identifier,body' });
    const cases = (Array.isArray(rows) ? rows : []) as Array<{ identifier?: string; body?: string }>;
    const findings = cases
      .filter((c) => !issueSet || issueSet.has(String(c.identifier ?? '')))
      .flatMap((c) => lintIssueBody(String(c.body ?? ''), String(c.identifier ?? ''), config));
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify({ findings }, null, 2)}\n`);
    else for (const f of findings) process.stdout.write(`${f.severity.toUpperCase()} ${f.rule}: issue=${f.issue} ${f.message} | ${f.excerpt ?? ''}\n`);
    process.exitCode = findings.some((f) => f.severity === 'error') || (args.includes('--fail-on-warn') && findings.length > 0) ? 1 : 0;
    return;
  }

  if (args[0] === 'annotations') {
    throw new Error('ztrack annotations requires the optional @volter-ai-dev/twin peer dependency and a mirrored world store.');
  }

  // Two-way GitHub issue sync through the twin. Auth is the gh CLI (or GITHUB_TOKEN) — never a
  // prompted PAT. A synced issue IS the GitHub issue (binding in .volter/sync/github.json).
  if (args[0] === 'sync') {
    if (args[1] !== 'github') {
      throw new Error("usage: tracker sync github [--repo <owner/name>] [--pull | --push] [--policy merge|hub-wins|twin-wins]   (default: bidirectional reconcile; --repo + --policy default to the `init --sync` link)");
    }
    // --repo is optional once the project is linked (`init --sync github --repo o/n`).
    const repo = optionValue(args, '--repo') || githubSync.linkedRepo(projectRootFrom()) || '';
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      throw new Error("tracker sync github: no repo. Pass --repo <owner/name>, or link one with `ztrack init --sync github --repo <owner/name>`.");
    }
    const [owner, name] = repo.split('/');
    const o = { projectRoot: projectRootFrom(), owner: owner!, repo: name!, execute: githubSync.resolveGithubExecute(), client, occurredAt: new Date().toISOString() };
    const onlyPull = args.includes('--pull') && !args.includes('--push');
    const onlyPush = args.includes('--push') && !args.includes('--pull');
    const out: Record<string, unknown> = { repo };
    if (onlyPull) {
      const r = await githubSync.pull(o); out.pull = r;
      process.stdout.write(`${statusMark('pass')} pull: ${r.created.length} created, ${r.updated.length} updated locally\n`);
    } else if (onlyPush) {
      const r = await githubSync.push(o); out.push = r;
      process.stdout.write(`${statusMark('pass')} push: ${r.created.length} created, ${r.updated.length} updated on GitHub\n`);
    } else {
      // default: bidirectional three-way merge (concurrent non-overlapping edits merge; a
      // same-field collision is surfaced, never silently clobbered). Policy: --policy overrides
      // the linked config (default merge).
      const policyFlag = optionValue(args, '--policy');
      if (policyFlag && !['hub-wins', 'twin-wins', 'merge'].includes(policyFlag)) throw new Error(`tracker sync: --policy must be merge | hub-wins | twin-wins (got '${policyFlag}')`);
      const policy = (policyFlag as 'hub-wins' | 'twin-wins' | 'merge') || githubSync.linkedPolicy(o.projectRoot);
      const r = await githubSync.reconcileSync(o, policy); out.reconcile = r;
      process.stdout.write(`${statusMark('pass')} sync: ${r.pulled.length} pulled, ${r.pushed.length} pushed, ${r.created.length} created\n`);
      for (const c of r.conflicts) {
        process.stdout.write(`${statusMark('warn')} ${ui.yellow(`conflict on ${c.issue}`)} ${ui.dim(`(both sides changed: ${c.fields.join(', ')} — left untouched; edit one side and re-sync)`)}\n`);
      }
    }
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  if (await handleEvidenceCommand(args)) return;

  // The one model edit: parse -> overlay a typed fragment -> validate -> serialize.
  //   tracker ac patch <issue> <acId> --json '{"checked":true,"status":"passed", ...}'
  //   tracker issue patch <issue>     --json '{"status":"done"}'
  // The patch fields are the active preset's SCHEMA shape (run `issue view` to see it); the
  // preset owns the grammar and renders it. The claim is then verified by `ztrack check`.
  if ((args[0] === 'ac' || args[0] === 'issue') && args[1] === 'patch') {
    const isAc = args[0] === 'ac';
    const issueId = args[2];
    const acId = isAc ? args[3] : undefined;
    const json = optionValue(args, '--json');
    if (!issueId || (isAc && !acId) || !json) {
      throw new Error(isAc
        ? "usage: tracker ac patch <issue> <acId> --json '{...}'  (fields = the preset's AC schema shape; see `issue view`)"
        : "usage: tracker issue patch <issue> --json '{...}'  (fields = the preset's issue schema shape; see `issue view`)");
    }
    let patch: Record<string, unknown>;
    try { patch = JSON.parse(json) as Record<string, unknown>; }
    catch { throw new Error('tracker patch: --json must be valid JSON'); }
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('tracker patch: --json must be a JSON object (the preset schema fields to overlay)');
    }
    const issue = await client.issue.view(issueId, { json: 'identifier,title,state,stateType,assignee,labels,children,body' });
    const record = viewToRecord(issue as Record<string, unknown>, issueId);
    const root = projectRootFrom();
    const preset = await resolveTrackerValidation(loadTrackerConfig(root), root);
    const result = applyModelPatch(preset, record, { ...(acId ? { acId } : {}), patch });
    if (!args.includes('--dry-run') && result.changed) await client.issue.edit(issueId, columnsToEdit(result.body, result.columns, record));
    process.stdout.write(`${JSON.stringify({ issue: issueId, ...(acId ? { acId } : {}), changed: result.changed, dryRun: args.includes('--dry-run') }, null, 2)}\n`);
    return;
  }

  let forwardArgs = args;
  if (args[0] === 'issue' && args[1] === 'edit') {
    const expectState = optionValue(args, '--expect-state');
    const expectBodySha = optionValue(args, '--expect-body-sha');
    if (expectState || expectBodySha) {
      const identifier = args[2] ?? '';
      const view = await client.command(['issue', 'view', identifier, '--json', 'state,body']);
      const current = JSON.parse(view.stdout) as { state?: string; body?: string };
      const currentBodySha = createHash('sha256').update(current.body ?? '').digest('hex');
      const conflicts: string[] = [];
      if (expectState && current.state !== expectState) {
        conflicts.push(`state is ${JSON.stringify(current.state ?? null)}, expected ${JSON.stringify(expectState)}`);
      }
      if (expectBodySha && currentBodySha !== expectBodySha) {
        conflicts.push(`body sha256 is ${currentBodySha}, expected ${expectBodySha}`);
      }
      if (conflicts.length) {
        process.stderr.write(`${JSON.stringify({ ok: false, error: 'precondition-failed', issue: identifier, conflicts, currentState: current.state ?? null, currentBodySha }, null, 2)}\n`);
        process.exitCode = 1;
        return;
      }
      forwardArgs = args.filter((arg, index) =>
        arg !== '--expect-state' && arg !== '--expect-body-sha' &&
        args[index - 1] !== '--expect-state' && args[index - 1] !== '--expect-body-sha');
    }
  }

  const result = await client.command(forwardArgs, args[0] === 'extract-issue-ref' ? await readStdinIfPiped() : undefined);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  // A backend error (unknown verb, not-found, not-implemented) reports on stderr with no stdout.
  // Without this it would exit 0 — a silent no-op that lets scripts/agents believe a bad command worked.
  if (result.stderr && !result.stdout) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`${statusMark('fail')} ${ui.red(error instanceof Error ? error.message : String(error))}`);
  process.exit(1);
});
