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
import type { Context, CoreRoot, IssueColumns, IssueRecord, Preset } from './engine.ts';
import type { RuleCategory } from '../checkRules.ts';
import type { TrackerIssueUpdate } from '../types.ts';

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
  records: IssueRecord[];
  context: Context;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

// Read one backend row into the structured IssueRecord the preset consumes: metadata straight
// from the columns, content from the body. Core NEVER synthesizes metadata-as-markdown — the
// metadata stays structured all the way to the preset, so there is no body↔column split-brain.
export function rowToRecord(row: Row): IssueRecord {
  return {
    id: str(row.identifier) || str(row.id) || str(row.number),
    title: str(row.title),
    status: str(row.state),
    ...(str(row.assignee) ? { assignee: str(row.assignee) } : {}),
    ...(Array.isArray(row.labels) ? { labels: strList(row.labels) } : {}),
    ...(Array.isArray(row.children) ? { children: strList(row.children) } : {}),
    body: str(row.body) || str(row.description),
  };
}

// Read one issue's `issue view --json` result into an IssueRecord. `view` returns the nested
// GraphQL shape (`state:{name}`, `assignee:{name}`, `labels:{nodes:[{name}]}`), unlike the
// loader's flattened list rows — so unwrap both. Used by the write path (`ac patch`/`fmt`).
export function viewToRecord(view: Record<string, unknown>, fallbackId: string): IssueRecord {
  const name = (v: unknown): string => typeof v === 'string' ? v : (v && typeof v === 'object' ? str((v as { name?: unknown; identifier?: unknown }).name) || str((v as { identifier?: unknown }).identifier) : '');
  const nodeNames = (v: unknown): string[] => v && typeof v === 'object' && Array.isArray((v as { nodes?: unknown[] }).nodes)
    ? (v as { nodes: unknown[] }).nodes.map(name).filter(Boolean)
    : Array.isArray(v) ? v.map(name).filter(Boolean) : [];
  const assignee = name(view.assignee) || nodeNames(view.assignees)[0] || '';
  const labels = nodeNames(view.labels);
  const children = nodeNames(view.children);
  return {
    id: str(view.identifier) || fallbackId,
    title: str(view.title),
    status: name(view.state),
    ...(assignee ? { assignee } : {}),
    ...(labels.length ? { labels } : {}),
    ...(children.length ? { children } : {}),
    body: str(view.body),
  };
}

// Build the backend edit input that persists a serialize() result: the content body plus the
// CHANGED metadata columns (status->state, assignee, label add/remove diff vs the record).
export function columnsToEdit(body: string, columns: IssueColumns, record: IssueRecord): TrackerIssueUpdate {
  const cur = record.labels ?? [];
  return {
    body,
    ...(columns.title !== undefined && columns.title !== record.title ? { title: columns.title } : {}),
    ...(columns.status !== undefined && columns.status !== record.status ? { state: columns.status } : {}),
    ...((columns.assignee ?? '') !== (record.assignee ?? '') ? { assignee: columns.assignee ?? '' } : {}),
    ...(columns.labels !== undefined
      ? { addLabels: columns.labels.filter((l) => !cur.includes(l)), removeLabels: cur.filter((l) => !columns.labels!.includes(l)) }
      : {}),
  };
}

/** Load the tracker into the structured issue records + the typed Context. */
export async function loadValidationInput<R extends CoreRoot>(
  preset: Preset<R>,
  opts: LoadOptions,
): Promise<LoadedInput> {
  const client = createTrackerClient({ projectRoot: opts.projectRoot });
  const rows = await client.issue.list({
    state: 'all',
    limit: opts.limit ?? 5000,
    json: 'identifier,title,body,description,state,stateType,assignee,labels,children',
  });
  const all = Array.isArray(rows) ? (rows as Row[]) : [];
  const wanted = opts.issues ? new Set(opts.issues.map(String)) : null;
  const records = all.map(rowToRecord).filter((r) => r.id && (!wanted || wanted.has(r.id)));
  return { records, context: await buildContext(preset, records, opts) };
}

// Build the typed Context: the preset gathers its OWN observed facts via loadContext
// (git/world/services — preset-owned, like its schema). loadContext still receives a markdown
// `bundle` for its body-level facts (e.g. PR branches), built here from the records' CONTENT
// bodies. The loader overlays the universal run selectors (now/phase/categories).
export async function buildContext<R extends CoreRoot>(preset: Preset<R>, records: IssueRecord[], opts: LoadOptions): Promise<Context> {
  const bundle = buildIssueBundle(records.map((r) => ({ id: r.id, body: r.body })));
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
