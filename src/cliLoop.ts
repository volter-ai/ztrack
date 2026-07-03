import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ensureTrackerGitignore, projectRootFrom, stateDirName } from './config.ts';
import { positionalArgs, resolveTarget, type CheckTarget } from './cliTarget.ts';
import { describeTarget, readLoopMarker } from './loopState.ts';
import { optionValue } from './cliArgs.ts';
import { commandName } from './cliHelp.ts';
import { statusMark, ui } from './cliStyle.ts';
import * as githubSync from './sync/github/index.ts';
import { activeStatusEnum } from './presetRegistry.ts';
import { nearestKey } from './configSchema.ts';
import { detectGateWiring } from './gateWiring.ts';
import { checkFile, checkTracker } from './check.ts';
import { partitionFindings, resolveActiveIssue } from './core/scope.ts';
import { git } from './core/gitWorld.ts';

// ZTB-29 dev/04: is `target` already green AT ITS CURRENT STAGE, right now, offline? Reuses the
// same in-process check machinery `check --auto-scope` runs (checkTracker/checkFile +
// partitionFindings), so a bare arm on an already-passing target can warn "this loop has nothing
// to hold on" instead of silently disarming on the very first Stop with a confusing "done"
// message. Never throws: any failure (e.g. no preset configured) means "can't tell, don't warn" —
// this is an advisory nicety, not a gate, so it fails toward saying nothing rather than lying.
async function isTargetAlreadyGreen(root: string, target: CheckTarget): Promise<boolean> {
  try {
    if (target.kind === 'file') {
      const result = await checkFile(target.path, { projectRoot: root });
      return result.ok;
    }
    const result = await checkTracker({ projectRoot: root });
    const issueIds = (result.export?.issues ?? []).map((i) => i.id);
    let activeId: string | null = null;
    if (target.kind === 'issues' && target.ids.length === 1) {
      activeId = target.ids[0]!;
    } else if (target.kind === 'auto') {
      const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || undefined;
      const top = git(root, ['rev-parse', '--show-toplevel']);
      const worktree = top ? basename(top) : undefined;
      activeId = resolveActiveIssue({ ...(branch ? { branch } : {}), ...(worktree ? { worktree } : {}), issueIds }).issueId;
    }
    // 'issues' with >1 id, or an unresolved 'auto': no single active issue — fall back to
    // whole-tracker gating (partitionFindings(_, null) blocks on everything), the same fail-closed
    // default `check --auto-scope` uses when it can't resolve one either.
    const { blocking } = partitionFindings(result.findings, activeId);
    return !blocking.some((f) => f.severity === 'error');
  } catch {
    return false;
  }
}

/** `ztrack loop start|stop|status` — arms a loop-scoped gate (a ralph loop). While armed, the Stop
 *  hook holds the agent's turn until the target passes `ztrack check` (then disarms), or the cap
 *  trips. Returns true once it has handled the `loop` command. */
export async function handleLoopCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'loop') return false;
  const command = commandName();
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
    process.stdout.write(`Usage: ${command} loop <start [<issue>|<file.md>] [--max N] [--until <stage>] | stop | status>\n\nArms a loop-scoped ztrack gate (a ralph loop). While armed, the Stop/SubagentStop hooks keep every turn in this root going — the agent's and any subagent's — until the target passes \`${command} check\` (then it disarms), or the iteration cap trips. The target uses the same grammar as \`check\`: an issue id, a markdown file, or — with no argument — this worktree's issue (resolved from the branch/worktree name). Bare (no --until): hold until the target's CURRENT stage is green. --until <stage>: hold until the issue's status reaches <stage> or later (per the active preset's status vocabulary) AND check is green — only valid for a single-issue target (an id, or bare/auto). start writes ${stateDirName()}/.ztrack-loop.json; stop removes it. Arming a DIFFERENT target while one is already armed refuses (\`${command} loop stop\` first, or arm in a separate worktree).\n`);
    return true;
  }
  if (action === 'start') {
    // Same target grammar as `check`: <issue id> | <file.md> | (bare) -> this branch's issue.
    const positionals = positionalArgs(args.slice(2), new Set(['--max', '--until']));
    const resolved = resolveTarget({ positionals, forceAuto: false, cwd: process.cwd() });
    const target = resolved.kind === 'all' ? { kind: 'auto' as const } : resolved; // bare loop = ralph on the active branch
    const label = describeTarget(target);
    const maxRaw = optionValue(args, '--max');
    const maxIterations = maxRaw && Number.isInteger(Number(maxRaw)) && Number(maxRaw) > 0 ? Number(maxRaw) : 8;

    // ZTB-29 dev/01/02: --until <stage> — drive-to-stage instead of validate-current-stage. Only
    // meaningful for a target that resolves to ONE issue (an explicit id, or bare/auto once the
    // branch resolves); a file or the whole tracker has no single status to drive toward. The
    // stage vocabulary comes from the active preset's status-enum DECLARATION ORDER (reused from
    // ZTB-23's write-time validation, `activeStatusEnum` — same "at or beyond" ordering
    // simple-sdlc's own lifecycle gates use, boilerplates/presets/simple-sdlc.ts's STATE_RANK). No
    // loadable vocabulary means a stage target is meaningless, so this fails the ARM loud rather
    // than silently degrading to bare semantics.
    const untilRaw = optionValue(args, '--until') || undefined;
    let until: string | undefined;
    if (untilRaw) {
      const singleIssueTarget = target.kind === 'auto' || (target.kind === 'issues' && target.ids.length === 1);
      if (!singleIssueTarget) {
        throw new Error(`${command} loop: --until needs a single-issue target (got ${label}) — a file or the whole tracker has no single status to drive toward. Use '${command} loop start <issue-id> --until <stage>', or bare '${command} loop start --until <stage>' to drive this worktree's issue.`);
      }
      const enumValues = await activeStatusEnum(root);
      if (!enumValues) {
        throw new Error(`${command} loop: --until needs a loadable status vocabulary (the active preset's status enum), but none is configured/loadable for this project — a stage target is meaningless without one. Run '${command} init --preset default' to install a preset, or fix the validation entrypoint, then re-arm.`);
      }
      if (!enumValues.includes(untilRaw)) {
        const suggestion = nearestKey(untilRaw, enumValues);
        throw new Error(`${command} loop: "${untilRaw}" is not a valid --until stage for the active preset — its status vocabulary is [${enumValues.join(', ')}]${suggestion ? `, did you mean "${suggestion}"?` : ''}. Nothing was armed.`);
      }
      until = untilRaw;
    }

    // Arm-collision guard: the gate is root-scoped, not agent-scoped (there's no reliable agent
    // identity at arm time — see stop-loop.sh), so re-arming for a DIFFERENT target while one is
    // already armed would silently steal the gate out from under whoever armed it, including a
    // subagent's own loop. Refuse instead; isolation between unrelated loops comes from running
    // in a separate worktree (each has its own marker namespace — src/config.ts), not from
    // overwriting. Compare the canonical target (not the human label) so re-arming the SAME
    // target — a refresh: new --max, runtime sweep, cap-breadcrumb clear — stays allowed.
    const existingMarker = readLoopMarker(root);
    if (existingMarker && JSON.stringify(existingMarker.target) !== JSON.stringify(target)) {
      throw new Error(`${command} loop: already armed for ${existingMarker.label} — refusing to re-arm for ${label} (this would silently steal the gate). Run '${command} loop stop' to disarm first, or arm ${label} in a separate worktree — each worktree has its own loop.`);
    }

    // ZTB-29 dev/03: can the gate even fire here? Best-effort — see gateWiring.ts for the exact
    // heuristic and why a negative result is a WARN, never a refusal (another harness may wire the
    // hooks invisibly to this check).
    const wiring = detectGateWiring(root);
    if (!wiring.wired) {
      process.stdout.write(`${statusMark('warn')} ${ui.yellow('ztrack-gate not detected')} ${ui.dim("— this loop only holds turns once the Stop/SubagentStop hooks are wired: install the ztrack-gate plugin (`/plugin marketplace add volter-ai/ztrack` then `/plugin install ztrack-gate@ztrack`), or wire the hooks yourself — see README → \"3. The loop gate\" / docs/GUIDE.md#3-usage-drive-an-agent-to-green. Arming anyway; another harness may wire the hooks in a way this check can't see.")}\n`);
    }

    // ZTB-29 dev/04: a bare arm (no --until) on a target that's ALREADY green at its current stage
    // has nothing to hold on — the very next Stop disarms it immediately. That's surprising, not
    // wrong, so warn (still arms) rather than error. With --until, arming a green-at-current-stage
    // issue is the intended use (the loop is what drives it PAST green) — no warning there.
    if (!until && await isTargetAlreadyGreen(root, target)) {
      process.stdout.write(`${statusMark('warn')} ${ui.yellow('already green')} ${ui.dim(`— ${label} passes check at its current stage right now; a bare loop has nothing to hold on and will disarm on the very first Stop. Arming anyway. To drive it further instead, re-arm with --until <stage> (e.g. --until ready or --until done).`)}\n`);
    }

    mkdirSync(stateDir, { recursive: true });
    ensureTrackerGitignore(root); // so the loop's runtime/exempt files are ignored even on a repo init'd before the loop existed
    sweepRuntime();
    if (existsSync(cappedPath)) rmSync(cappedPath); // a fresh arm clears any prior cap breadcrumb
    writeFileSync(marker, `${JSON.stringify({ target, maxIterations, startedAt: new Date().toISOString(), label, ...(until ? { until } : {}) }, null, 2)}\n`);
    // Pull the latest from a linked tracker before the ralph loop starts (best-effort).
    await githubSync.syncLinked(root, { pull: true }).catch(() => {});
    const untilSuffix = until ? ` until "${until}"` : '';
    const holdDescription = until ? `${label} reaches "${until}" (and passes check there)` : `${label} is green`;
    process.stdout.write(`${statusMark('pass')} ${ui.green('loop armed')} ${ui.dim(`→ ${label}${untilSuffix} (max ${maxIterations}); once the ztrack-gate Stop/SubagentStop hooks are wired (README → Agent workflows), it holds every turn in this root — the agent's and any subagent's — until ${holdDescription}`)}\n`);
    return true;
  }
  if (action === 'stop') {
    if (existsSync(marker)) rmSync(marker);
    if (existsSync(cappedPath)) rmSync(cappedPath);
    sweepRuntime();
    process.stdout.write(`${statusMark('pass')} ${ui.dim('loop disarmed')}\n`);
    return true;
  }
  if (action === 'status') {
    // A torn write of a runtime file must not crash `status`; treat unreadable as absent.
    const readJson = (p: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { return null; } };
    const m = existsSync(marker) ? readJson(marker) : null;
    if (m) {
      const label = m.label ?? m.issue ?? 'target';
      const untilSuffix = m.until ? ` until ${m.until}` : ''; // ZTB-29 dev/01 — absent on legacy/bare markers
      process.stdout.write(`${statusMark('info')} ${ui.bold(`loop armed → ${label}${untilSuffix}`)} ${ui.dim(`(max ${m.maxIterations}, since ${m.startedAt})`)}\n`);
      return true;
    }
    const c = existsSync(cappedPath) ? readJson(cappedPath) : null;
    if (c) {
      process.stdout.write(`${statusMark('warn')} ${ui.yellow(`loop capped → ${c.issue}`)} ${ui.dim(`(hit the iteration cap after ${c.iterations} iterations, still red as of ${c.cappedAt}; run \`${command} check\` then \`${command} loop start ${c.issue}\` to re-arm)`)}\n`);
      return true;
    }
    process.stdout.write(`${statusMark('info')} ${ui.dim('no loop armed')}\n`);
    return true;
  }
  throw new Error(`${command} loop: unknown action '${action}'. Try 'start <issue>', 'stop', or 'status'.`);
}
