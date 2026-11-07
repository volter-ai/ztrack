// `ztrack lint` — issue-body lint (structure warnings), read-only. Extracted from cli.ts
// (ZTB-28 dev/04), following the established verb-module pattern (cliImport.ts/cliWaiver.ts/
// cliLoop.ts): flag parsing + terminal rendering only, dispatched from cli.ts's main().
import { optionValue } from './cliArgs.ts';
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { lintIssueBody } from './lint.ts';
import { createTrackerClient } from './sdk.ts';
import { statusMark, ui } from './cliStyle.ts';

/** `ztrack lint [--issues a,b] [--json] [--fail-on-warn]`. Returns true once handled. */
export async function handleLintCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'lint') return false;
  const client = createTrackerClient();
  const projectRoot = projectRootFrom();
  const issuesFilter = optionValue(args, '--issues');
  const issueSet = issuesFilter ? new Set(issuesFilter.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const config = loadTrackerConfig(projectRoot);
  const rows = await client.issue.list({ state: 'all', limit: 5000, json: 'identifier,body' });
  const cases = (Array.isArray(rows) ? rows : []) as Array<{ identifier?: string; body?: string }>;
  const linted = cases.filter((c) => !issueSet || issueSet.has(String(c.identifier ?? '')));
  const findings = linted.flatMap((c) => lintIssueBody(String(c.body ?? ''), String(c.identifier ?? ''), config));
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ findings }, null, 2)}\n`);
  } else {
    for (const f of findings) process.stdout.write(`${f.severity.toUpperCase()} ${f.rule}: issue=${f.issue} ${f.message} | ${f.excerpt ?? ''}\n`);
    // Audible success: silence used to be indistinguishable from a no-op (0 findings and a
    // broken command both printed nothing). Now every plain-text run ends with one summary
    // line, pass or fail, naming both the finding count and how many issues were scanned.
    const summary = `${findings.length} findings across ${linted.length} issue${linted.length === 1 ? '' : 's'}`;
    const mark = findings.length === 0 ? statusMark('pass') : statusMark('fail');
    const colored = findings.length === 0 ? ui.green(summary) : ui.red(summary);
    process.stdout.write(`${mark} ztrack lint: ${colored}\n`);
  }
  process.exitCode = findings.some((f) => f.severity === 'error') || (args.includes('--fail-on-warn') && findings.length > 0) ? 1 : 0;
  return true;
}
