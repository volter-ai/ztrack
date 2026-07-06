import { resolve } from 'node:path';
import { initTrackerPresets, initTrackerProject, presetManifest } from './presetCatalog.ts';
import { ztrackResolvableFrom } from './presetRegistry.ts';
import { createTrackerClient } from './sdk.ts';
import { optionValue } from './cliArgs.ts';
import { cacheRoot } from './config.ts';
import { seedAuditBaseline } from './core/audit.ts';
import { commandName } from './cliHelp.ts';
import { heading, stackedCommand, statusMark, ui } from './cliStyle.ts';
import * as githubSync from './sync/github/index.ts';

// The installed preset (.volter/tracker/validation/preset.mts) imports `ztrack/preset-kit` — a
// bare specifier resolved (via ESM `import()`, in presetRegistry.ts) by walking up `node_modules`
// directories from the project root. A one-off `npx ztrack init` never adds `ztrack` as a project
// dependency, so `check` fails later with no warning at init time that would have explained why.
// The walk itself (`ztrackResolvableFrom`) lives in presetRegistry.ts, shared with the
// oracle-health probe that warns on preset-less commands after init.
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
  // Board scope (unlinked tracker). Default 'shared' — a central, cross-worktree board; there is no
  // `--shared` flag (shared is simply what you get when `--branch` is absent). `--branch` opts into
  // the strict branch-scoped board instead (committed per-branch, no central index).
  const board = args.includes('--branch') ? ('branch' as const) : ('shared' as const);
  const result = initTrackerProject(root, optionValue(args, '--team') || 'LOCAL', { preset, ...(sync ? { sync } : {}), board });
  if (result.alreadyInitialized) {
    process.stdout.write(`${statusMark('pass')} ${ui.green('Already initialized')} ${ui.dim(result.configPath)}\n`);
    process.stdout.write(`${presetTrustNotice()}\n`);
    if (!ztrackResolvableFrom(root)) process.stdout.write(`${unresolvableZtrackWarning()}\n`);
    return true;
  }
  // Seed an empty audit baseline for a fresh LOCAL tracker so the very first `issue create` is
  // logged to `.audit.jsonl` (observeChanges seeds silently on a missing baseline — right for an
  // established repo, but a brand-new one should record history from issue #1). Skipped for a
  // LINKED init: its pull brings pre-existing issues that must seed silently, not log "created now".
  if (!sync) seedAuditBaseline(cacheRoot(root));
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
  // Both end on the same step 4: wiring a coding agent is the recommended flow (README
  // § Agent workflows) and was previously absent here — a user who stopped at init's output
  // never learned the gate/skill/MCP existed.
  const wireAgent = stackedCommand(4, 'Wire a coding agent (optional)', '/plugin marketplace add volter-ai/ztrack', `Then \`/plugin install ztrack-gate@ztrack\` (Claude Code): a Stop-hook gate that holds the agent's turn until \`${command} loop start <issue-id> --until done\` goes genuinely green, plus a skill teaching it the tracker workflow. MCP alternative: \`claude mcp add ztrack -- npx ztrack mcp serve\`.`);
  const nextSteps = sync
    ? [
        pulled
          ? stackedCommand(1, 'Verify an issue', `${command} check <issue-id>`, `${ui.dim('or')} ${command} check ${ui.dim('for the whole tracker — your GitHub issues were just pulled in.')}`)
          : stackedCommand(1, 'Pull your GitHub issues', `${command} sync github`, 'The initial pull was skipped (set up `gh auth login` or GITHUB_TOKEN first), then `ztrack check`.'),
        '',
        stackedCommand(2, 'Drive one to done in a loop', `${command} loop start <issue-id>`, 'The Stop-hook gate holds the turn until that issue passes check (a ralph loop).'),
        '',
        stackedCommand(3, 'Re-sync with GitHub', `${command} sync github`, 'Bidirectional + conflict-aware; no --repo needed (it uses the link).'),
        '',
        wireAgent,
      ]
    : [
        stackedCommand(1, 'Write a starter issue', `${command} issue scaffold --title "First case" > body.md`, 'Creates a markdown body with acceptance criteria and evidence sections.'),
        '',
        stackedCommand(2, 'Create work in the local tracker', `${command} issue create --title "First case" --label type:case --state draft --assignee me --body-file body.md`, 'Stores the issue where ztrack can validate it.'),
        '',
        stackedCommand(3, 'Verify checked claims', `${command} check`, 'Fails if checked work lacks real evidence.'),
        '',
        wireAgent,
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
    ui.dim('Read next: the Guide (node_modules/ztrack/docs/GUIDE.md, or github.com/volter-ai/ztrack) — setup → verify → drive an agent to green; agents get docs/AGENT-PLAYBOOK.md.'),
    presetTrustNotice(),
    ...(ztrackResolvableFrom(root) ? [] : ['', unresolvableZtrackWarning()]),
    '',
  ].join('\n'));
  return true;
}
