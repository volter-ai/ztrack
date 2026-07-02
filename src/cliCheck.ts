import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { checkFile, checkTracker, checkTrackerRoot, type TrackerCheckResult } from './check.ts';
import { exportTrackerRoot } from './export.ts';
import { optionValue } from './cliArgs.ts';
import { projectRootFrom } from './config.ts';
import { renderCheckReport, renderScopedReport, summarizeResult } from './cliStyle.ts';
import { git } from './core/gitWorld.ts';
import { partitionFindings, resolveActiveIssue } from './core/scope.ts';
import { positionalArgs, resolveTarget } from './cliTarget.ts';
import { readLoopMarker } from './loopState.ts';
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
  check: new Set(['--input', '--issues', '--case', '--categories', '--phase', '--fail-on-warning', '--verify-commits', '--no-verify-commits', '--errors-only', '--output', '--json', '--max-findings', '--auto-scope', '--preset']),
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
      : 'Usage: ztrack check [<issue-id> | <file.md>] [--issues a,b] [--input root.json] [--categories name=N,...] [--phase all|gate] [--auto-scope] [--no-verify-commits] [--fail-on-warning] [--errors-only] [--json] [--output file] [--max-findings N] [--preset path]\n\nChecks against the installed preset (run `ztrack init` first). TARGET:\n  (none)            the whole tracker — or, in a worktree named for an issue, just that issue\n  <issue-id>        one tracker issue, e.g. `ztrack check ZT-1`\n  <file.md>         a loose markdown file treated as one issue, e.g. `ztrack check ./body.md`\n  --issues a,b      several tracker issues\nCommit existence is verified by default (the core guarantee). --no-verify-commits skips it for shallow/CI checkouts that lack the cited commits; --verify-commits is an accepted no-op alias.\n--phase gate runs only the ongoing-gate rules; default all runs every rule.\n--auto-scope checks the whole tracker for context but only EXITS NONZERO on the active issue — an armed loop target (`ztrack loop start`), else ZTRACK_ACTIVE_ISSUE, else the git branch/worktree. Unresolved fails closed (gates everything). Built for per-worktree Stop-hook gates.\n--preset path     load this validation preset module instead of the repo\'s configured entrypoint — an operator trust decision (like `eslint -c`), unconfined to the project, still required to export a core preset. Works with --input, a live-tracker check, and a loose-file check. Use for fork-PR CI: point it at a TRUSTED (base-ref) preset copy so the untrusted checkout\'s preset.mts never runs — see SECURITY.md.\n');
    return true;
  }
  const allowed = KNOWN_FLAGS[action]!;
  const unknown = flagArgs.filter((t) => t.startsWith('--') && !allowed.has(t));
  if (unknown.length) throw new Error(`ztrack ${action}: unknown flag(s) ${unknown.join(', ')}. Valid flags: ${[...allowed].join(' ')}`);

  const projectRoot = projectRootFrom();
  const issuesFilter = optionValue(flagArgs, '--issues') || optionValue(flagArgs, '--case');
  const issuesFromFlag = issuesFilter ? issuesFilter.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  if (action === 'export') {
    const root = await exportTrackerRoot({ projectRoot, ...(issuesFromFlag ? { issues: issuesFromFlag } : {}) });
    await writeOutput(`${JSON.stringify(root, null, 2)}\n`, optionValue(flagArgs, '--out'));
    return true;
  }

  const categories = parseCategories(optionValue(flagArgs, '--categories'));
  const failOnWarning = flagArgs.includes('--fail-on-warning');
  // Commit existence is verified by DEFAULT (it's the core guarantee). `--verify-commits` is kept
  // as an accepted no-op alias for back-compat; `--no-verify-commits` is the real escape hatch for
  // shallow clones / CI checkouts that lack the cited commits and would otherwise fail closed.
  const verifyCommits = flagArgs.includes('--no-verify-commits') ? false : undefined;
  const phaseRaw = optionValue(flagArgs, '--phase');
  if (phaseRaw && phaseRaw !== 'all' && phaseRaw !== 'gate') throw new Error(`ztrack check: --phase must be 'all' or 'gate' (got '${phaseRaw}')`);
  const phase: 'all' | 'gate' | undefined = phaseRaw === 'gate' || phaseRaw === 'all' ? phaseRaw : undefined;
  const inputPath = optionValue(flagArgs, '--input');
  const forceAuto = flagArgs.includes('--auto-scope');
  const outputPath = optionValue(flagArgs, '--output');
  const wantsJson = flagArgs.includes('--json');
  const errorsOnly = flagArgs.includes('--errors-only');
  const rawMax = optionValue(flagArgs, '--max-findings');
  const parsedMax = Number(rawMax);
  const maxFindings = rawMax && Number.isInteger(parsedMax) && parsedMax >= 0 ? parsedMax : 120;
  // `--preset <path>`: an operator-supplied validation preset, loaded in place of the repo's
  // configured entrypoint — see presetRegistry.ts's `loadOperatorPreset`. Threaded through
  // `commonOpts` so every check mode below (--input, live tracker, loose file, loop-file gate)
  // honors it uniformly via the one shared resolution point in check.ts.
  const presetPath = optionValue(flagArgs, '--preset') || undefined;
  const commonOpts = { projectRoot, ...(categories ? { categories } : {}), ...(phase ? { phase } : {}), ...(verifyCommits !== undefined ? { verifyCommits } : {}), ...(presetPath ? { presetPath } : {}) };

  // Resolve the unified TARGET. `--input` (a committed root artifact) is its own path and
  // ignores any positional; otherwise a positional/`--issues`/branch picks file|issues|auto|all.
  const VALUE_FLAGS = new Set(['--input', '--issues', '--case', '--categories', '--phase', '--output', '--max-findings', '--preset']);
  const positionals = inputPath ? [] : positionalArgs(flagArgs, VALUE_FLAGS);
  const target = inputPath ? null : resolveTarget({ positionals, ...(issuesFromFlag ? { issuesFlag: issuesFromFlag } : {}), forceAuto, cwd: process.cwd() });

  // FILE target: validate a loose markdown file as one issue (plain report; not scoped).
  if (target?.kind === 'file') {
    const result = await checkFile(target.path, { ...commonOpts, failOnWarning });
    return emitPlain(result, { failOnWarning, outputPath, projectRoot, wantsJson, errorsOnly, maxFindings });
  }

  // GATE MODE (`--auto-scope`, run by the Stop hook): an armed loop's target wins over the
  // branch. A FILE loop gates on that file directly (the file IS the whole gate).
  const loop = forceAuto ? readLoopMarker(projectRoot) : null;
  if (loop?.target.kind === 'file') {
    const result = await checkFile(loop.target.path, { ...commonOpts, failOnWarning });
    return emitPlain(result, { failOnWarning, outputPath, projectRoot, wantsJson, errorsOnly, maxFindings });
  }

  const issues = target?.kind === 'issues' ? target.ids : undefined;
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
    ? await checkTrackerRoot(inputRoot, { ...commonOpts, ...(issues ? { issues } : {}) })
    : await checkTracker({ ...commonOpts, ...(issues ? { issues } : {}), failOnWarning });

  // ISSUE target not in the tracker: error rather than silently passing on an empty filter.
  if (target?.kind === 'issues') {
    const present = new Set((result.export?.issues ?? []).map((i) => i.id));
    const missing = target.ids.filter((id) => !present.has(id));
    if (missing.length) throw new Error(`ztrack check: issue(s) not found in the tracker: ${missing.join(', ')}. Run \`ztrack issue list\` to see ids, or pass a path ending in .md to check a file.`);
  }

  // SCOPE: validate the whole tracker (so cross-issue rules stay correct) but gate only on the
  // active issue — from ZTRACK_ACTIVE_ISSUE (the loop arms it), else the git branch/worktree.
  // `--auto-scope` fails CLOSED when unresolved (gates everything, for the Stop hook); a bare
  // `check` scopes OPPORTUNISTICALLY — only when the branch resolves, else a plain full report.
  if (!inputPath && (forceAuto || target?.kind === 'auto' || target?.kind === 'all')) {
    const branch = git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) || undefined;
    const top = git(projectRoot, ['rev-parse', '--show-toplevel']);
    const worktree = top ? basename(top) : undefined;
    const issueIds = (result.export?.issues ?? []).map((i) => i.id);
    // Active issue precedence: explicit env override > armed loop target > branch/worktree.
    const loopIssue = loop?.target.kind === 'issues' ? loop.target.ids[0] : undefined;
    const explicit = process.env.ZTRACK_ACTIVE_ISSUE?.trim() || loopIssue;
    const { issueId, reason } = resolveActiveIssue({ ...(explicit ? { explicit } : {}), ...(branch ? { branch } : {}), ...(worktree ? { worktree } : {}), issueIds });
    if (issueId || forceAuto) { // resolved, or forced (forced+unresolved => everything blocks)
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
      if (wantsJson) process.stdout.write(`${JSON.stringify(scopedPayload, null, 2)}\n`);
      else process.stdout.write(renderScopedReport(result, { activeIssue: issueId, reason, blocking, informational, errorsOnly, maxFindings, projectRoot }));
      process.exitCode = scopedFailed ? 1 : 0;
      return true;
    }
    // bare check, branch did not resolve -> fall through to the plain full-tracker report.
  }

  return emitPlain(result, { failOnWarning, outputPath, projectRoot, wantsJson, errorsOnly, maxFindings });
}

// Plain (un-scoped) check report: the whole result is the gate. Shared by the all/issues/file
// targets so they render and exit identically.
function emitPlain(result: TrackerCheckResult, o: { failOnWarning: boolean; outputPath: string; projectRoot: string; wantsJson: boolean; errorsOnly: boolean; maxFindings: number }): boolean {
  const { failOnWarning, outputPath, projectRoot, wantsJson, errorsOnly, maxFindings } = o;
  const failed = !result.ok || (failOnWarning && result.findings.length > 0);
  const payload = { ok: result.ok, summary: summarizeResult(result), findings: result.findings };
  if (outputPath) writeFileSync(isAbsolute(outputPath) ? outputPath : resolve(projectRoot, outputPath), `${JSON.stringify(payload, null, 2)}\n`);
  if (wantsJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(renderCheckReport(result, { errorsOnly, maxFindings, projectRoot }));
  }
  process.exitCode = failed ? 1 : 0;
  return true;
}
