import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { heading, helpSection, ui } from './cliStyle.ts';
import { usageFromRegistry } from './cliRegistry.ts';

export function commandName(): string {
  const invoked = (process.argv[1] || '').split(/[\\/]/).pop() || '';
  return invoked && !['cli.js', 'cli.ts', 'node', 'bun'].includes(invoked) ? invoked : 'ztrack';
}

// The top-level resource list — the single source of truth for both printHelp's "Resources" line
// and ZTB-24 dev/02's "no help for '<x>'" guidance (cli.ts) — so the two can't drift apart. `search`
// and `view` (ZTB-24 dev/05) were 100% prose with zero implementation and are gone from here.
export const TOP_LEVEL_RESOURCES = [
  'init', 'migrate-local', 'issue', 'project', 'api', 'check', 'export', 'import',
  'fmt', 'lint', 'tx', 'evidence', 'ac', 'mcp', 'sync', 'visualizer', 'loop', 'waiver', 'preset', 'completions',
];

export function printHelp(): void {
  const command = commandName();
  process.stdout.write(`${heading('ztrack', 'typecheck your task management')}

${ui.bold('Usage')}
  ${ui.cyan(`${command} <resource> <action> [args...]`)}

${helpSection('top', 'Start here — pick your situation', [
    [`${command} init --sync github --repo o/n`, 'already have GitHub Issues? link them — they pull in, GitHub stays the truth'],
    [`${command} init [--team KEY]`, 'have tasks but no tracker? start a local one (issues live as markdown in the repo)…'],
    [`${command} import notes/tasks.md --register`, '…then materialize your freeform task list into issues (or `issue create` each)'],
    [`${command} loop start <id> --until done`, 'drive ONE issue: the Stop-hook gate holds your agent until it is genuinely done'],
    [`${command} issue list --actionable`, 'burn the WHOLE backlog: one loop-armed agent per unblocked row, wave by wave (docs/GUIDE.md)'],
    [`${command} check [<issue-id> | <file.md>]`, 'verify completion any time (whole tracker, an issue, or a file)'],
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
    [`${command} import <path-or-glob>... [--dry-run]`, 'materialize a freeform backlog in place'],
  ])}

${ui.bold('Resources')}
  ${TOP_LEVEL_RESOURCES.slice(0, 8).join(', ')}
  ${TOP_LEVEL_RESOURCES.slice(8).join(', ')}

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
  // ZTB-24 dev/05: `relate`/`relations`/`unrelate`/`history`/`comments` were documented, with full
  // usage lines, for verbs that DO NOT EXIST — no markdownBackend match, no cli.ts interception;
  // live-verified to error `markdown backend: unsupported command`. Removed rather than
  // implemented (out of scope for this fix). `--jq` (never read by the backend — verified
  // `issue list --jq` returns unfiltered output) and `--comments` on `view`/`get` (never read) are
  // gone too. `patch`/`delete` (ZTB-18 dev/03) are new entries — `patch`'s flags are rendered
  // straight from the registry (usageFromRegistry) rather than hand-typed, per the AC.
  const usage: Record<string, string> = {
    scaffold: `${command} issue scaffold [--title text]`,
    list: `${command} issue list [--search text] [--state name|open|closed|all] [--label name] [--parent id] [--source name,... (repeatable)] [--limit n] [--json fields] | --actionable|--blocked [--state ...] [--label ...] [--search ...] [--limit n] [--json fields]`,
    view: `${command} issue view <issue> [--json fields]`,
    get: `${command} issue view <issue> [--json fields]`, // `get` is a full alias of `view`
    create: `${command} issue create [--title text] [--body text|--body-file path] [--label name] [--state name] [--assignee name] [--parent id] [--project name]`,
    edit: `${command} issue edit <issue> [--title text] [--body text|--body-file path] [--state name] [--assignee name] [--add-label name] [--remove-label name] [--parent id] [--remove-parent] [--project name] [--remove-project] [--expect-state name] [--expect-body-sha sha256] [--dry-run]`,
    close: `${command} issue close <issue> [--reason completed] [--comment text|--comment-file path]`,
    comment: `${command} issue comment <issue> --body text|--body-file path`,
    patch: `${command} issue patch <issue> ${usageFromRegistry(['issue', 'patch'])}`,
    delete: `${command} issue delete <issue> ${usageFromRegistry(['issue', 'delete'])}`.trim(),
  };
  // Extra explanatory line for an action whose usage grammar alone doesn't say enough —
  // `create`'s title derivation, `edit`'s write-time --state check, and `close`'s deliberate
  // refusal of --reason canceled (and of anything else it doesn't recognize).
  const notes: Record<string, string> = {
    create: `If --title is omitted, it is derived from the body's first '# Heading' line; with neither, create refuses (the installed preset rejects an empty title). An explicit --state is checked against the active preset's status vocabulary (when one is configured) and refused with a did-you-mean if it doesn't match.`,
    edit: `An explicit --state is checked against the active preset's status vocabulary (when one is configured) and refused with a did-you-mean if it doesn't match, instead of writing a value 'ztrack check' would reject later. --expect-state/--expect-body-sha are optimistic-concurrency preconditions, enforced by the backend against a fresh re-read at the moment of the write: if the tracker's current state/body sha256 doesn't match, edit refuses with a precondition-failed JSON payload (exit 1) and writes nothing. --dry-run runs every gate that can refuse the real write (not-found, --state vocabulary, the preconditions, readonly-source, a document source's write guards) and mutates nothing — a dry-run success is an honest prediction that the real run would be accepted.`,
    close: `--reason accepts only 'completed' (the default) or 'canceled'; any other value is refused. --reason canceled is itself refused: no shipped preset's status vocabulary has a "canceled" state, so use 'issue delete' or assign a real status via 'issue edit' instead.`,
    list: `--actionable: the dispatch frontier — not-done issues with no unmet (transitive) blocker, safe to dispatch right now. --blocked: the complement — not-done AND blocked, each row naming its NEAREST unmet blocker(s) (direct hop, not the whole transitive closure) in a "blockers" field. The two are mutually exclusive over the SAME underlying computation (core/blocking.ts's issueFrontier); neither --parent nor --source is supported on either (the frontier is a whole-graph view over the source-erased validated model). --source name,... (repeatable) scopes a PLAIN list to the named declared source(s), matching by a source's config name, its path, or its path basename; each occurrence may ALSO be comma-separated (ZTB-40) — occurrences and comma-parts union, order-preserving, deduped; a selector matching zero sources fails the whole invocation loud, naming it plus the available names, even when other selectors matched. 'source' is a selectable --json field naming each row's owning source. Default fields are identifier,title,state; --json overrides them (--blocked always includes "blockers").`,
    patch: `Overlays the preset's SCHEMA fields onto the issue (run \`${command} issue view\` to see the shape), then re-serializes through the preset — e.g. --json '{"status":"done"}'. The claim is then verified by \`${command} check\`. --dry-run previews without writing.`,
  };
  const line = usage[action];
  if (!line) return false;
  process.stdout.write(`Usage: ${line}\n`);
  if (notes[action]) process.stdout.write(`${notes[action]}\n`);
  return true;
}

export function printResourceHelp(resource: string): boolean {
  const command = commandName();
  if (resource === 'init') {
    process.stdout.write(`Usage: ${command} init [--root dir] [--team KEY] [--preset <name>] [--branch] [--sync github --repo owner/name] [--policy merge|hub-wins|twin-wins]

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
  --root dir                 initialize a different directory instead of the current one.

Two intakes, by what you already have: issues on GITHUB → \`--sync github --repo o/n\` (linked; they
pull in). A pile of TASKS and no tracker → plain \`${command} init\` (local), then \`${command} import
<your-tasks.md> --register\` to materialize the list into issues (or \`issue create\` one by one).
Either way you then drive the work: ONE issue at a time (\`${command} loop start <id> --until done\`)
or a whole backlog wave by wave (\`${command} issue list --actionable\` → one loop-armed agent per
row) — the full intake→groom→order→dispatch flow is docs/GUIDE.md's "Orchestrating a whole backlog".

Beyond the default store, .volter/tracker-config.json accepts a \`sources\` array to declare more:
each entry is {path, format: "issue-per-file"|"document", readonly?, name?} — a "document" source is
one markdown file holding many issues (id-bearing headings become issues; nesting becomes parents);
\`--source <name>\` scopes \`issue list\`/\`check\` to declared source(s). Grammar, write-back, and
diagnostics: docs/SOURCES.md.
`);
    return true;
  }
  if (resource === 'migrate-local') {
    process.stdout.write(`Usage: ${command} migrate-local [--root dir]

One-shot migration off the (removed) Python \`local\` SQLite backend: reads the old
tracker.sqlite and rewrites every issue as a markdown file, then flips the project's
config to \`backend: "markdown"\`. The old tracker.sqlite is left in place as a backup.
No-op (exit 0, nothing written) if no tracker.sqlite is found.
`);
    return true;
  }
  if (resource === 'api') {
    process.stdout.write(`Usage: ${command} api <query|serve> [args...]

GraphQL-shaped query against the local tracker store.

  ${command} api query --query '{ issues(first: 10) { nodes { identifier title } } }'
  ${command} api serve --host 127.0.0.1 --port 8765
`);
    return true;
  }
  if (resource === 'loop') {
    process.stdout.write(`Usage: ${command} loop <start|stop|status> [<issue-id>|<file.md>] [--max N] [--until <stage>]

A ralph loop whose completion oracle is \`check\`. \`start\` arms it; once the ztrack plugin's
Stop/SubagentStop hooks are wired (README → Agent workflows), every turn in this root — the main
agent's and any subagent's it delegates to — is held until the loop's oracle passes, capped at --max
iterations per actor (default 8). \`start\` with no id auto-scopes to the branch/worktree issue;
arming a DIFFERENT target while one is already armed refuses (\`stop\` first, or arm in a separate
worktree). \`start\` also warns (never refuses) if it can't detect the gate is wired, and if a bare
(no --until) arm targets something already green — nothing would be held.

Two modes, same \`start\`:
  (bare)              validate-current-stage: hold until the target's CURRENT status passes check.
  --until <stage>      drive-to-stage: hold until the issue's status reaches <stage> or later (per
                       the active preset's status vocabulary, e.g. \`ready\`/\`done\`) AND check is
                       green there. Single-issue targets only (an id, or bare/auto); an unknown
                       stage, or a file/whole-tracker target, fails the arm loud, naming the real
                       vocabulary. Flipping the status early doesn't cheat this — that stage's own
                       lifecycle gates still have to pass for real.

\`stop\` disarms; \`status\` shows the armed target (and the --until stage, if any).
`);
    return true;
  }
  if (resource === 'issue') {
    process.stdout.write(`Usage: ${command} issue <action> [args...]

Actions: scaffold, list, view, get, create, edit, patch, delete, close, comment.
  ${command} issue patch <issue> --json '{...}'   overlay the preset's schema fields (see \`issue view\`)
`);
    return true;
  }
  // ZTB-24 dev/05: `milestone` and the wider <list|view|get|issues|create|update> grammar were
  // 100% prose with zero implementation — the only real project verb is `project list` (returns
  // `[]` today; markdownBackend.ts).
  if (resource === 'project') {
    process.stdout.write(`Usage: ${command} project list [args...]\n`);
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

  ${command} evidence add <file>|--file path [--name <n>] [--commit]   COMMIT mode (default): copy
       into the evidence dir; cite the printed \`image=<path>\` and commit it → verified at the cited
       commit. --commit forces commit mode even when \`evidence.store\` defaults to attach.
  ${command} evidence add <file> --attach          ATTACH mode (linked GitHub repo): upload as a
       release asset; cite \`image=<url> sha256=<digest>\`. The gate accepts it offline (the digest
       is a tamper-evident pin); run \`evidence verify\` to fetch + compare.
  ${command} evidence verify [--issues a,b]         fetch every URL-pinned evidence and check its
       content matches the pinned sha256 (the network step \`check\` skips). gh-auth for private repos.
  ${command} evidence verify --bundle envelopes.json --key public.pem   verify a DSSE bundle offline.
  ${command} evidence keygen [--out-dir dir]        DSSE signing keypair (default .volter/keys).
  ${command} evidence export --format in-toto [--issues a,b] [--sign --sign-key key.pem] [--out file]
       in-toto attestation export; --sign requires --sign-key (from \`evidence keygen\`).

Evidence is commit + proof at its core; an image is optional and verified when cited. Storage is
set by \`evidence.store\` in the config (default \`commit\`; \`attach\` uploads to the linked repo).
`);
    return true;
  }
  if (resource === 'ac') {
    process.stdout.write(`Usage: ${command} ac patch <issue> <acId> --json '{...}' [--dry-run]

Overlays the preset's AC schema fields onto one acceptance criterion (run \`${command} issue view\`
to see the shape), then re-serializes through the preset — e.g. \`{"checked":true,"status":"passed"}\`.
--dry-run evaluates the whole write path — schema validation AND every backend write gate — and
mutates nothing; it fails exactly where the real run would fail (ztrack#28).
`);
    return true;
  }
  if (resource === 'lint') {
    process.stdout.write(`Usage: ${command} lint [--issues a,b] [--json] [--fail-on-warn]

A soft style lint over issue bodies: TODO/FIXME/TBD markers, unfilled template tokens, an
unchecked AC still carrying a Commit: claim, and \`weak_claim\` — assertive verification
phrasing ("works perfectly", "fully verified", ...) not accompanied by a cited evidence ref.
weak_claim reads prose, not truth: it flags wording, never confirms or disputes the claim
itself. Always ends with a summary line, pass or fail. This is advisory; \`${command} check\`
is the hard gate that fails on missing evidence. --fail-on-warn exits nonzero on any finding.
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
