#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { checkTrackerSnapshot } from './check.ts';
import { canonicalizeIssueMarkdown } from './markdownModel.ts';
import { lintIssueBody } from './lint.ts';
import { applyTx, planTx } from './tx.ts';
import type { TxEdit } from './tx.ts';
import { applyAcMutation } from './mutate.ts';
import type { AcStatus } from './mutate.ts';
import { initTrackerProject, projectRootFrom, trackerConfigPath } from './config.ts';
import { exportTrackerSnapshot } from './export.ts';
import { serveMcp } from './mcp.ts';
import { serveTrackerApi } from './server.ts';
import { createTrackerClient } from './sdk.ts';
import { optionValue } from './cliArgs.ts';
import { handleEvidenceCommand } from './cliEvidence.ts';
import { commandName, printHelp, printIssueActionHelp, printResourceHelp, scaffoldCaseBody } from './cliHelp.ts';
import { handleSnapshotCommand } from './cliSnapshot.ts';
import { commandLine, heading, statusMark, ui } from './cliStyle.ts';

async function readStdinIfPiped(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length ? text : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = commandName();
  if (!args.length || ['help', '--help', '-h'].includes(args[0]!)) {
    printHelp();
    return;
  }

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
    const result = initTrackerProject(root, optionValue(args, '--team') || 'LOCAL');
    if (result.alreadyInitialized) {
      process.stdout.write(`${statusMark('pass')} ${ui.green('Already initialized')} ${ui.dim(result.configPath)}\n`);
      return;
    }
    const configPath = result.configPath;
    const teamKey = result.teamKey;
    process.stdout.write([
      `${statusMark('pass')} ${heading('Initialized ztrack', ui.dim(`team ${teamKey}`))}`,
      `  ${ui.dim(configPath)}`,
      '',
      ui.bold('Next steps'),
      commandLine(`${command} issue scaffold --title "First case" > body.md`, 'write a starter case body'),
      commandLine(`${command} issue create --title "First case" --label type:case --state "In Progress" --body-file body.md`, 'create work in the local tracker'),
      commandLine(`${command} check`, 'verify checked claims before marking done'),
      '',
      ui.dim('Verification applies to issues with a recognized type label such as type:case or type:bug.'),
      ui.dim('Unrecognized checked work warns instead of passing silently.'),
      '',
    ].join('\n'));
    return;
  }

  if (args[0] === 'issue' && args[1] === 'scaffold') {
    const title = optionValue(args, '--title') || 'New case';
    process.stdout.write(scaffoldCaseBody(title));
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
    const snapshot = exportTrackerSnapshot({ projectRoot });
    const issuesFilter = optionValue(args, '--issues');
    const issueSet = issuesFilter ? new Set(issuesFilter.split(',').map((s) => s.trim()).filter(Boolean)) : null;
    const { loadTrackerConfig } = await import('./config.ts');
    const config = loadTrackerConfig(projectRoot);
    const findings = snapshot.cases
      .filter((c) => !issueSet || issueSet.has(c.identifier))
      .flatMap((c) => lintIssueBody(String((c as Record<string, unknown>).body ?? ''), c.identifier, config));
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify({ findings }, null, 2)}\n`);
    else for (const f of findings) process.stdout.write(`${f.severity.toUpperCase()} ${f.rule}: issue=${f.issue} ${f.message} | ${f.excerpt ?? ''}\n`);
    process.exitCode = findings.some((f) => f.severity === 'error') || (args.includes('--fail-on-warn') && findings.length > 0) ? 1 : 0;
    return;
  }

  if (args[0] === 'annotations') {
    throw new Error('tracker annotations requires @volter/twin; this command is not included in the public ztrack core package yet.');
  }

  if (await handleEvidenceCommand(args, client)) return;

  if (args[0] === 'ac') {
    const action = args[1];
    const issueId = args[2];
    const acId = args[3];
    if (!action || !issueId || !acId || !['check', 'uncheck', 'set-status'].includes(action)) {
      throw new Error('usage: tracker ac <check|uncheck|set-status> <issue> <acId> [--commit sha] [--evidence E1,E2] [--proof P1] [--status s] [--no-anchor] [--dry-run]');
    }
    const issue = await client.issue.view(issueId, { json: 'body' });
    const body = String((issue as Record<string, unknown>).body ?? '');
    const evidence = optionValue(args, '--evidence').split(',').map((s) => s.trim()).filter(Boolean);
    const proof = optionValue(args, '--proof').split(',').map((s) => s.trim()).filter(Boolean);
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
        : applyAcMutation(body, { op: 'set-status', acId, status: optionValue(args, '--status') as AcStatus });
    const willBePassed = action === 'check'
      || (action === 'set-status' && optionValue(args, '--status') === 'passed');
    if (!args.includes('--dry-run')) {
      const gate = willBePassed && result.changed;
      const gateRoot = gate ? projectRootFrom() : '';
      const errorSig = (f: { code: string; message: string; details?: unknown }): string =>
        `${f.code}|${f.message}|${JSON.stringify(f.details ?? {})}`;
      const errorsBefore = gate
        ? new Set((checkTrackerSnapshot(
            exportTrackerSnapshot({ projectRoot: gateRoot, issues: [issueId] }),
            { issues: [issueId] },
          ).findings ?? []).filter((f) => f.level === 'error').map(errorSig))
        : new Set<string>();
      await client.issue.edit(issueId, { body: result.body });
      if (gate) {
        const after = checkTrackerSnapshot(
          exportTrackerSnapshot({ projectRoot: gateRoot, issues: [issueId] }),
          { issues: [issueId] },
        );
        const introduced = (after.findings ?? [])
          .filter((f) => f.level === 'error' && !errorsBefore.has(errorSig(f)));
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

  if (await handleSnapshotCommand(args)) return;

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
