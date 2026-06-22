#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTracker } from './check.ts';
import { exportTrackerRoot } from './export.ts';
import { issueAcFingerprint } from './core/engine.ts';
import { git } from './core/gitWorld.ts';
import { canonicalizeIssueMarkdown } from './markdownModel.ts';
import { lintIssueBody } from './lint.ts';
import { applyTx, planTx } from './tx.ts';
import type { TxEdit } from './tx.ts';
import { applyAcMutation } from './mutate.ts';
import type { AcStatus } from './mutate.ts';
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
function activePresetScaffold(title: string): string | undefined {
  try {
    const root = projectRootFrom();
    return resolveTrackerValidation(loadTrackerConfig(root), root).scaffold?.(title);
  } catch {
    return undefined;
  }
}

// Remove an existing `## Waiver` section (heading + body up to the next `## ` or EOF)
// so `waiver sign` re-stamps a single canonical block and `waiver clear` drops it.
function stripWaiverSection(body: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of body.split('\n')) {
    if (/^##\s+waiver\b/i.test(line)) { skipping = true; continue; }
    if (skipping && /^##\s+/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;
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
    const preset = optionValue(args, '--preset', 'basic');
    if (!initTrackerPresets().includes(preset as any)) {
      throw new Error(`ztrack init: --preset must be one of ${initTrackerPresets().join(', ')}`);
    }
    const result = initTrackerProject(root, optionValue(args, '--team') || 'LOCAL', { preset: preset as any });
    if (result.alreadyInitialized) {
      process.stdout.write(`${statusMark('pass')} ${ui.green('Already initialized')} ${ui.dim(result.configPath)}\n`);
      return;
    }
    const configPath = result.configPath;
    const teamKey = result.teamKey;
    process.stdout.write([
      `${statusMark('pass')} ${heading('Initialized ztrack', `team ${teamKey}`)}`,
      `  ${ui.dim(configPath)}`,
      ...(result.validationEntrypoint ? [`  ${ui.dim(`validation ${result.validationEntrypoint}`)}`] : []),
      '',
      ui.bold('Next steps'),
      stackedCommand(1, 'Write a starter issue', `${command} issue scaffold --title "First case" > body.md`, 'Creates a markdown body with acceptance criteria and evidence sections.'),
      '',
      stackedCommand(2, 'Create work in the local tracker', `${command} issue create --title "First case" --label type:case --state "In Progress" --body-file body.md`, 'Stores the issue where ztrack can validate it.'),
      '',
      stackedCommand(3, 'Verify checked claims', `${command} check`, 'Fails if checked work lacks real evidence.'),
      '',
      ui.dim('Recognized labels include type:case and type:bug.'),
      ui.dim('Unrecognized checked work warns instead of passing silently.'),
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
        `         .volter/tracker/validation/preset.cjs, preserving your edits. Conflicts are\n` +
        `         written as <<<<<<< markers to resolve; then run '${command} check'.\n`);
      return;
    }
    if (action === 'upgrade') {
      const result = upgradeTrackerPreset(projectRootFrom());
      if (result.status === 'up-to-date') {
        process.stdout.write(`${statusMark('pass')} ${ui.green('Preset is up to date')} ${ui.dim(`with the installed ztrack (${result.installedFrom})`)}\n`);
      } else if (result.status === 'no-base') {
        process.stdout.write(`${statusMark('warn')} ${ui.yellow('No pristine base recorded')} ${ui.dim("— this repo was init'd before upgrade support.")}\n  ${ui.dim('Seed')} ${ui.dim(result.entrypoint.replace('preset.cjs', '.preset.base.cjs'))} ${ui.dim('from the ztrack version you installed, then re-run.')}\n`);
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
      process.stdout.write(`Usage: ${command} loop <start <issue> [--max N] | stop | status>\n\nArms a loop-scoped ztrack gate. While armed, the Stop hook keeps the agent going until <issue> passes \`${command} check\` (then it disarms), or the iteration cap trips (status then shows it capped). start writes ${stateDirName()}/.ztrack-loop.json; stop removes it.\n`);
      return;
    }
    if (action === 'start') {
      const issue = args[2];
      if (!issue || issue.startsWith('-')) throw new Error(`${command} loop start: needs an issue id, e.g. \`${command} loop start ZT-1\``);
      const maxRaw = optionValue(args, '--max');
      const maxIterations = maxRaw && Number.isInteger(Number(maxRaw)) && Number(maxRaw) > 0 ? Number(maxRaw) : 8;
      mkdirSync(stateDir, { recursive: true });
      ensureTrackerGitignore(root); // so the loop's runtime/exempt files are ignored even on a repo init'd before the loop existed
      sweepRuntime();
      if (existsSync(cappedPath)) rmSync(cappedPath); // a fresh arm clears any prior cap breadcrumb
      writeFileSync(marker, `${JSON.stringify({ issue, maxIterations, startedAt: new Date().toISOString() }, null, 2)}\n`);
      process.stdout.write(`${statusMark('pass')} ${ui.green('loop armed')} ${ui.dim(`→ ${issue} (max ${maxIterations}); the Stop gate now holds the turn until ${issue} is green`)}\n`);
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
        process.stdout.write(`${statusMark('info')} ${ui.bold(`loop armed → ${m.issue}`)} ${ui.dim(`(max ${m.maxIterations}, since ${m.startedAt})`)}\n`);
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
    // The DURABLE escape: an authority records that <issue>'s failing state is knowingly
    // accepted. A valid (reasoned + signed-off + fresh) waiver downgrades the issue's
    // errors to 'acknowledged' so `check` passes — but it is anchored to the commit + the
    // acceptance-criteria fingerprint, so it auto-stales the moment either drifts.
    const action = args[1];
    const projectRoot = projectRootFrom();
    if (!action || ['--help', '-h', 'help'].includes(action)) {
      process.stdout.write(`Usage: ${command} waiver <sign <issue> --reason "..." | clear <issue> | status <issue>>\n\nRecords a freshness-anchored acknowledgment on <issue>, signed off as your git identity. A valid waiver downgrades that issue's errors to 'acknowledged' so \`${command} check\` passes; it auto-stales when the acceptance criteria change, and an unreasoned waiver is itself an error. Prefer descoping an AC (\`status: descoped reason: …\`) when the criterion is genuinely out of scope.\n`);
      return;
    }
    const id = args[2];
    if (!id || id.startsWith('-')) throw new Error(`${command} waiver ${action}: needs an issue id, e.g. \`${command} waiver ${action} APP-1\``);
    const wClient = createTrackerClient();
    const issueView = await wClient.issue.view(id, { json: 'body' });
    const body = String((issueView as Record<string, unknown>).body ?? '');
    if (action === 'sign') {
      const reason = optionValue(args, '--reason');
      if (!reason) throw new Error(`${command} waiver sign: --reason "<why this failing state is acceptable>" is required`);
      // Sign-off is the git identity, not a free-text name: a waiver records who actually
      // signed it (the same identity that authors commits), captured automatically.
      const gitName = git(projectRoot, ['config', 'user.name']);
      const gitEmail = git(projectRoot, ['config', 'user.email']);
      // `Name (email)`, not the git-canonical `Name <email>` — angle brackets get mangled
      // by the markdown round-trip (treated as an autolink), parens survive cleanly.
      const approvedBy = gitName && gitEmail ? `${gitName} (${gitEmail})` : (gitName || gitEmail);
      if (!approvedBy) throw new Error(`${command} waiver sign: no git identity configured. Set one (\`git config user.name\` / \`user.email\`) — a waiver must record who signed it.`);
      const root = await exportTrackerRoot({ projectRoot, issues: [id] });
      const issue = root.issues.find((i) => i.id === id);
      if (!issue) throw new Error(`${command} waiver sign: issue ${id} not found in the tracker`);
      const fingerprint = issueAcFingerprint(issue);
      const section = `## Waiver\n\nreason: ${reason}\nby: ${approvedBy}\nac-version: ${fingerprint}\n`;
      const newBody = `${stripWaiverSection(body).replace(/\s+$/, '')}\n\n${section}`;
      await wClient.issue.edit(id, { body: newBody });
      process.stdout.write(`${statusMark('pass')} ${ui.green('waiver signed')} ${ui.dim(`→ ${id} by ${approvedBy}, anchored to the acceptance criteria (${fingerprint}). It auto-stales if those criteria change.`)}\n`);
      return;
    }
    if (action === 'clear') {
      await wClient.issue.edit(id, { body: stripWaiverSection(body) });
      process.stdout.write(`${statusMark('pass')} ${ui.dim(`waiver cleared on ${id}`)}\n`);
      return;
    }
    if (action === 'status') {
      const has = /^##\s+waiver\b/im.test(body);
      process.stdout.write(has
        ? `${statusMark('info')} ${ui.bold(`${id} carries a waiver`)} ${ui.dim(`(run \`${command} check\` to see whether it is fresh and honored)`)}\n`
        : `${statusMark('info')} ${ui.dim(`${id} has no waiver`)}\n`);
      return;
    }
    throw new Error(`${command} waiver: unknown action '${action}'. Try 'sign <issue> --reason ... --by ...', 'clear <issue>', or 'status <issue>'.`);
  }

  if (args[0] === 'issue' && args[1] === 'scaffold') {
    const title = optionValue(args, '--title') || 'New case';
    process.stdout.write(activePresetScaffold(title) ?? scaffoldCaseBody(title));
    return;
  }

  if (args[0] === 'fmt') {
    const inputPath = optionValue(args, '--input');
    const issueId = optionValue(args, '--issue');
    const write = args.includes('--write');
    const checkOnly = args.includes('--check');
    let text: string;
    if (inputPath) {
      text = readFileSync(isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath), 'utf8');
    } else if (issueId) {
      const fmtClient = createTrackerClient();
      const issue = await fmtClient.issue.view(issueId, { json: 'body' });
      text = String((issue as Record<string, unknown>).body ?? '');
    } else {
      throw new Error("tracker fmt: provide --issue <id> or --input <file> (plus --write to apply, --check to verify)");
    }
    const formatted = canonicalizeIssueMarkdown(text);
    const canonical = text === formatted;
    if (checkOnly) {
      process.stdout.write(canonical ? 'canonical\n' : 'NOT canonical (run tracker fmt --write)\n');
      process.exitCode = canonical ? 0 : 1;
      return;
    }
    if (write) {
      if (canonical) { process.stdout.write('already canonical\n'); return; }
      if (issueId) {
        const fmtClient = createTrackerClient();
        await fmtClient.issue.edit(issueId, { body: formatted });
        process.stdout.write(`formatted ${issueId}\n`);
      } else {
        writeFileSync(isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath), formatted);
        process.stdout.write(`formatted ${inputPath}\n`);
      }
      return;
    }
    process.stdout.write(formatted);
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

  if (await handleEvidenceCommand(args, client)) return;

  if (args[0] === 'ac') {
    const action = args[1];
    const issueId = args[2];
    const acId = args[3];
    if (!action || !issueId || !acId || !['check', 'uncheck', 'set-status', 'block', 'unblock'].includes(action)) {
      throw new Error('usage: tracker ac <check|uncheck|set-status|block|unblock> <issue> <acId> [refs...] [--commit sha] [--evidence E1,E2] [--proof P1] [--status s] [--blocks] [--no-anchor] [--dry-run]');
    }
    const issue = await client.issue.view(issueId, { json: 'body' });
    const body = String((issue as Record<string, unknown>).body ?? '');
    const evidence = optionValue(args, '--evidence').split(',').map((s) => s.trim()).filter(Boolean);
    const proof = optionValue(args, '--proof').split(',').map((s) => s.trim()).filter(Boolean);
    // for block/unblock: positional refs after the acId; --blocks selects the forward edge.
    const blockField = args.includes('--blocks') ? 'blocks' as const : 'blocked-by' as const;
    const refs = args.slice(4).filter((a) => !a.startsWith('--'));
    const result = action === 'check'
      ? applyAcMutation(body, {
          op: 'check', acId,
          ...(optionValue(args, '--commit') ? { commit: optionValue(args, '--commit') } : {}),
          ...(evidence.length ? { evidence } : {}),
          ...(proof.length ? { proof } : {}),
          anchor: !args.includes('--no-anchor'),
        })
      : action === 'uncheck'
        ? applyAcMutation(body, { op: 'uncheck', acId })
      : action === 'block'
        ? applyAcMutation(body, { op: 'block', acId, field: blockField, refs })
      : action === 'unblock'
        ? applyAcMutation(body, { op: 'unblock', acId, field: blockField, ...(refs.length ? { refs } : {}) })
        : applyAcMutation(body, { op: 'set-status', acId, status: optionValue(args, '--status') as AcStatus });
    const willBePassed = action === 'check'
      || (action === 'set-status' && optionValue(args, '--status') === 'passed');
    if (!args.includes('--dry-run')) {
      const gate = willBePassed && result.changed;
      const gateRoot = gate ? projectRootFrom() : '';
      const errorSig = (f: { code: string; issueId?: string; acId?: string }): string =>
        `${f.code}|${f.issueId ?? ''}|${f.acId ?? ''}`;
      const errorsBefore = gate
        ? new Set((await checkTracker({ projectRoot: gateRoot, issues: [issueId], verifyCommits: true }))
            .findings.filter((f) => f.severity === 'error').map(errorSig))
        : new Set<string>();
      await client.issue.edit(issueId, { body: result.body });
      if (gate) {
        const after = await checkTracker({ projectRoot: gateRoot, issues: [issueId], verifyCommits: true });
        const introduced = after.findings
          .filter((f) => f.severity === 'error' && !errorsBefore.has(errorSig(f)));
        if (introduced.length > 0) {
          await client.issue.edit(issueId, { body }); // revert — the bad state must not persist
          throw new Error(
            `Refusing to mark ${acId} on ${issueId} passed: the check introduces validation errors (checked without the evidence its rule requires).\n`
            + introduced.map((f) => `  - ${f.code}: ${f.message}`).join('\n')
            + `\nSupply the evidence (e.g. --commit <sha> --evidence E1 --proof P1, or add the required Evidence entry first), then re-run.`,
          );
        }
      }
    }
    process.stdout.write(`${JSON.stringify({ issue: issueId, acId, changed: result.changed, dryRun: args.includes('--dry-run'), itemAfter: result.itemAfter }, null, 2)}\n`);
    return;
  }

  if (await handleCheckCommand(args)) return;

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
}

main().catch((error) => {
  console.error(`${statusMark('fail')} ${ui.red(error instanceof Error ? error.message : String(error))}`);
  process.exit(1);
});
