import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureTrackerGitignore, projectRootFrom, stateDirName } from './config.ts';
import { positionalArgs, resolveTarget } from './cliTarget.ts';
import { describeTarget, readLoopMarker } from './loopState.ts';
import { optionValue } from './cliArgs.ts';
import { commandName } from './cliHelp.ts';
import { statusMark, ui } from './cliStyle.ts';
import * as githubSync from './sync/github/index.ts';

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
    process.stdout.write(`Usage: ${command} loop <start [<issue>|<file.md>] [--max N] | stop | status>\n\nArms a loop-scoped ztrack gate (a ralph loop). While armed, the Stop/SubagentStop hooks keep every turn in this root going — the agent's and any subagent's — until the target passes \`${command} check\` (then it disarms), or the iteration cap trips. The target uses the same grammar as \`check\`: an issue id, a markdown file, or — with no argument — this worktree's issue (resolved from the branch/worktree name). start writes ${stateDirName()}/.ztrack-loop.json; stop removes it. Arming a DIFFERENT target while one is already armed refuses (\`${command} loop stop\` first, or arm in a separate worktree).\n`);
    return true;
  }
  if (action === 'start') {
    // Same target grammar as `check`: <issue id> | <file.md> | (bare) -> this branch's issue.
    const positionals = positionalArgs(args.slice(2), new Set(['--max']));
    const resolved = resolveTarget({ positionals, forceAuto: false, cwd: process.cwd() });
    const target = resolved.kind === 'all' ? { kind: 'auto' as const } : resolved; // bare loop = ralph on the active branch
    const label = describeTarget(target);
    const maxRaw = optionValue(args, '--max');
    const maxIterations = maxRaw && Number.isInteger(Number(maxRaw)) && Number(maxRaw) > 0 ? Number(maxRaw) : 8;
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
    mkdirSync(stateDir, { recursive: true });
    ensureTrackerGitignore(root); // so the loop's runtime/exempt files are ignored even on a repo init'd before the loop existed
    sweepRuntime();
    if (existsSync(cappedPath)) rmSync(cappedPath); // a fresh arm clears any prior cap breadcrumb
    writeFileSync(marker, `${JSON.stringify({ target, maxIterations, startedAt: new Date().toISOString(), label }, null, 2)}\n`);
    // Pull the latest from a linked tracker before the ralph loop starts (best-effort).
    await githubSync.syncLinked(root, { pull: true }).catch(() => {});
    process.stdout.write(`${statusMark('pass')} ${ui.green('loop armed')} ${ui.dim(`→ ${label} (max ${maxIterations}); once the ztrack-gate Stop/SubagentStop hooks are wired (README → Agent workflows), it holds every turn in this root — the agent's and any subagent's — until ${label} is green`)}\n`);
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
      process.stdout.write(`${statusMark('info')} ${ui.bold(`loop armed → ${label}`)} ${ui.dim(`(max ${m.maxIterations}, since ${m.startedAt})`)}\n`);
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
