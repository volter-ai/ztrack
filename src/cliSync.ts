// `ztrack sync github` — two-way GitHub issue sync through the twin (see ARCHITECTURE.md §5).
// Extracted from cli.ts (ZTB-28 dev/04), following the established verb-module pattern
// (cliImport.ts/cliWaiver.ts/cliLoop.ts): flag parsing + terminal rendering only, dispatched
// from cli.ts's main().
import { optionValue } from './cliArgs.ts';
import { projectRootFrom } from './config.ts';
import { createTrackerClient } from './sdk.ts';
import * as githubSync from './sync/github/index.ts';
import * as hermesSync from './sync/hermes/index.ts';
import { statusMark, ui } from './cliStyle.ts';

/** `ztrack sync github [--repo o/n] [--pull | --push] [--policy merge|hub-wins|twin-wins]
 *  [--json]`. Returns true once handled. */
export async function handleSyncCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'sync') return false;
  if (args[1] === 'hermes') return handleHermesSync(args);
  if (args[1] !== 'github') {
    throw new Error("usage: tracker sync github [--repo <owner/name>] [--pull | --push] [--policy merge|hub-wins|twin-wins]   (default: bidirectional reconcile; --repo + --policy default to the `init --sync` link)\n       tracker sync hermes [--dry-run] [--policy merge|board-wins|file-wins] [--json]   (the board file linked by `init --sync hermes`)");
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
    const r = await githubSync.push(o); out.push = r;
    process.stdout.write(`${statusMark('pass')} push: ${r.created.length} created, ${r.updated.length} updated on GitHub\n`);
  } else {
    // default: bidirectional three-way merge (concurrent non-overlapping edits merge; a
    // same-field collision is surfaced, never silently clobbered). Policy: --policy overrides
    // the linked config (default merge).
    const policyFlag = optionValue(args, '--policy');
    if (policyFlag && !['hub-wins', 'twin-wins', 'merge'].includes(policyFlag)) throw new Error(`tracker sync: --policy must be merge | hub-wins | twin-wins (got '${policyFlag}')`);
    const policy = (policyFlag as 'hub-wins' | 'twin-wins' | 'merge') || githubSync.linkedPolicy(o.projectRoot);
    const r = await githubSync.reconcileSync(o, policy); out.reconcile = r;
    process.stdout.write(`${statusMark('pass')} sync: ${r.pulled.length} pulled, ${r.pushed.length} pushed, ${r.created.length} created\n`);
    for (const c of r.conflicts) {
      process.stdout.write(`${statusMark('warn')} ${ui.yellow(`conflict on ${c.issue}`)} ${ui.dim(`(both sides changed: ${c.fields.join(', ')} — left untouched; edit one side and re-sync)`)}\n`);
    }
  }
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return true;
}

/** `ztrack sync hermes [--dry-run] [--policy merge|board-wins|file-wins] [--json]` — the board
 *  file two-way with its Hermes kanban (docs/SYNC-HERMES.md). */
async function handleHermesSync(args: string[]): Promise<boolean> {
  const root = projectRootFrom();
  const policy = optionValue(args, '--policy');
  if (policy && !['merge', 'board-wins', 'file-wins'].includes(policy)) throw new Error(`ztrack sync hermes: --policy must be merge | board-wins | file-wins (got '${policy}')`);
  const dryRun = args.includes('--dry-run');
  const r = await hermesSync.syncLinkedHermes(root, { ...(policy ? { policy: policy as hermesSync.HermesPolicy } : {}), dryRun });
  if (!r) throw new Error('ztrack sync hermes: this project has no Hermes link. Add one with `ztrack init --preset kanban --sync hermes --hermes-home <dir>` (or a `sync: { "provider": "hermes", "file": "arcs.md", … }` config entry).');
  if (dryRun) {
    process.stdout.write(`${statusMark('info')} dry run — the board and the file are untouched\n`);
    for (const a of r.actions) process.stdout.write(`  would ${a}\n`);
  } else {
    for (const a of r.actions) process.stdout.write(`  ${ui.dim(a)}\n`);
  }
  const recreated = r.recreated.length ? `, ${r.recreated.length} re-created` : '';
  process.stdout.write(`${statusMark('pass')} sync hermes: ${r.pulled.length} pulled, ${r.pushed.length} pushed, ${r.created.length} created${recreated}, ${r.archived.length} archived\n`);
  for (const f of r.failed) process.stdout.write(`${statusMark('fail')} ${ui.red(`refused by Hermes: ${f}`)}\n`);
  for (const c of r.conflicts) {
    process.stdout.write(`${statusMark('warn')} ${ui.yellow(`conflict on ${c.card}`)} ${ui.dim(`(${c.fields.join(', ')} — the file keeps its value, the board keeps its; \`ztrack check\` shows both. Edit the file to agree, or re-sync with --policy file-wins | board-wins)`)}\n`);
  }
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  return true;
}
