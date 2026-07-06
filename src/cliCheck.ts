import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { checkFile, checkTracker, checkTrackerRoot, type TrackerCheckResult } from './check.ts';
import { exportTrackerRoot } from './export.ts';
import { optionValue, optionValues, splitSelectors } from './cliArgs.ts';
import { projectRootFrom } from './config.ts';
import { renderCheckReport, renderScopedReport, summarizeResult } from './cliStyle.ts';
import { git } from './core/gitWorld.ts';
import { partitionFindings, resolveActiveIssue } from './core/scope.ts';
import { positionalArgs, resolveTarget } from './cliTarget.ts';
import { readLoopMarker } from './loopState.ts';
import { activeStatusEnum } from './presetRegistry.ts';
import type { Finding } from './core/engine.ts';
import { RULE_CATEGORIES, type RuleCategory } from './checkRules.ts';
import { flagSetFor } from './cliRegistry.ts';

async function writeOutput(text: string, outPath: string): Promise<void> {
  if (!outPath) { process.stdout.write(text); return; }
  writeFileSync(outPath, text);
  process.stdout.write(`${outPath}\n`);
}

// ZTB-19 (ZL-E4): the shape check (`name=N`) used to be the ONLY validation — an unknown
// category name (a typo, or a name from a different preset ecosystem) was accepted silently and
// then matched no rule's `category`, so the flag quietly did nothing. Now the name itself is
// checked against the engine's real `RuleCategory` vocabulary (src/checkRules.ts) — a hard error
// naming the valid options, not a warning, since this is bad flag input, not a soft finding.
function parseCategories(flag: string): Partial<Record<RuleCategory, number>> | undefined {
  if (!flag) return undefined;
  return Object.fromEntries(flag.split(',').map((pair) => {
    const [c, d] = pair.split('=');
    const depth = Number(d);
    if (!c?.trim() || d === undefined || !Number.isInteger(depth) || depth < 0) {
      throw new Error(`invalid --categories entry '${pair}' (expected name=N where N is a non-negative integer)`);
    }
    const name = c.trim();
    if (!(RULE_CATEGORIES as readonly string[]).includes(name)) {
      throw new Error(`invalid --categories entry '${pair}': unknown category '${name}'. Valid categories: ${RULE_CATEGORIES.join(', ')}`);
    }
    return [name, depth];
  })) as Partial<Record<RuleCategory, number>>;
}

// ZTB-24: this allow-list's flag SET now DERIVES from src/cliRegistry.ts — one source of truth
// shared with the new dispatch-time validator — instead of a hand-maintained second copy. The
// scan/error wording below (position-insensitive, its own message) is unchanged.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  export: flagSetFor(['export']),
  check: flagSetFor(['check']),
};

/** `ztrack check` (validate the live tracker or a committed validated root) and
 *  `ztrack export` (write the validated root). One pipeline; no snapshot model. */
export async function handleCheckCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'check' && args[0] !== 'export') return false;
  const action = args[0];
  const flagArgs = args.slice(1);
  // ZTB-24 dev/06: `--help`/`-h` anywhere in a check/export invocation prints the usage — not just
  // when it's the FIRST token. Before this, `check <target> --help` fell through to the
  // unknown-flag guard below (`--help` isn't in KNOWN_FLAGS) and errored instead of helping.
  if (flagArgs.some((a) => a === '--help' || a === '-h' || a === 'help')) {
    process.stdout.write(action === 'export'
      ? 'Usage: ztrack export [--out file] [--issues a,b]\n\nWrites the validated root ({ issues: [...] }) — the same model rules and the visualizer read.\n'
      : 'Usage: ztrack check [<issue-id> | <file.md>] [--issues a,b] [--source name,... (repeatable)] [--input root.json] [--categories name=N,...] [--phase all|gate] [--auto-scope] [--no-verify-commits] [--fail-on-warning] [--errors-only] [--json] [--output file] [--max-findings N] [--preset path]\n\nChecks against the installed preset (run `ztrack init` first) — that preset is Node code and this command EXECUTES it; only run against a repo whose preset.mts you trust (see SECURITY.md). TARGET:\n  (none)            the whole tracker — or, in a worktree named for an issue, just that issue\n  <issue-id>        one tracker issue, e.g. `ztrack check ZT-1`\n  <file.md>         a loose markdown file treated as one issue, e.g. `ztrack check ./body.md`\n  --issues a,b      several tracker issues (also scopes an --input root to those ids; a requested id absent from the root errors loud).\n  --source name,... scope to the named declared source(s) (ZTB-33; a source\'s config `name`, else its `path`, else its path basename) — validates only issues from those sources. Repeatable AND comma-separated (ZTB-40): occurrences and comma-parts union, order-preserving, deduped; any selector matching zero sources fails the whole invocation loud, naming it and the available names, even when other selectors matched.\nCommit existence is verified by default (the core guarantee). --no-verify-commits skips it for shallow/CI checkouts that lack the cited commits.\n--phase gate runs only the ongoing-gate rules; default all runs every rule.\n--fail-on-warning also gates on real warning-severity findings (never acknowledged/waived ones); the exit code, the pass/fail banner, and --json all agree on that same verdict.\n--auto-scope checks the whole tracker for context but only EXITS NONZERO on the active issue — an armed loop target (`ztrack loop start`), else ZTRACK_ACTIVE_ISSUE, else the git branch/worktree. Unresolved fails closed (gates everything). Built for per-worktree Stop-hook gates.\n--preset path     load this validation preset module instead of the repo\'s configured entrypoint — an operator trust decision (like `eslint -c`), unconfined to the project, still required to export a core preset. Works with --input, a live-tracker check, and a loose-file check. Use for fork-PR CI: point it at a TRUSTED (base-ref) preset copy so the untrusted checkout\'s preset.mts never runs — see SECURITY.md.\n');
    return true;
  }
  const allowed = KNOWN_FLAGS[action]!;
  // ZTB-40: strip a `--flag=value` token down to `--flag` before checking it against the allow-list
  // — mirrors cliImport.ts's own KNOWN_FLAGS scan, which already does this. Without it, a valid
  // value flag given in `=` form (e.g. `--source=alpha,beta`) was misreported as unknown, which
  // would have made the spec's "`--source=alpha,beta` behaves like the space form" contract false
  // for `check`/`export` — the bug was generic to every value flag here, not just --source.
  const unknown = flagArgs.filter((t) => t.startsWith('--') && !allowed.has(t.includes('=') ? t.slice(0, t.indexOf('=')) : t));
  if (unknown.length) throw new Error(`ztrack ${action}: unknown flag(s) ${unknown.join(', ')}. Valid flags: ${[...allowed].join(' ')}`);

  const projectRoot = projectRootFrom();
  const issuesFilter = optionValue(flagArgs, '--issues');
  const issuesFromFlag = issuesFilter ? issuesFilter.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  // ZTB-40: `--source` is repeatable AND each occurrence may be comma-separated (the one grammar
  // shared with `issue list` — see cliArgs.ts's `splitSelectors`/`optionValues`); occurrences and
  // comma-parts union, order-preserving, deduped. Threaded into commonOpts → checkTracker → loader
  // → backend; a selector matching zero sources errors in the backend's `selectSources` (loud even
  // when OTHER selectors in the same invocation matched — ZTB-40). Meaningless with `--input` (a
  // materialized root, no backend read) — silently ignored there, as scoping can only happen at the
  // live read.
  const sourceSelectors = splitSelectors(optionValues(flagArgs, '--source'));
  const sourcesFromFlag = sourceSelectors.length ? sourceSelectors : undefined;

  if (action === 'export') {
    const root = await exportTrackerRoot({ projectRoot, ...(issuesFromFlag ? { issues: issuesFromFlag } : {}) });
    await writeOutput(`${JSON.stringify(root, null, 2)}\n`, optionValue(flagArgs, '--out'));
    return true;
  }

  const categories = parseCategories(optionValue(flagArgs, '--categories'));
  const failOnWarning = flagArgs.includes('--fail-on-warning');
  // Commit existence is verified by DEFAULT (it's the core guarantee). `--verify-commits` (a
  // no-op back-compat alias for that default) was removed pre-1.0 (ZTB-42) — it's no longer
  // accepted; a stray occurrence now rejects loud as an unknown flag. `--no-verify-commits` is the
  // real escape hatch for shallow clones / CI checkouts that lack the cited commits and would
  // otherwise fail closed; it remains.
  const verifyCommits = flagArgs.includes('--no-verify-commits') ? false : undefined;
  const phaseRaw = optionValue(flagArgs, '--phase');
  if (phaseRaw && phaseRaw !== 'all' && phaseRaw !== 'gate') throw new Error(`ztrack check: --phase must be 'all' or 'gate' (got '${phaseRaw}')`);
  const phase: 'all' | 'gate' | undefined = phaseRaw === 'gate' || phaseRaw === 'all' ? phaseRaw : undefined;
  const inputPath = optionValue(flagArgs, '--input');
  // ZTB-33: `--source` scopes the LIVE backend read; `--input` validates an already-materialized
  // root (`ztrack export`) whose issues carry no source provenance (CoreIssue has no origin) — so a
  // post-hoc `--source` cannot be honored, and silently ignoring it (worse: ignoring a typo'd
  // source name with no error) would break the "unknown selector always fails loud" contract the
  // live path holds. Refuse the combination rather than pretend to scope.
  if (inputPath && sourcesFromFlag) {
    throw new Error(`ztrack check: --source cannot be combined with --input — a materialized root (from 'ztrack export') has no source provenance to scope by; scope was fixed when the root was exported. Run a live 'ztrack check --source ${sourcesFromFlag.join(',')}' instead. Nothing was read.`);
  }
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
  const commonOpts = { projectRoot, ...(categories ? { categories } : {}), ...(phase ? { phase } : {}), ...(verifyCommits !== undefined ? { verifyCommits } : {}), ...(presetPath ? { presetPath } : {}), ...(sourcesFromFlag ? { sources: sourcesFromFlag } : {}) };

  // Resolve the unified TARGET. `--input` (a committed root artifact) is its own path and
  // ignores any positional; otherwise a positional/`--issues`/branch picks file|issues|auto|all.
  const VALUE_FLAGS = new Set(['--input', '--issues', '--categories', '--phase', '--output', '--max-findings', '--preset', '--source']);
  const positionals = inputPath ? [] : positionalArgs(flagArgs, VALUE_FLAGS);
  const target = inputPath ? null : resolveTarget({ positionals, ...(issuesFromFlag ? { issuesFlag: issuesFromFlag } : {}), forceAuto, cwd: process.cwd() });

  // ZTB-33: a loose `<file.md>` check (like `--input`) never touches the declared multi-source
  // backend — `checkFile` validates one standalone markdown file — so `--source` cannot scope it and
  // an unknown selector would go uncaught. Refuse rather than silently ignore, same as `--input`.
  const looseFileError = () => new Error(`ztrack check: --source cannot be combined with a loose <file.md> check — a single markdown file is not one of the tracker's declared sources, so there is nothing to scope. Drop --source to check the file, or run a live 'ztrack check --source ${sourcesFromFlag!.join(',')}'. Nothing was read.`);

  // FILE target: validate a loose markdown file as one issue (plain report; not scoped).
  if (target?.kind === 'file') {
    if (sourcesFromFlag) throw looseFileError();
    const result = await checkFile(target.path, { ...commonOpts, failOnWarning });
    return emitPlain(result, { failOnWarning, outputPath, projectRoot, wantsJson, errorsOnly, maxFindings });
  }

  // GATE MODE (`--auto-scope`, run by the Stop hook): an armed loop's target wins over the
  // branch. A FILE loop gates on that file directly (the file IS the whole gate).
  const loop = forceAuto ? readLoopMarker(projectRoot) : null;
  if (loop?.target.kind === 'file') {
    if (sourcesFromFlag) throw looseFileError();
    const result = await checkFile(loop.target.path, { ...commonOpts, failOnWarning });
    return emitPlain(result, { failOnWarning, outputPath, projectRoot, wantsJson, errorsOnly, maxFindings });
  }

  const issues = target?.kind === 'issues' ? target.ids : undefined;
  let inputRoot: unknown;
  let inputAbs: string | undefined;
  if (inputPath) {
    const abs = isAbsolute(inputPath) ? inputPath : resolve(projectRoot, inputPath);
    inputAbs = abs;
    let raw: string;
    try {
      if (statSync(abs).size > 128 * 1024 * 1024) throw new Error(`ztrack check: --input file ${abs} is too large (>128 MiB)`);
      raw = readFileSync(abs, 'utf8');
    } catch (e) { throw e instanceof Error && e.message.startsWith('ztrack check:') ? e : new Error(`ztrack check: cannot read --input file ${abs}`); }
    try { inputRoot = JSON.parse(raw); } catch (e) { throw new Error(`ztrack check: --input ${abs} is not valid JSON (${(e as Error).message}). It should be a validated root written by 'ztrack export'.`); }
  }
  // ZTB-36: `target` is forced null above on the --input path (see the "Resolve the unified
  // TARGET" comment), so `issues` (derived from target) is always undefined here for --input —
  // `issuesFromFlag` is the parsed --issues value itself (parsed once at the top of this
  // function); threading it into checkTrackerRoot is what makes scoping actually reach the root
  // instead of being silently dropped.
  const result: TrackerCheckResult = inputPath
    ? await checkTrackerRoot(inputRoot, { ...commonOpts, ...(issuesFromFlag ? { issues: issuesFromFlag } : {}) })
    : await checkTracker({ ...commonOpts, ...(issues ? { issues } : {}), failOnWarning });

  // ZTB-36: --input's own missing-id check. `checkTrackerRoot` sets `result.loadedIssueIds` from
  // the ids it could extract straight off the root, regardless of whether validation then passed
  // (same contract as checkTracker's field of the same name below) — unset only when the root is
  // too shape-broken to have a usable `issues` array, in which case `checkRoot`'s own shape
  // findings already fail the check loud, so this is skipped entirely rather than risk a
  // misleading not-found report papering over the real shape error. The message names the
  // --input file, not "the tracker" (there is no tracker store here) and does not point at
  // `ztrack issue list`, which describes the live backend, not a materialized root.
  if (inputPath && issuesFromFlag && result.loadedIssueIds) {
    const present = new Set(result.loadedIssueIds);
    const missing = issuesFromFlag.filter((id) => !present.has(id));
    if (missing.length) {
      throw new Error(`ztrack check: issue(s) not found in the --input root ${inputAbs}: ${missing.join(', ')}. The root is what 'ztrack export' wrote — re-export it, or fix the id. No verdict was produced.`);
    }
  }

  // ISSUE target not in the tracker: error rather than silently passing on an empty filter.
  // ZTB-35 dev/67: prefer `loadedIssueIds` (set by checkTracker — the ids the LOADER actually
  // found, whether or not validation then passed) over `export?.issues`, which is unset whenever
  // validation fails before the root parses (e.g. a shape-invalid issue) — that used to make an
  // issue that genuinely exists but fails schema validation look "not found" and discard the real
  // `wellformed_shape` finding. checkTracker is the only producer that reaches this block with
  // target ids — `--input` forces `target` to null upstream, so this never runs on that path; it
  // has its own missing-id check above instead (checkTrackerRoot's `loadedIssueIds`, read off the
  // root rather than a backend scan). The `export` fallback here is purely defensive for any
  // TrackerCheckResult lacking loadedIssueIds.
  if (target?.kind === 'issues') {
    const present = new Set(result.loadedIssueIds ?? (result.export?.issues ?? []).map((i) => i.id));
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
    // ZTB-35 dev/67 (same rationale as the by-id block above): `export` is unset whenever ANY
    // issue in the tracker is shape-invalid, so deriving the known ids from it alone would make a
    // perfectly valid ACTIVE issue look "not in the tracker" and bury the real wellformed_shape
    // cause — on the production Stop-hook oracle, no less. Prefer the loader's own id list.
    const issueIds = result.loadedIssueIds ?? (result.export?.issues ?? []).map((i) => i.id);
    // Active issue precedence: explicit env override > armed loop target > branch/worktree.
    const loopIssue = loop?.target.kind === 'issues' ? loop.target.ids[0] : undefined;
    const explicit = process.env.ZTRACK_ACTIVE_ISSUE?.trim() || loopIssue;
    const { issueId, reason } = resolveActiveIssue({ ...(explicit ? { explicit } : {}), ...(branch ? { branch } : {}), ...(worktree ? { worktree } : {}), issueIds });
    if (issueId || forceAuto) { // resolved, or forced (forced+unresolved => everything blocks)
      // ZTB-29 dev/01/02 — the --until half of the loop oracle (Option B: no hook change; the
      // Stop hook keeps calling `check --auto-scope` unmodified, so an OLD hook script and a NEW
      // CLI, or vice versa, both keep working — see cli.ts:282's "never hit the API mid-loop"
      // neighbor comment for the same offline invariant this preserves). A marker with no `until`
      // (today's markers, or `loop start` without --until) leaves `findings` untouched — byte-
      // identical to pre-ZTB-29 behavior. When `until` IS set, a synthetic BLOCKING finding is
      // added whenever the active issue's status ranks below the target in the active preset's
      // status-enum declaration order (the same order write-time validation already reads via
      // `activeStatusEnum`, ZTB-23 dev/01) — so "green at the current stage" no longer disarms a
      // loop that was told to drive further. Flipping the issue to the target stage EARLY does not
      // defeat this: the stage's own lifecycle gates (e.g. `review_requires_all_acs_passed`) still
      // fire in `result.findings` and keep the check red on their own — this rule only adds the
      // extra "not there yet" signal for the case where the CURRENT stage is otherwise green.
      let findings = result.findings;
      if (loop?.until && issueId) {
        const enumValues = await activeStatusEnum(projectRoot);
        // Reading `export` here is safe despite its unset-on-shape-failure fragility (ZTB-35
        // dev/67): when export is unset, a wellformed_shape finding with no issueId exists and
        // partitionFindings makes no-issueId findings BLOCKING, so the gate stays red anyway —
        // the synthetic loop_until finding would only be a redundant extra signal in that state,
        // and it fires again once the shape error is fixed.
        const issue = (result.export?.issues ?? []).find((i) => i.id === issueId);
        const curRank = enumValues && issue ? enumValues.indexOf(issue.status) : -1;
        const untilRank = enumValues ? enumValues.indexOf(loop.until) : -1;
        if (curRank >= 0 && untilRank >= 0 && curRank < untilRank) {
          const untilFinding: Finding = {
            code: 'loop_until_not_reached',
            severity: 'error',
            waivable: false, // drive-to-stage can't be signed away; injection after applyWaivers already guarantees this — make the intent explicit
            issueId,
            message: `${issueId} is loop-armed until "${loop.until}" but is currently "${issue!.status}" — not there yet.`,
            fix: `Drive ${issueId} to "${loop.until}" for real (do the work, then \`ztrack issue edit ${issueId} --state ${loop.until}\` once its own gates for that stage pass), or \`ztrack loop stop\` to disarm.`,
          };
          findings = [...findings, untilFinding];
        }
      }
      const { blocking, informational } = partitionFindings(findings, issueId);
      const blockingErrors = blocking.some((f) => f.severity === 'error');
      // ZTB-35 dev/66: same fix as emitPlain, scoped to the blocking set — acknowledged findings
      // never trip --fail-on-warning, only real warnings do, and the one `scopedFailed` verdict
      // drives the exit code, the JSON `ok`, and (via renderScopedReport) the pass/fail banner +
      // exit hint so they can't disagree.
      const scopedFailed = blockingErrors || (failOnWarning && blocking.some((f) => f.severity === 'warning'));
      const scopedSummary = summarizeResult({ ...result, findings: blocking });
      const scopedPayload = {
        ok: !scopedFailed,
        activeIssue: issueId,
        scope: { branch: branch ?? null, worktree: worktree ?? null, reason },
        summary: { ...scopedSummary, status: (scopedFailed ? 'fail' : scopedSummary.warnings > 0 ? 'warn' : 'pass') as typeof scopedSummary.status },
        findings: blocking,
        informational,
      };
      if (outputPath) writeFileSync(isAbsolute(outputPath) ? outputPath : resolve(projectRoot, outputPath), `${JSON.stringify(scopedPayload, null, 2)}\n`);
      if (wantsJson) process.stdout.write(`${JSON.stringify(scopedPayload, null, 2)}\n`);
      else process.stdout.write(renderScopedReport(result, { activeIssue: issueId, reason, blocking, informational, errorsOnly, maxFindings, projectRoot, failed: scopedFailed }));
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
  // ZTB-35 dev/66: acknowledged (waived) findings NEVER count toward --fail-on-warning — a waiver
  // is the sanctioned escape, and the summary already reports them separately from warnings. Only
  // real `severity === 'warning'` findings do. `failed` is the ONE verdict every surface below
  // (exit code, human banner + exit-hint via renderCheckReport, and the JSON payload) derives
  // from, so they can never disagree with each other again. Without --fail-on-warning this is
  // byte-for-byte the old `!result.ok`.
  const failed = !result.ok || (failOnWarning && result.findings.some((f) => f.severity === 'warning'));
  const summary = summarizeResult(result);
  const payload = {
    ok: !failed,
    summary: { ...summary, status: (failed ? 'fail' : summary.warnings > 0 ? 'warn' : 'pass') as typeof summary.status },
    findings: result.findings,
  };
  if (outputPath) writeFileSync(isAbsolute(outputPath) ? outputPath : resolve(projectRoot, outputPath), `${JSON.stringify(payload, null, 2)}\n`);
  if (wantsJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(renderCheckReport(result, { errorsOnly, maxFindings, projectRoot, failed }));
  }
  process.exitCode = failed ? 1 : 0;
  return true;
}
