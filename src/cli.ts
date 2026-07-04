#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportTrackerRoot } from './export.ts';
import { checkTracker } from './check.ts';
import * as githubSync from './sync/github/index.ts';
import { loadTrackerConfig, projectRootFrom, trackerConfigPath } from './config.ts';
import { upgradeTrackerPreset } from './presetCatalog.ts';
import { migrateLocalToMarkdown } from './migrateLocal.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { serveMcp } from './mcp.ts';
import { createTrackerClient } from './sdk.ts';
import { optionValue } from './cliArgs.ts';
import { handleApiCommand } from './cliApi.ts';
import { handleEvidenceCommand } from './cliEvidence.ts';
import { commandName, printHelp, printIssueActionHelp, printResourceHelp, scaffoldCaseBody } from './cliHelp.ts';
import { handleCheckCommand } from './cliCheck.ts';
import { handleImportCommand } from './cliImport.ts';
import { handleCompletionsCommand } from './cliCompletions.ts';
import { handleWaiverCommand } from './cliWaiver.ts';
import { handleLoopCommand } from './cliLoop.ts';
import { handleInitCommand } from './cliInit.ts';
import { handleIssueListFrontier } from './cliFrontier.ts';
import { handleFmtCommand } from './cliFmt.ts';
import { handleTxCommand } from './cliTx.ts';
import { handleLintCommand } from './cliLint.ts';
import { handleSyncCommand } from './cliSync.ts';
import { handlePatchCommand } from './cliPatch.ts';
import { isMutatingCommand, observeAfterMutation } from './cliAudit.ts';
import { heading, statusMark, ui } from './cliStyle.ts';

// The installed preset is `.volter/tracker/validation/preset.mts`, loaded at runtime via Node's
// type-stripping — which prints a one-time "ExperimentalWarning: Type Stripping" on every command.
// It's not actionable for ztrack users and reads like a fault, so drop exactly that one warning;
// every other warning (including other experimental ones) still passes through untouched.
const __emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
  if (type === 'ExperimentalWarning' && String(warning).includes('Type Stripping')) return;
  return (__emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = commandName();
  if (!args.length || ['help', '--help', '-h'].includes(args[0]!)) {
    printHelp();
    return;
  }
  // `--version` must work standalone — never touch tracker config (a verification tool that
  // can't report its own version is a bad look). Read the package the CLI shipped from.
  if (['--version', '-v', 'version'].includes(args[0]!)) {
    try {
      const v = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version;
      process.stdout.write(`ztrack ${v ?? 'unknown'}\n`);
    } catch { process.stdout.write('ztrack (version unknown)\n'); }
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

  if (await handleInitCommand(args)) return;

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

  if (await handleLoopCommand(args)) return;

  if (await handleWaiverCommand(args)) return;

  if (await handleImportCommand(args)) return;

  // ZTB-21 dev/03: `ingest` is not, and has never been, a top-level verb — the only prior
  // `ingest` was `evidence ingest` (a signed DSSE-bundle importer), long since renamed to
  // `evidence add` (see cliEvidence.ts's `evidence add`, "Ingest an evidence file"). A bare
  // `ztrack ingest <file>` (as reported) has the exact shape of `ztrack import <path-or-glob>`
  // (ZTB-14: materialize a freeform backlog in place) — almost certainly what's meant. Caught
  // HERE, before any backend is reached, instead of a generic "unsupported command" from the
  // markdown backend with no hint at all.
  if (args[0] === 'ingest') {
    const rest = args.slice(1).join(' ');
    const suggested = rest ? `${command} import ${rest}` : `${command} import <path-or-glob>`;
    throw new Error(
      `ztrack: 'ingest' is not a command — did you mean '${suggested}'? ` +
      `(materializes a freeform backlog into tracked issues; see '${command} import --help'). ` +
      `If you meant the old signed-evidence importer, that's now '${command} evidence add <file>'.`
    );
  }

  if (args[0] === 'issue' && args[1] === 'scaffold') {
    const title = optionValue(args, '--title') || 'New case';
    process.stdout.write((await activePresetScaffold(title)) ?? (await scaffoldCaseBody(title)));
    return;
  }

  if (await handleFmtCommand(args)) return;

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
      // Our pid, so the server self-reaps if WE are SIGKILLed (no signal reaches it
      // then, and it would otherwise be orphaned to PID 1 forever). It polls this
      // specific pid rather than ppid — immune to bun cold-start reparenting races.
      ZTRACK_VIZ_PARENT_PID: String(process.pid),
    };
    const port = optionValue(args, '--port');
    if (port) env.PORT = port;
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn('bun', ['run', serverEntry], { stdio: 'inherit', env });
      // Bind the Bun server's lifetime to this wrapper. Without this, killing the
      // wrapper (a programmatic launch, a session/agent teardown — not an interactive
      // Ctrl-C, which signals the whole terminal group) reparents the child to PID 1
      // and leaks an immortal server; they accumulate across a busy fleet. Kill it on
      // our own exit/signals. (If WE are SIGKILLed no handler runs — server.ts also
      // self-reaps when it sees itself reparented to PID 1.)
      const killChild = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };
      process.on('exit', killChild);
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.once(sig, () => { killChild(); process.exit(sig === 'SIGINT' ? 130 : 143); });
      }
      child.on('error', (error) => rejectPromise(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error('ztrack visualizer requires Bun (https://bun.sh) — the visualizer is a Bun app.')
          : error,
      ));
      child.on('exit', (code) => { process.exitCode = code ?? 0; resolvePromise(); });
    });
    return;
  }

  // ZTB-30: `issue list --actionable|--blocked` (the dispatch frontier) — same "resolves its own
  // project, dispatched before createTrackerClient" shape as check/export just below, because it
  // needs the VALIDATED root + preset.isIssueDone (checkTracker), not the raw canonical rows the
  // generic backend dispatch reads. A plain `issue list` (neither flag) returns false and falls
  // through to the unchanged path.
  if (await handleIssueListFrontier(args)) return;

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
  if (await handleApiCommand(args)) return;

  if (await handleTxCommand(args)) return;

  if (await handleLintCommand(args)) return;

  if (args[0] === 'annotations') {
    throw new Error('ztrack annotations requires a configured world store (a mirrored world to annotate). See docs/EVIDENCE.md#advanced-validating-against-a-mirrored-world.');
  }

  // Two-way GitHub issue sync through the twin. Auth is the gh CLI (or GITHUB_TOKEN) — never a
  // prompted PAT. A synced issue IS the GitHub issue (binding in .volter/sync/github.json).
  if (await handleSyncCommand(args)) return;

  if (await handleEvidenceCommand(args)) return;

  // The one model edit: parse -> overlay a typed fragment -> validate -> serialize.
  //   tracker ac patch <issue> <acId> --json '{"checked":true,"status":"passed", ...}'
  //   tracker issue patch <issue>     --json '{"status":"done"}'
  // The patch fields are the active preset's SCHEMA shape (run `issue view` to see it); the
  // preset owns the grammar and renders it. The claim is then verified by `ztrack check`.
  if (await handlePatchCommand(args)) return;

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
  const isCreate = args[0] === 'issue' && args[1] === 'create';
  // `issue create`'s JSON has no trailing newline; without one it glues to the `✓ created` line
  // below. Terminate it so stdout is a clean line (still valid JSON for piping).
  if (result.stdout) process.stdout.write(isCreate && !result.stdout.endsWith('\n') ? `${result.stdout}\n` : result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  // `issue create` emits the new issue as JSON on stdout (machine-readable, pipeable). A first-time
  // human reads a wall of JSON and can't tell it worked — add a one-line confirmation on STDERR so
  // stdout stays clean for piping. Identifier is parsed from the JSON the backend already returned.
  if (isCreate && result.stdout && !result.stderr) {
    try {
      const id = (JSON.parse(result.stdout) as { identifier?: string }).identifier;
      if (id) {
        process.stderr.write(`${statusMark('pass')} ${ui.green(`created ${id}`)}\n`);
        // A create is never silently invalid: run the new record through the installed preset's
        // parse+schema (the same pipeline `ztrack check` runs) and surface any findings. Defaults
        // keep a bare create conformant; an explicit flag override that isn't (e.g. --state
        // in-review with no ACs) is now visible instead of a silent mint. Best-effort — `ztrack
        // check` remains the source of truth, this is just immediate feedback.
        try {
          const verify = await checkTracker({ issues: [id] });
          if (verify.findings.length) {
            process.stderr.write(`${statusMark('warn')} ${ui.yellow(`${id} does not fully conform to the installed preset:`)}\n`);
            for (const f of verify.findings) process.stderr.write(`  ${ui.dim(`${f.code}: ${f.message}`)}\n`);
          }
        } catch { /* validation entrypoint not resolvable here — skip, `ztrack check` still catches it */ }
      }
    } catch { /* non-JSON output (e.g. a non-markdown backend) — skip the confirmation */ }
  }
  // A backend error (unknown verb, not-found, not-implemented) reports on stderr with no stdout.
  // Without this it would exit 0 — a silent no-op that lets scripts/agents believe a bad command worked.
  if (result.stderr && !result.stdout) process.exitCode = 1;
}

// After a mutating command SUCCEEDS, observe the tracker and append audit entries (ztrack #19 —
// CLI writes now populate `.audit.jsonl`). Best-effort and post-hoc: it runs off the final on-disk
// state, never gates the command, and preserves whatever exit code the command set. A command that
// threw skips this (its `.catch` handles it) — we don't audit a failed write.
main()
  .then(async () => {
    if (isMutatingCommand(process.argv.slice(2))) await observeAfterMutation();
  })
  .catch((error) => {
    console.error(`${statusMark('fail')} ${ui.red(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  });
