import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { initTrackerPresets, initTrackerProject, presetManifest } from './presetCatalog.ts';
import { createTrackerClient } from './sdk.ts';
import { optionValue } from './cliArgs.ts';
import { commandName } from './cliHelp.ts';
import { heading, stackedCommand, statusMark, ui } from './cliStyle.ts';
import * as githubSync from './sync/github/index.ts';

// The installed preset (.volter/tracker/validation/preset.mts) imports `ztrack/preset-kit` — a
// bare specifier resolved (via ESM `import()`, in presetRegistry.ts) by walking up `node_modules`
// directories from the project root, same as presetRegistry.ts's `Cannot find package 'ztrack'`
// translation at check time. A one-off `npx ztrack init` never adds `ztrack` as a project
// dependency, so `check` fails later with no warning at init time that would have explained why.
// Deliberately NOT `require.resolve`/`createRequire` here: that CJS resolver also falls back to
// Node's legacy global folders (e.g. a homebrew/npm global `ztrack` install), which would silently
// mask exactly the bare-npx case this warning exists to catch — the actual failure is an ESM
// `import()` of a bare specifier, which never consults those global folders. Warn here, at the
// point the project is created, instead of letting the user discover it cold on their first `check`.
function ztrackResolvableFrom(root: string): boolean {
  let dir = resolve(root);
  for (;;) {
    if (existsSync(join(dir, 'node_modules', 'ztrack'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function unresolvableZtrackWarning(): string {
  return `${statusMark('warn')} ${ui.yellow("'ztrack' isn't resolvable as a project dependency here")} ${ui.dim('— the installed preset imports \'ztrack/preset-kit\', so `ztrack check` will fail until you run `npm install -D ztrack` (a one-off `npx` install is not enough; see README Setup).')}`;
}

// ZT-issue-12: the scaffolded preset (.volter/tracker/validation/preset.mts) is a Node module that
// `check`/`export`/`lint`/`ac`/`tx` and the MCP server import and EXECUTE — the trust model lives
// in SECURITY.md, but until now nothing at `init` (where the file is written) or `check` (where it
// first runs) ever mentioned that. One line, here, at the point the file is created — not repeated
// on every `check` run, which would be nagging rather than informative.
function presetTrustNotice(): string {
  return ui.dim(`Note: the installed preset (.volter/tracker/validation/preset.mts) executes as code on every check/export/lint/ac/tx run — see SECURITY.md before pointing ${commandName()} at a repo you don't trust.`);
}

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
    process.stdout.write(`${presetTrustNotice()}\n`);
    if (!ztrackResolvableFrom(root)) process.stdout.write(`${unresolvableZtrackWarning()}\n`);
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
    ui.dim('Declare more stores in .volter/tracker-config.json\'s `sources` array — a "document" source is one markdown file holding many issues.'),
    presetTrustNotice(),
    ...(ztrackResolvableFrom(root) ? [] : ['', unresolvableZtrackWarning()]),
    '',
  ].join('\n'));
  return true;
}
