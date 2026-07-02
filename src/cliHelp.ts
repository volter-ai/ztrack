import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { heading, helpSection, ui } from './cliStyle.ts';

export function commandName(): string {
  const invoked = (process.argv[1] || '').split(/[\\/]/).pop() || '';
  return invoked && !['cli.js', 'cli.ts', 'node', 'bun'].includes(invoked) ? invoked : 'ztrack';
}

export function printHelp(): void {
  const command = commandName();
  process.stdout.write(`${heading('ztrack', 'typecheck your task management')}

${ui.bold('Usage')}
  ${ui.cyan(`${command} <resource> <action> [args...]`)}

${helpSection('top', 'Start here', [
    [`${command} init [--team KEY] [--preset <name>] [--sync github --repo o/n]`, 'install a preset + config (optionally link a tracker)'],
    [`${command} issue create`, 'add a verifiable issue'],
    [`${command} check [<issue-id> | <file.md>]`, 'verify completion (whole tracker, an issue, or a file)'],
  ])}

${helpSection('middle', 'Workflow', [
    [`${command} issue scaffold`, 'write starter body'],
    [`${command} issue create`, 'create tracker issue'],
    [`${command} issue view A-1`, 'inspect one issue'],
  ])}

${helpSection('bottom', 'Data', [
    [`${command} export [--out f.json]`, 'write the validated root'],
    [`${command} lint [--fail-on-warn]`, 'flag weak claims'],
    [`${command} sync github --repo o/n`, 'two-way sync issues with GitHub'],
    [`${command} visualizer [--preset p] [--port n]`, 'open the web visualizer'],
  ])}

${ui.bold('Resources')}
  init, migrate-local, issue, project, search, view, api, check, export
  fmt, lint, tx, evidence, ac, mcp, sync, visualizer, loop, waiver, preset, completions

${ui.dim(`Shell completion:  source <(${command} completions bash)   # or zsh`)}
${ui.dim(`Use ${command} <resource> --help or ${command} issue <action> --help for focused help.`)}
`);
}

export async function scaffoldCaseBody(title: string): Promise<string> {
  try {
    const projectRoot = projectRootFrom();
    const config = loadTrackerConfig(projectRoot);
    const preset = await resolveTrackerValidation(config, projectRoot);
    const body = preset.scaffold?.(title);
    if (body) return body;
  } catch {
    // Keep scaffold usable before ztrack init; presets can replace this.
  }
  return `# ${title}

## Summary

One or two source-grounded sentences.

## Acceptance Criteria

- [ ] ac/01 status: pending Describe one observable, testable outcome. [1]

## Sources

[1] Where this requirement came from:
> Paste the source requirement here.

## Evidence

<!-- Add evidence rows such as:
[E1] type: artifact path: evidence/result.png ac: ac/01 justification: Shows the result.
-->
`;
}

export function printIssueActionHelp(action: string): boolean {
  const command = commandName();
  const usage: Record<string, string> = {
    scaffold: `${command} issue scaffold [--title text]`,
    list: `${command} issue list [--search text] [--state name|open|closed|all] [--label name] [--parent id] [--limit n] [--json fields]`,
    view: `${command} issue view <issue> [--json fields] [--comments] [--jq expr]`,
    get: `${command} issue view <issue> [--json fields] [--comments] [--jq expr]`,
    create: `${command} issue create --title text [--body text|--body-file path] [--label name] [--state name] [--assignee name] [--parent id]`,
    edit: `${command} issue edit <issue> [--title text] [--body-file path] [--state name] [--assignee name] [--add-label name] [--remove-label name] [--parent id] [--remove-parent]`,
    close: `${command} issue close <issue> [--reason completed|canceled] [--comment text|--comment-file path]`,
    comment: `${command} issue comment <issue> --body text|--body-file path`,
    comments: `${command} issue comments <issue> [--jq expr]`,
    history: `${command} issue history <issue> [--json] [--limit n] [--jq expr]`,
    relate: `${command} issue relate <issue> --blocks <blocked-issue>`,
    relations: `${command} issue relations <issue>|--all`,
    unrelate: `${command} issue unrelate <issue> --blocks <blocked-issue>`,
  };
  const line = usage[action];
  if (!line) return false;
  process.stdout.write(`Usage: ${line}\n`);
  return true;
}

export function printResourceHelp(resource: string): boolean {
  const command = commandName();
  if (resource === 'init') {
    process.stdout.write(`Usage: ${command} init [--team KEY] [--preset <name>] [--branch] [--sync github --repo owner/name] [--policy merge|hub-wins|twin-wins]

Installs an editable preset (.volter/tracker/validation/preset.mts) + config.
  (no flags)                 a LOCAL tracker with the recommended preset. The markdown issue store is
                             committed to your repo, with a central, cross-worktree board (the default):
                             committed mds + a <git-common-dir>/ztrack/board index, so a coordinator and
                             concurrent worktrees share one board — no remote needed.
  --list                     list the available presets and their descriptions, then exit.
  --preset <name>            install a specific preset (see \`${command} init --list\`).
  --branch                   strict branch-scoped board instead: committed per-branch, no central index
                             (each branch has its own board that merges with the code; no cross-worktree view).
  --sync github --repo o/n   LINK to GitHub Issues (two-way sync) and pull existing issues;
                             GitHub becomes the source of truth (the local store is gitignored).
  --policy …                 conflict-resolution default for a linked tracker (default merge).

Beyond the default store, .volter/tracker-config.json accepts a \`sources\` array to declare more:
each entry is {path, format: "issue-per-file"|"document", readonly?} — a "document" source is
one markdown file holding many issues (id-bearing headings become issues; nesting becomes parents).
Grammar, write-back, and diagnostics: docs/SOURCES.md.
`);
    return true;
  }
  if (resource === 'loop') {
    process.stdout.write(`Usage: ${command} loop <start|stop|status> [<issue-id>] [--max N]

A ralph loop whose completion oracle is \`check\`. \`start\` arms it; once the ztrack-gate
Stop/SubagentStop hooks are wired (README → Agent workflows), every turn in this root — the main
agent's and any subagent's it delegates to — is held until the target issue passes check
(then it disarms), capped at --max iterations per actor (default 8). \`start\` with no id auto-scopes
to the branch/worktree issue; arming a DIFFERENT target while one is already armed refuses (\`stop\`
first, or arm in a separate worktree). \`stop\` disarms; \`status\` shows the armed target.
`);
    return true;
  }
  if (resource === 'issue') {
    process.stdout.write(`Usage: ${command} issue <action> [args...]

Actions: scaffold, list, view, get, create, edit, patch, delete, close, comment, comments,
history, relate, relations, unrelate.
  ${command} issue patch <issue> --json '{...}'   overlay the preset's schema fields (see \`issue view\`)
`);
    return true;
  }
  if (resource === 'project' || resource === 'milestone') {
    process.stdout.write(`Usage: ${command} ${resource} <list|view|get|issues|create|update> [args...]\n`);
    return true;
  }
  if (resource === 'search' || resource === 'query' || resource === 'view') {
    process.stdout.write(`Usage: ${command} ${resource} <text-or-name> [args...]\n`);
    return true;
  }
  // `check`/`export --help` fall through to handleCheckCommand, the single source of truth for
  // their (target-grammar-aware) usage — do NOT shadow it with a short stale copy here.
  if (resource === 'visualizer' || resource === 'viz') {
    process.stdout.write(`Usage: ${command} visualizer [--preset <name>] [--port n] [--project dir]

Starts the web visualizer (a Bun app) over the local tracker. Defaults: preset
default, port 3300, project = current tracker root. Requires Bun (bun.sh).
`);
    return true;
  }
  if (resource === 'evidence') {
    process.stdout.write(`Usage: ${command} evidence <add|verify|keygen|export> [args...]

  ${command} evidence add <file> [--name <n>]      COMMIT mode (default): copy into the evidence
       dir; cite the printed \`image=<path>\` and commit it → verified at the cited commit.
  ${command} evidence add <file> --attach          ATTACH mode (linked GitHub repo): upload as a
       release asset; cite \`image=<url> sha256=<digest>\`. The gate accepts it offline (the digest
       is a tamper-evident pin); run \`evidence verify\` to fetch + compare.
  ${command} evidence verify [--issues a,b]         fetch every URL-pinned evidence and check its
       content matches the pinned sha256 (the network step \`check\` skips). gh-auth for private repos.
  ${command} evidence keygen / export               DSSE signing key / in-toto attestation export.

Evidence is commit + proof at its core; an image is optional and verified when cited. Storage is
set by \`evidence.store\` in the config (default \`commit\`; \`attach\` uploads to the linked repo).
`);
    return true;
  }
  if (resource === 'ac') {
    process.stdout.write(`Usage: ${command} ac patch <issue> <acId> --json '{...}' [--dry-run]

Overlays the preset's AC schema fields onto one acceptance criterion (run \`${command} issue view\`
to see the shape), then re-serializes through the preset — e.g. \`{"checked":true,"status":"passed"}\`.
`);
    return true;
  }
  if (resource === 'lint') {
    process.stdout.write(`Usage: ${command} lint [--issues a,b] [--json] [--fail-on-warn]

Flags weak or unverifiable CLAIMS in issue bodies (a soft style lint). This is advisory;
\`${command} check\` is the hard gate that fails on missing evidence. --fail-on-warn exits
nonzero on any finding.
`);
    return true;
  }
  if (resource === 'fmt') {
    process.stdout.write(`Usage: ${command} fmt (--issue <id> | --input <file>) [--write] [--check]

Canonicalize an issue body through the preset's grammar (parse → serialize). --write applies
it in place; --check exits nonzero if it is not already canonical; default prints the result.
`);
    return true;
  }
  if (resource === 'tx') {
    process.stdout.write(`Usage: ${command} tx <plan|apply> --file tx.json

Plan or apply a batch of model edits (tx.json: {"edits": [{"issue": "A-1", "op": "check",
"acId": "dev/01", ...}]}). \`plan\` previews; \`apply\` writes (and accepts a prior plan's base).
`);
    return true;
  }
  if (resource === 'mcp') {
    process.stdout.write(`Usage: ${command} mcp serve

Starts the MCP server (agent-facing task/evidence tools — check, patch, etc. — over stdio).
Wire it into an agent with e.g. \`claude mcp add ztrack -- npx ztrack mcp serve\`.
`);
    return true;
  }
  if (resource === 'sync') {
    process.stdout.write(`Usage: ${command} sync github [--repo <owner/name>] [--pull | --push] [--policy merge|hub-wins|twin-wins] [--json]

Two-way issue sync with GitHub through the twin (incremental + idempotent — never
a full re-read/re-write). Default syncs both directions (pull then push); --pull
or --push limits it. --repo/--policy default to the \`init --sync\` link. A synced issue
IS the GitHub issue (identity binding stored at .volter/sync/github.json). Same-field
conflicts surface as an unwaivable \`sync_conflict\` that gates check; --policy (default
merge) sets resolution: hub-wins | twin-wins | merge. Auth uses the gh CLI or
GITHUB_TOKEN — no prompted PAT.
`);
    return true;
  }
  return false;
}
