import { loadEnvFiles, loadTrackerConfig, projectRootFrom } from './config.ts';
import { createLocalBackend } from './backends/local.ts';
import { createMarkdownBackend } from './backends/markdownBackend.ts';
import { executeTrackerGraphql } from './graphql.ts';
import type { TrackerClient, TrackerIssueInput, TrackerIssueUpdate } from './types.ts';

function parseJsonOrText(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// `issue create` stdout differs by backend: the local backend prints "<id>\t<title>",
// the markdown backend prints the created issue as JSON. Accept either.
export function identifierFromCreateOutput(stdout: string): string {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { identifier?: unknown }).identifier === 'string') {
      return (parsed as { identifier: string }).identifier;
    }
  } catch { /* not JSON — fall through to the tab/space-delimited form */ }
  return trimmed.split(/\s+/)[0] ?? '';
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
  const backend = config.backend === 'markdown'
    ? createMarkdownBackend(projectRoot, config.local?.teamKey ?? 'PH')
    : createLocalBackend(config.backend, projectRoot);

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
      return parseJsonOrText((await backend.command(args)).stdout);
    },
  };
}

export type { TrackerClient } from './types.ts';
