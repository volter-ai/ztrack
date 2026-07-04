import { loadEnvFiles, loadTrackerConfig, projectRootFrom } from './config.ts';
import { createMarkdownBackend } from './backends/markdownBackend.ts';
import { identifierFromCreateOutput } from './createOutputId.ts';
import { executeTrackerGraphql } from './graphql.ts';
import { resolveSources } from './sources.ts';
import type { TrackerClient, TrackerIssueInput, TrackerIssueUpdate } from './types.ts';

// Re-exported for the public `ztrack/sdk` API (unchanged) — the implementation is the ONE shared
// copy in createOutputId.ts (also used by graphql.ts; see that file's top comment for why it's a
// standalone module rather than living here).
export { identifierFromCreateOutput };

function parseJsonOrText(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function issueCreateArgs(input: TrackerIssueInput): string[] {
  const args = ['issue', 'create', '--title', input.title];
  if (input.body) args.push('--body', input.body);
  if (input.state) args.push('--state', input.state);
  if (input.assignee) args.push('--assignee', input.assignee);
  if (input.parent) args.push('--parent', input.parent);
  if (input.project) args.push('--project', input.project);
  for (const label of input.labels ?? []) args.push('--label', label);
  return args;
}

function issueEditArgs(identifier: string, input: TrackerIssueUpdate): string[] {
  const args = ['issue', 'edit', identifier];
  if (input.title) args.push('--title', input.title);
  if (input.body !== undefined) args.push('--body', input.body);
  if (input.state) args.push('--state', input.state);
  if (input.assignee !== undefined) args.push('--assignee', input.assignee);
  if (input.project) args.push('--project', input.project);
  if (input.removeProject) args.push('--remove-project');
  if (input.parent) args.push('--parent', input.parent);
  if (input.removeParent) args.push('--remove-parent');
  for (const label of input.addLabels ?? []) args.push('--add-label', label);
  for (const label of input.removeLabels ?? []) args.push('--remove-label', label);
  return args;
}

export function createTrackerClient(options: { projectRoot?: string } = {}): TrackerClient {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  loadEnvFiles(projectRoot);
  const config = loadTrackerConfig(projectRoot);
  // markdown is the only backend. A config still on the removed Python `local` backend
  // has its issues in tracker.sqlite — direct the user to the one-time migration rather
  // than silently reading an empty markdown store.
  if (config.backend === 'local') {
    throw new Error(
      'This project uses the removed Python `local` backend (issues are in .volter/tracker/tracker.sqlite). '
      + 'Run `ztrack migrate-local` once to convert them to the pure-JS markdown backend.',
    );
  }
  // `sources` (ZTB-3): a declared list of markdown stores the backend unions by issue id. Absent
  // config -> resolveSources returns the one implicit default (byte-identical to pre-ZTB-3).
  // Resolved here (not lazily inside the backend) so every command sees the same source list —
  // both `issue-per-file` and `document` (ZTB-4) formats are resolved eagerly and uniformly.
  const sources = resolveSources(projectRoot, config);
  const backend = createMarkdownBackend(projectRoot, config.local?.teamKey ?? 'PH', sources);

  return {
    command(args, inputText) {
      return backend.command(args, inputText);
    },
    async graphql<T = unknown>(query: string, variables?: Record<string, unknown>) {
      return executeTrackerGraphql(backend, query, variables) as Promise<{ data?: T; errors?: Array<{ message: string }> }>;
    },
    issue: {
      async list(options = {}) {
        const args = ['issue', 'list'];
        if (options.state) args.push('--state', options.state);
        if (options.search) args.push('--search', options.search);
        if (options.parent) args.push('--parent', options.parent);
        if (options.limit) args.push('--limit', String(options.limit));
        for (const label of Array.isArray(options.label) ? options.label : options.label ? [options.label] : []) args.push('--label', label);
        if (options.json) args.push('--json', options.json);
        if (options.jq) args.push('--jq', options.jq);
        return parseJsonOrText((await backend.command(args)).stdout);
      },
      async view(identifier, options = {}) {
        const args = ['issue', 'view', identifier];
        if (options.comments) args.push('--comments');
        if (options.json !== undefined) args.push('--json', options.json);
        else args.push('--json');
        if (options.jq) args.push('--jq', options.jq);
        return parseJsonOrText((await backend.command(args)).stdout) as Record<string, unknown>;
      },
      async create(input) {
        const output = (await backend.command(issueCreateArgs(input))).stdout.trim();
        return this.view(identifierFromCreateOutput(output));
      },
      async edit(identifier, input) {
        await backend.command(issueEditArgs(identifier, input));
        return this.view(identifier);
      },
      async comment(identifier, body) {
        await backend.command(['issue', 'comment', identifier, '--body', body]);
      },
      async close(identifier, options = {}) {
        const args = ['issue', 'close', identifier];
        if (options.reason) args.push('--reason', options.reason);
        if (options.comment) args.push('--comment', options.comment);
        await backend.command(args);
      },
    },
    project: {
      async list(options = {}) {
        const args = ['project', 'list'];
        if (options.status) args.push('--status', options.status);
        if (options.json) args.push('--json', options.json);
        if (options.jq) args.push('--jq', options.jq);
        return parseJsonOrText((await backend.command(args)).stdout);
      },
      async view(identifier, options = {}) {
        const args = ['project', 'view', identifier];
        if (options.json !== undefined) args.push('--json', options.json);
        if (options.jq) args.push('--jq', options.jq);
        return parseJsonOrText((await backend.command(args)).stdout) as Record<string, unknown>;
      },
    },
    async snapshot(name = 'project-manager', options = {}) {
      const args = ['snapshot', name];
      if (options.format) args.push('--format', options.format);
      const result = await backend.command(args);
      // ztrack issue #19 (snapshot is a stub): the markdown backend's `snapshot` verb has no real
      // implementation (backends/markdownBackend.ts) — it returns an empty stdout and a
      // "not yet implemented" stderr message. `parseJsonOrText` only reads stdout, so this used to
      // silently resolve to `null` — indistinguishable from "here is your empty snapshot". Surface
      // the backend's own error instead of swallowing it; do NOT implement snapshot itself here.
      if (!result.stdout.trim() && result.stderr.trim()) throw new Error(result.stderr.trim());
      return parseJsonOrText(result.stdout);
    },
  };
}

export type { TrackerClient } from './types.ts';
