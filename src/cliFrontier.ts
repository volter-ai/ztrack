// ZTB-30: the dispatch frontier — `ztrack issue list --actionable` / `--blocked`. An orchestrator
// running "load a backlog, work out the dependency tree, dispatch subagents wave by wave" needs to
// ask "which issues can be worked on RIGHT NOW?" without reimplementing the graph walk that
// `core/blocking.ts` already does for `check`. This is the read-only reporting surface over that
// SAME graph (`issueFrontier`, core/blocking.ts) — no new computation, just a CLI-shaped view of it.
//
// Both views share one computation (`issueFrontier`): an issue is "actionable" iff it is not done
// AND not blocked; "blocked" iff it is not done AND is blocked. `--blocked` additionally names the
// NEAREST unmet blocker(s) per issue (see blocking.ts's `nearestBlockers` doc comment for why
// "nearest", not the full transitive closure `blockStatuses` returns).
//
// Deliberately intercepted BEFORE `createTrackerClient()`/the generic backend dispatch in cli.ts —
// like `check`/`export`, it resolves its own project + preset (it needs `preset.isIssueDone` and the
// VALIDATED root from `checkTracker`, not the raw canonical rows the plain `issue list` reads) — see
// check.ts's `checkTracker` and cliLoop.ts's `isTargetAlreadyGreen` for the same in-process,
// offline, read-only reuse pattern. Never mutates anything; degrades honestly (never throws) when
// the tracker can't even produce a validated export (an otherwise-red `check`) — same "read-only,
// deterministic, offline" invariant the loop oracle holds itself to (see cli.ts's `check` comment).
import { checkTracker } from './check.ts';
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { stateTypeOf } from './backends/markdown.ts';
import { issueFrontier, nodeSatisfied, nodeIndex } from './core/blocking.ts';
import { formatRef } from './core/ref.ts';
import type { BlockRef, CoreIssue } from './core/engine.ts';
import { optionValue } from './cliArgs.ts';
import { commandName } from './cliHelp.ts';

const FIELD_NAMES = ['identifier', 'id', 'number', 'title', 'state', 'status', 'stateType', 'labels', 'blockers'] as const;

function fieldValue(issue: CoreIssue, field: string, blockers: BlockRef[] | undefined, nodes: ReturnType<typeof nodeIndex>): unknown {
  switch (field) {
    case 'identifier': case 'id': case 'number': return issue.id;
    case 'title': return issue.title;
    case 'state': case 'status': return issue.status;
    case 'stateType': return stateTypeOf(issue.status);
    case 'labels': return issue.labels ?? [];
    case 'blockers': return (blockers ?? []).map((b) => {
      const key = formatRef(b);
      const node = nodes.get(key);
      return { ref: key, status: node?.kind === 'ac' ? node.ac!.status : node?.issue.status ?? null };
    });
    default: return null;
  }
}

/** `ztrack issue list --actionable|--blocked` — returns true once handled (whether it succeeded,
 *  errored, or degraded), so the caller never falls through to the generic backend dispatch. Returns
 *  false for a plain `issue list` (no frontier flag) — that keeps flowing through the existing path,
 *  byte-identical. */
export async function handleIssueListFrontier(args: string[]): Promise<boolean> {
  if (!(args[0] === 'issue' && args[1] === 'list')) return false;
  const wantActionable = args.includes('--actionable');
  const wantBlocked = args.includes('--blocked');
  if (!wantActionable && !wantBlocked) return false;
  const command = commandName();
  if (wantActionable && wantBlocked) {
    throw new Error(`${command} issue list: --actionable and --blocked are mutually exclusive — they are two complementary views over the same dispatch-frontier computation (unblocked vs blocked). Pick one. Nothing was read.`);
  }
  // `--parent` isn't modeled at the validated-root level this view computes over (the core schema
  // tracks `children`, not a `parent` pointer — see core/engine.ts's CoreIssue) — reject it loudly
  // rather than silently ignoring a flag the caller thinks is filtering.
  if (args.includes('--parent')) {
    throw new Error(`${command} issue list --actionable/--blocked: --parent is not supported on this view (the frontier is computed over the validated model, which has no parent pointer) — use plain '${command} issue list --parent <id>' instead. Nothing was read.`);
  }

  const projectRoot = projectRootFrom();
  const config = loadTrackerConfig(projectRoot);
  const preset = await resolveTrackerValidation(config, projectRoot);
  const result = await checkTracker({ projectRoot, config });
  const root = result.export;
  // Degrade honestly: no validated export at all (every issue failed wellformed_shape, or worse)
  // means nothing is computable — print an empty result rather than crashing. `check` itself
  // remains the source of truth for WHY; this view just can't compute a frontier over nothing.
  if (!root) {
    process.stdout.write('[]\n');
    return true;
  }

  const opts = { isIssueDone: preset.isIssueDone };
  const nodes = nodeIndex(root);
  const frontier = issueFrontier(root, opts);

  let issues = root.issues.filter((issue) => !nodeSatisfied(nodes.get(issue.id)!, opts));
  issues = issues.filter((issue) => (wantBlocked ? frontier.get(issue.id)!.blocked : !frontier.get(issue.id)!.blocked));

  const state = optionValue(args, '--state') || undefined;
  if (state === 'open') issues = issues.filter((i) => stateTypeOf(i.status) === 'open');
  else if (state === 'closed') issues = issues.filter((i) => stateTypeOf(i.status) !== 'open');
  else if (state && state !== 'all') issues = issues.filter((i) => i.status === state);

  const label = optionValue(args, '--label') || undefined;
  if (label) issues = issues.filter((i) => (i.labels ?? []).includes(label));

  const search = optionValue(args, '--search') || undefined;
  if (search) issues = issues.filter((i) => `${i.title}\n${i.summary}`.toLowerCase().includes(search.toLowerCase()));

  // Deterministic order: identifier ascending — the frontier computation itself has no inherent
  // order (root.issues order is whatever the sources happened to read in), and a read-only,
  // dispatch-facing surface must not vary run to run for the same tracker state.
  issues = [...issues].sort((a, b) => a.id.localeCompare(b.id));

  const limitRaw = optionValue(args, '--limit');
  const limitN = Number(limitRaw);
  if (limitRaw && Number.isFinite(limitN) && limitN >= 0) issues = issues.slice(0, limitN);

  const requestedFields = (optionValue(args, '--json') || 'identifier,title,state').split(',').map((s) => s.trim()).filter(Boolean);
  // The whole point of `--blocked` is naming the nearest blocker(s) — include it even if the
  // caller didn't think to ask, unless they explicitly picked fields (then respect their choice,
  // but still append `blockers` so the view can't silently degrade into a plain issue list).
  const fields = wantBlocked && !requestedFields.includes('blockers') ? [...requestedFields, 'blockers'] : requestedFields;

  const rows = issues.map((issue) => {
    const blockers = wantBlocked ? frontier.get(issue.id)!.blockers : undefined;
    const row: Record<string, unknown> = {};
    for (const f of fields) row[f] = FIELD_NAMES.includes(f as (typeof FIELD_NAMES)[number]) ? fieldValue(issue, f, blockers, nodes) : null;
    return row;
  });
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  return true;
}
