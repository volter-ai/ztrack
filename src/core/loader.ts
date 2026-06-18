// The loader — the ONE impure boundary of validation.
//
// It reads issue markdown from the tracker backend and gathers observed world
// facts (git commits, PR/branch heads, current time, optional twin world), then
// returns a single markdown bundle + the typed Context. Everything downstream —
// the preset's mdast parse, the strict ValidationInputSchema, the pure rules —
// touches no filesystem, git, or network. Filesystem/git/backend reads belong
// here, never in rules.

import { createTrackerClient } from '../sdk.ts';
import { buildIssueBundle } from './bundle.ts';
import type { Context, CoreRoot, Preset } from './engine.ts';
import type { RuleCategory } from '../checkRules.ts';

export interface LoadOptions {
  projectRoot: string;
  issues?: string[];
  limit?: number;
  now?: string;
  phase?: 'all' | 'gate';
  categories?: Partial<Record<RuleCategory, number>>;
  // when false, commit-existence facts are withheld so commit-verification rules
  // skip (the typed replacement for the old `--verify-commits` opt-in).
  verifyCommits?: boolean;
}

export interface LoadedInput {
  bundle: string;
  bodies: Array<{ id: string; body: string }>;
  context: Context;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Render one backend row into a self-contained, parseable issue markdown document:
// the body markdown plus the metadata (id/title/state/assignee/labels) the backend
// keeps in columns. This is the "issue markdown" the preset's parser consumes.
function renderIssueMarkdown(row: Row): { id: string; body: string } {
  const id = str(row.identifier) || str(row.id) || str(row.number);
  const title = str(row.title);
  const body = str(row.body) || str(row.description);
  const labels = Array.isArray(row.labels) ? row.labels.map(String) : [];
  const head: string[] = [`# ${id}: ${title}`, ''];
  const state = str(row.state);
  const stateType = str(row.stateType);
  const assignee = str(row.assignee);
  if (state) head.push(`Status: ${state}`);
  if (stateType) head.push(`StateType: ${stateType}`);
  if (assignee) head.push(`Assignee: ${assignee}`);
  if (labels.length) head.push(`Labels: ${labels.join(', ')}`);
  head.push('');
  return { id, body: `${head.join('\n')}\n${body}\n` };
}

/** Load the tracker into one ValidationInput-ready bundle + typed Context. */
export async function loadValidationInput<R extends CoreRoot>(
  preset: Preset<R>,
  opts: LoadOptions,
): Promise<LoadedInput> {
  const client = createTrackerClient({ projectRoot: opts.projectRoot });
  const rows = await client.issue.list({
    state: 'all',
    limit: opts.limit ?? 5000,
    json: 'identifier,title,body,description,state,stateType,assignee,labels',
  });
  const list = Array.isArray(rows) ? (rows as Row[]) : [];
  const wanted = opts.issues ? new Set(opts.issues.map(String)) : null;
  const bodies = list
    .filter((row) => !wanted || wanted.has(str(row.identifier) || str(row.id)))
    .map(renderIssueMarkdown)
    .filter((b) => b.id);
  const bundle = buildIssueBundle(bodies);
  return { bundle, bodies, context: await buildContext(preset, bundle, opts) };
}

// Build the typed Context: the preset gathers its OWN observed facts via
// loadContext (git/world/services — preset-owned, like its schema); a preset that
// declares no loadContext needs no observed facts. The loader only overlays the
// universal run selectors (now/phase/categories) the CLI passes.
export async function buildContext<R extends CoreRoot>(preset: Preset<R>, bundle: string, opts: LoadOptions): Promise<Context> {
  const observed = preset.loadContext
    ? await preset.loadContext({ projectRoot: opts.projectRoot, verifyCommits: opts.verifyCommits, bundle })
    : {};
  return {
    ...observed,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.phase ? { phase: opts.phase } : {}),
    ...(opts.categories ? { categories: opts.categories } : {}),
  };
}
