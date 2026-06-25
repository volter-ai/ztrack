import { resolve } from 'node:path';
import { initTrackerPresets, initTrackerProject, presetManifest } from './presetCatalog.ts';
import { createTrackerClient } from './sdk.ts';
import { optionValue } from './cliArgs.ts';
import { commandName } from './cliHelp.ts';
import { heading, stackedCommand, statusMark, ui } from './cliStyle.ts';
import * as githubSync from './sync/github/index.ts';

/** `ztrack init` — scaffolds the per-project tracker: writes the config, installs the chosen
 *  validation preset (default = the recommended baseline), and optionally links an external tracker
 *  (`--sync github --repo o/n`) with a best-effort initial pull. Returns true once it has handled
 *  the `init` command. */
export async function handleInitCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'init') return false;
  const command = commandName();
  const root = resolve(optionValue(args, '--root') || process.cwd());
  // `ztrack init --list` — the catalog (name + description), generated from the preset manifests
  // so it never needs a hand-maintained list. Shows the alias and the recommended baseline.
  if (args.includes('--list')) {
    const manifest = presetManifest();
    const width = Math.max(...manifest.map((p) => p.name.length));
    process.stdout.write(`${ui.bold('Available presets')} ${ui.dim(`— ${command} init --preset <name>`)}\n\n`);
    for (const p of manifest) {
      const tags = [p.recommended ? 'recommended' : '', p.aliases?.length ? `alias: ${p.aliases.join(', ')}` : ''].filter(Boolean).join('; ');
      process.stdout.write(`  ${ui.cyan(p.name.padEnd(width))}  ${p.description}${tags ? ui.dim(`  (${tags})`) : ''}\n`);
    }
    process.stdout.write(`\n${ui.dim(`${command} init                  installs the recommended preset`)}\n`);
    return true;
  }
  const preset = optionValue(args, '--preset', 'default');
  if (!initTrackerPresets().includes(preset)) {
    throw new Error(`ztrack init: unknown --preset '${preset}'. Run \`${command} init --list\` to see available presets.`);
  }
  // Optional permanent link to an external tracker: `ztrack init --sync github --repo o/n`.
  const syncProvider = optionValue(args, '--sync');
  let sync: { provider: 'github'; repo: string; policy?: 'hub-wins' | 'twin-wins' | 'merge' } | undefined;
  if (syncProvider) {
    if (syncProvider !== 'github') throw new Error(`ztrack init: --sync only supports 'github' today (got '${syncProvider}')`);
    const repo = optionValue(args, '--repo');
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("ztrack init --sync github: --repo <owner/name> is required (e.g. --repo volter-ai/ztrack)");
    const policy = optionValue(args, '--policy');
    if (policy && !['hub-wins', 'twin-wins', 'merge'].includes(policy)) throw new Error(`ztrack init: --policy must be merge | hub-wins | twin-wins (got '${policy}')`);
    sync = { provider: 'github', repo, ...(policy ? { policy: policy as 'hub-wins' | 'twin-wins' | 'merge' } : {}) };
  }
  // Board scope (unlinked tracker). Default 'shared' — a central, cross-worktree board. `--branch` opts
  // into the strict branch-scoped board (committed per-branch, no central index); `--shared` is explicit/default.
  const board = args.includes('--branch') ? ('branch' as const) : ('shared' as const);
  const result = initTrackerProject(root, optionValue(args, '--team') || 'LOCAL', { preset, ...(sync ? { sync } : {}), board });
  if (result.alreadyInitialized) {
    process.stdout.write(`${statusMark('pass')} ${ui.green('Already initialized')} ${ui.dim(result.configPath)}\n`);
    return true;
  }
  // Initial pull so the linked repo's issues populate the fresh tracker (best-effort:
  // a network/auth failure leaves init successful — `ztrack sync` retries later).
  let pulled = false;
  if (sync) {
    process.stdout.write(`${statusMark('info')} ${ui.dim(`linked to github ${sync.repo} — pulling issues…`)}\n`);
    try {
      const r = await githubSync.pull({ projectRoot: root, owner: sync.repo.split('/')[0]!, repo: sync.repo.split('/')[1]!, execute: githubSync.resolveGithubExecute(), client: createTrackerClient({ projectRoot: root }), occurredAt: new Date().toISOString() });
      process.stdout.write(`${statusMark('pass')} ${ui.dim(`pulled ${r.total} GitHub issue(s) → ${r.created.length} created locally`)}\n`);
      pulled = true;
    } catch (e) {
      process.stdout.write(`${statusMark('warn')} ${ui.yellow(`initial pull skipped: ${(e as Error).message.split('\n')[0]}`)} ${ui.dim('— run `ztrack sync` once auth is set up')}\n`);
    }
  }
  const configPath = result.configPath;
  const teamKey = result.teamKey;
  // Next steps adapt to the scenario: a LINKED project already has its issues (pulled from
  // the tracker), so it goes straight to verify/loop/sync; a LOCAL project authors one first.
  const nextSteps = sync
    ? [
        pulled
          ? stackedCommand(1, 'Verify an issue', `${command} check <issue-id>`, `${ui.dim('or')} ${command} check ${ui.dim('for the whole tracker — your GitHub issues were just pulled in.')}`)
          : stackedCommand(1, 'Pull your GitHub issues', `${command} sync github`, 'The initial pull was skipped (set up `gh auth login` or GITHUB_TOKEN first), then `ztrack check`.'),
        '',
        stackedCommand(2, 'Drive one to done in a loop', `${command} loop start <issue-id>`, 'The Stop-hook gate holds the turn until that issue passes check (a ralph loop).'),
        '',
        stackedCommand(3, 'Re-sync with GitHub', `${command} sync github`, 'Bidirectional + conflict-aware; no --repo needed (it uses the link).'),
      ]
    : [
        stackedCommand(1, 'Write a starter issue', `${command} issue scaffold --title "First case" > body.md`, 'Creates a markdown body with acceptance criteria and evidence sections.'),
        '',
        stackedCommand(2, 'Create work in the local tracker', `${command} issue create --title "First case" --label type:case --state draft --assignee me --body-file body.md`, 'Stores the issue where ztrack can validate it.'),
        '',
        stackedCommand(3, 'Verify checked claims', `${command} check`, 'Fails if checked work lacks real evidence.'),
      ];
  process.stdout.write([
    `${statusMark('pass')} ${heading('Initialized ztrack', `team ${teamKey} • preset ${result.preset}${sync ? ` • linked ${sync.repo}` : ''}`)}`,
    `  ${ui.dim(configPath)}`,
    ...(result.validationEntrypoint ? [`  ${ui.dim(`validation ${result.validationEntrypoint}`)}`] : []),
    '',
    ui.bold('Next steps'),
    ...nextSteps,
    '',
    ui.dim(`Check anything: ${command} check <id> · ${command} check ./file.md · ${command} check (in a worktree, auto-scopes to the branch's issue).`),
    ui.dim('Edit the installed validation preset to encode your project rules.'),
    '',
  ].join('\n'));
  return true;
}
