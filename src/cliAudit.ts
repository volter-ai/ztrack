// Wire the audit log into CLI mutations (ztrack #19). After a mutating command completes, run one
// preset-validated observe pass over the tracker and append an entry per change — the same
// `observeChanges` diff the visualizer runs per request, so CLI-only usage now populates
// `.audit.jsonl` (previously it was written only when the visualizer was running). Best-effort by
// contract: auditing NEVER changes a command's exit code or output — a repo that can't export (no
// preset yet, a transient parse error) simply records nothing, and `ztrack check` stays the source
// of truth. Diff-based, so this one central pass replaces per-mutation-path instrumentation:
// whichever of CLI/visualizer observes first advances the shared baseline and the other won't
// double-log.
import { cacheRoot, projectRootFrom } from './config.ts';
import { observeChanges, type ObservableIssue } from './core/audit.ts';
import { exportTrackerRoot } from './export.ts';

// Read-only `issue` subcommands never mutate; everything else under `issue` can. Keeping this an
// exclude-list (not an allow-list of write verbs) means a newly added write subcommand is audited
// by default rather than silently skipped.
const READONLY_ISSUE_SUBCOMMANDS = new Set(['view', 'list', 'show', 'get', 'log']);

/** Could this invocation have changed tracker state? Classifies from argv alone (independent of
 *  which handler ran), so it stays correct as dispatch evolves. Conservative on the read side:
 *  a false positive only costs one wasted export; a false negative would silently miss an edit. */
export function isMutatingCommand(args: string[]): boolean {
  const [verb, sub] = args;
  switch (verb) {
    case 'issue':
      return sub !== undefined && !READONLY_ISSUE_SUBCOMMANDS.has(sub);
    case 'ac':          // `ac patch` / `ac check`
    case 'tx':          // transactional multi-write
    case 'import':      // freeform → native issues
      return true;
    case 'waiver':      // grant/revoke write; `waiver list` reads
      return sub !== 'list';
    case 'sync':        // pull mutates the local store
      return true;
    case 'api':         // `api query` runs GraphQL — a `mutation{…}` writes; `api serve` is a
      return sub === 'query'; // long-running server that self-observes per request (server.ts)
    default:
      return false;
  }
}

// The MCP server is long-running: a single `mcp serve` process handles many tool calls, so the
// post-command observe in cli.ts (which fires once, at process exit) can't audit it. Instead the
// server observes after each write tool (mcp.ts). Exclude-list, mirroring the CLI's stance: a new
// tool is audited by default rather than silently skipped. `tracker_init` seeds its own baseline.
const READONLY_MCP_TOOLS = new Set(['tracker_check', 'tracker_issue_list', 'tracker_issue_view']);

/** Could this MCP tool call have changed tracker state? Read tools skip the observe pass. */
export function isMutatingMcpTool(name: string): boolean {
  return !READONLY_MCP_TOOLS.has(name);
}

/** Observe the tracker after a mutation and append audit entries. Best-effort: swallows every
 *  error so the audit log can never fail or slow-fail a user's command. */
export async function observeAfterMutation(projectRoot?: string): Promise<void> {
  try {
    const root = projectRoot ?? projectRootFrom();
    const exported = await exportTrackerRoot({ projectRoot: root });
    // CoreRoot issues are already shaped as ObservableIssue (id/status/acceptanceCriteria[].status
    // + evidence[]) — the same model the visualizer passes straight through.
    observeChanges(cacheRoot(root), exported.issues as unknown as ObservableIssue[], 'cli');
  } catch {
    /* no tracker/preset here, or a transient parse error — record nothing, never throw */
  }
}
