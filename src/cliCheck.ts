import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { checkTracker, checkTrackerRoot, type TrackerCheckResult } from './check.ts';
import { exportTrackerRoot } from './export.ts';
import { optionValue } from './cliArgs.ts';
import { projectRootFrom } from './config.ts';
import { renderCheckReport, renderScopedReport, summarizeResult } from './cliStyle.ts';
import { git } from './core/gitWorld.ts';
import { partitionFindings, resolveActiveIssue } from './core/scope.ts';
import type { RuleCategory } from './checkRules.ts';

async function writeOutput(text: string, outPath: string): Promise<void> {
  if (!outPath) { process.stdout.write(text); return; }
  writeFileSync(outPath, text);
  process.stdout.write(`${outPath}\n`);
}

function parseCategories(flag: string): Partial<Record<RuleCategory, number>> | undefined {
  if (!flag) return undefined;
  return Object.fromEntries(flag.split(',').map((pair) => {
    const [c, d] = pair.split('=');
    const depth = Number(d);
    if (!c?.trim() || d === undefined || !Number.isInteger(depth) || depth < 0) {
      throw new Error(`invalid --categories entry '${pair}' (expected name=N where N is a non-negative integer)`);
    }
    return [c.trim(), depth];
  })) as Partial<Record<RuleCategory, number>>;
}

const KNOWN_FLAGS: Record<string, Set<string>> = {
  export: new Set(['--out', '--issues']),
  check: new Set(['--input', '--issues', '--case', '--categories', '--phase', '--fail-on-warning', '--verify-commits', '--errors-only', '--output', '--json', '--max-findings', '--auto-scope']),
};

/** `ztrack check` (validate the live tracker or a committed validated root) and
 *  `ztrack export` (write the validated root). One pipeline; no snapshot model. */
export async function handleCheckCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'check' && args[0] !== 'export') return false;
  const action = args[0];
  const flagArgs = args.slice(1);
  if (flagArgs[0] === '--help' || flagArgs[0] === '-h' || flagArgs[0] === 'help') {
    process.stdout.write(action === 'export'
      ? 'Usage: ztrack export [--out file] [--issues a,b]\n\nWrites the validated root ({ issues: [...] }) — the same model rules and the visualizer read.\n'
      : 'Usage: ztrack check [--input root.json] [--issues a,b] [--categories name=N,...] [--phase all|gate] [--auto-scope] [--verify-commits] [--fail-on-warning] [--errors-only] [--json] [--output file] [--max-findings N]\n\n--phase gate runs only the ongoing-gate rules (excludes transition/promotion-time authoring checks); default all runs every rule.\n--auto-scope checks the whole tracker for context but only EXITS NONZERO on the issue this git checkout is for (resolved from the branch/worktree name); other issues become informational. Unresolved scope fails closed (gates everything). Built for per-worktree Stop-hook gates.\n');
    return true;
  }
  const allowed = KNOWN_FLAGS[action]!;
  const unknown = flagArgs.filter((t) => t.startsWith('--') && !allowed.has(t));
  if (unknown.length) throw new Error(`ztrack ${action}: unknown flag(s) ${unknown.join(', ')}. Valid flags: ${[...allowed].join(' ')}`);

  const projectRoot = projectRootFrom();
  const issuesFilter = optionValue(flagArgs, '--issues') || optionValue(flagArgs, '--case');
  const issues = issuesFilter ? issuesFilter.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  if (action === 'export') {
    const root = await exportTrackerRoot({ projectRoot, ...(issues ? { issues } : {}) });
    await writeOutput(`${JSON.stringify(root, null, 2)}\n`, optionValue(flagArgs, '--out'));
    return true;
  }

  const categories = parseCategories(optionValue(flagArgs, '--categories'));
  const failOnWarning = flagArgs.includes('--fail-on-warning');
  const verifyCommits = flagArgs.includes('--verify-commits') ? true : undefined;
  const phaseRaw = optionValue(flagArgs, '--phase');
  if (phaseRaw && phaseRaw !== 'all' && phaseRaw !== 'gate') throw new Error(`ztrack check: --phase must be 'all' or 'gate' (got '${phaseRaw}')`);
  const phase = phaseRaw === 'gate' || phaseRaw === 'all' ? phaseRaw : undefined;
  const inputPath = optionValue(flagArgs, '--input');
  let inputRoot: unknown;
  if (inputPath) {
    const abs = isAbsolute(inputPath) ? inputPath : resolve(projectRoot, inputPath);
    let raw: string;
    try {
      if (statSync(abs).size > 128 * 1024 * 1024) throw new Error(`ztrack check: --input file ${abs} is too large (>128 MiB)`);
      raw = readFileSync(abs, 'utf8');
    } catch (e) { throw e instanceof Error && e.message.startsWith('ztrack check:') ? e : new Error(`ztrack check: cannot read --input file ${abs}`); }
    try { inputRoot = JSON.parse(raw); } catch (e) { throw new Error(`ztrack check: --input ${abs} is not valid JSON (${(e as Error).message}). It should be a validated root written by 'ztrack export'.`); }
  }
  const result: TrackerCheckResult = inputPath
    ? await checkTrackerRoot(inputRoot, { projectRoot, ...(issues ? { issues } : {}), ...(categories ? { categories } : {}), ...(phase ? { phase } : {}), ...(verifyCommits !== undefined ? { verifyCommits } : {}) })
    : await checkTracker({ projectRoot, ...(issues ? { issues } : {}), ...(categories ? { categories } : {}), ...(phase ? { phase } : {}), failOnWarning, ...(verifyCommits !== undefined ? { verifyCommits } : {}) });

  const outputPath = optionValue(flagArgs, '--output');
  const wantsJson = flagArgs.includes('--json');
  const errorsOnly = flagArgs.includes('--errors-only');
  const rawMax = optionValue(flagArgs, '--max-findings');
  const parsedMax = Number(rawMax);
  const maxFindings = rawMax && Number.isInteger(parsedMax) && parsedMax >= 0 ? parsedMax : 120;

  // --auto-scope: validate the whole tracker (so cross-issue rules stay correct),
  // but gate (exit nonzero) only on the issue THIS checkout is for — resolved from
  // the git branch/worktree name. Git reads go through gitWorld's `git()`, the one
  // sanctioned boundary; resolution + partition are pure.
  if (flagArgs.includes('--auto-scope')) {
    const branch = git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) || undefined;
    const top = git(projectRoot, ['rev-parse', '--show-toplevel']);
    const worktree = top ? basename(top) : undefined;
    const issueIds = (result.export?.issues ?? []).map((i) => i.id);
    const { issueId, reason } = resolveActiveIssue({ ...(branch ? { branch } : {}), ...(worktree ? { worktree } : {}), issueIds });
    const { blocking, informational } = partitionFindings(result.findings, issueId);

    const blockingErrors = blocking.some((f) => f.severity === 'error');
    const scopedFailed = blockingErrors || (failOnWarning && blocking.length > 0);
    const scopedPayload = {
      ok: !blockingErrors,
      activeIssue: issueId,
      scope: { branch: branch ?? null, worktree: worktree ?? null, reason },
      summary: summarizeResult({ ...result, findings: blocking }),
      findings: blocking,
      informational,
    };
    if (outputPath) writeFileSync(isAbsolute(outputPath) ? outputPath : resolve(projectRoot, outputPath), `${JSON.stringify(scopedPayload, null, 2)}\n`);
    if (wantsJson) {
      process.stdout.write(`${JSON.stringify(scopedPayload, null, 2)}\n`);
    } else {
      process.stdout.write(renderScopedReport(result, { activeIssue: issueId, reason, blocking, informational, errorsOnly, maxFindings }));
    }
    process.exitCode = scopedFailed ? 1 : 0;
    return true;
  }

  const failed = !result.ok || (failOnWarning && result.findings.length > 0);
  const payload = { ok: result.ok, summary: summarizeResult(result), findings: result.findings };
  if (outputPath) writeFileSync(isAbsolute(outputPath) ? outputPath : resolve(projectRoot, outputPath), `${JSON.stringify(payload, null, 2)}\n`);
  if (wantsJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(renderCheckReport(result, { errorsOnly, maxFindings }));
  }
  process.exitCode = failed ? 1 : 0;
  return true;
}
