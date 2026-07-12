// `ztrack sync github` — two-way GitHub issue sync through the twin (see ARCHITECTURE.md §5).
// Extracted from cli.ts (ZTB-28 dev/04), following the established verb-module pattern
// (cliImport.ts/cliWaiver.ts/cliLoop.ts): flag parsing + terminal rendering only, dispatched
// from cli.ts's main().
import { optionValue } from './cliArgs.ts';
import { projectRootFrom } from './config.ts';
import { createTrackerClient } from './sdk.ts';
import * as githubSync from './sync/github/index.ts';
import { statusMark, ui } from './cliStyle.ts';

/** `ztrack sync github [--repo o/n] [--pull | --push] [--policy merge|hub-wins|twin-wins]
 *  [--json]`. Returns true once handled. */
export async function handleSyncCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'sync') return false;
  if (args[1] !== 'github') {
    throw new Error("usage: tracker sync github [--repo <owner/name>] [--pull | --push] [--policy merge|hub-wins|twin-wins]   (default: bidirectional reconcile; --repo + --policy default to the `init --sync` link)");
  }
  const client = createTrackerClient();
  // --repo is optional once the project is linked (`init --sync github --repo o/n`).
  const repo = optionValue(args, '--repo') || githubSync.linkedRepo(projectRootFrom()) || '';
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("ztrack sync github: no repo. Pass --repo <owner/name>, or link one with `ztrack init --sync github --repo <owner/name>`.");
  }
  const [owner, name] = repo.split('/');
  const o = { projectRoot: projectRootFrom(), owner: owner!, repo: name!, execute: githubSync.resolveGithubExecute(), client, occurredAt: new Date().toISOString() };
  const onlyPull = args.includes('--pull') && !args.includes('--push');
  const onlyPush = args.includes('--push') && !args.includes('--pull');
  const out: Record<string, unknown> = { repo };
  if (onlyPull) {
    const r = await githubSync.pull(o); out.pull = r;
    process.stdout.write(`${statusMark('pass')} pull: ${r.created.length} created, ${r.updated.length} updated locally\n`);
    // ZTB-21 dev/02: a first pull that found nothing (even after the built-in retry) looks
    // identical to "really has zero issues" unless we say so — GitHub's list API can still lag.
    if (r.note) process.stderr.write(`${statusMark('warn')} ${ui.yellow(r.note)}\n`);
  } else if (onlyPush) {
    // push is now a three-way reconcile with pull-application suppressed (see sync.ts's `push`
    // doc comment) — a same-field collision (e.g. an issue closed on GitHub while edited locally)
    // is a surfaced conflict, never silently clobbered, so it's reported here just like the
    // bidirectional branch below reports it. Policy: --policy overrides the linked config.
    const policyFlag = optionValue(args, '--policy');
    if (policyFlag && !['hub-wins', 'twin-wins', 'merge'].includes(policyFlag)) throw new Error(`tracker sync: --policy must be merge | hub-wins | twin-wins (got '${policyFlag}')`);
    const policy = (policyFlag as 'hub-wins' | 'twin-wins' | 'merge') || githubSync.linkedPolicy(o.projectRoot);
    const r = await githubSync.push(o, policy); out.push = r;
    process.stdout.write(`${statusMark('pass')} push: ${r.created.length} created, ${r.updated.length} updated on GitHub\n`);
    for (const c of r.conflicts) {
      process.stdout.write(`${statusMark('warn')} ${ui.yellow(`conflict on ${c.issue}`)} ${ui.dim(`(both sides changed: ${c.fields.join(', ')} — left untouched; edit one side and re-sync)`)}\n`);
    }
  } else {
    // default: bidirectional three-way merge (concurrent non-overlapping edits merge; a
    // same-field collision is surfaced, never silently clobbered). Policy: --policy overrides
    // the linked config (default merge).
    const policyFlag2 = optionValue(args, '--policy');
    if (policyFlag2 && !['hub-wins', 'twin-wins', 'merge'].includes(policyFlag2)) throw new Error(`tracker sync: --policy must be merge | hub-wins | twin-wins (got '${policyFlag2}')`);
    const policy = (policyFlag2 as 'hub-wins' | 'twin-wins' | 'merge') || githubSync.linkedPolicy(o.projectRoot);
    const r = await githubSync.reconcileSync(o, policy); out.reconcile = r;
    process.stdout.write(`${statusMark('pass')} sync: ${r.pulled.length} pulled, ${r.pushed.length} pushed, ${r.created.length} created\n`);
    for (const c of r.conflicts) {
      process.stdout.write(`${statusMark('warn')} ${ui.yellow(`conflict on ${c.issue}`)} ${ui.dim(`(both sides changed: ${c.fields.join(', ')} — left untouched; edit one side and re-sync)`)}\n`);
    }
  }
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return true;
}
