// The tracker store is local markdown: a folder of human-readable .md files, pure JS.
// `local` is the removed Python/SQLite backend — retained in the union only so an old
// config naming it can be detected and routed to `ztrack migrate-local`. External
// systems (Linear, …) are sync spokes through the worlds pipeline, never live backends.
export type TrackerBackendName = 'local' | 'markdown';

// ZTB-26: `TrackerConfig` and `TrackerSourceConfig` used to be hand-authored interfaces here, kept
// in sync BY HAND with `TrackerConfigSchema` (src/configSchema.ts) — the two drifted more than
// once (ZTB-22: `organization.lint.rules` was documented and read by lint.ts but missing from the
// schema for a full release). They're now derived from the schema via `z.infer` and re-exported
// here so the ~8 importers of `import type { TrackerConfig } from './types.ts'` don't churn. Field
// documentation that used to live on these interfaces now lives on the schema fields themselves
// (src/configSchema.ts) — the derivation is the reason to look there instead of here.
export type { RawTrackerConfig, TrackerConfig, TrackerSourceConfig } from './configSchema.ts';

export interface TrackerCommandResult {
  stdout: string;
  stderr: string;
}

export interface TrackerBackend {
  readonly name: TrackerBackendName;
  command(args: string[], inputText?: string): Promise<TrackerCommandResult>;
}

export interface TrackerIssueInput {
  title: string;
  body?: string;
  state?: string;
  assignee?: string;
  parent?: string;
  project?: string;
  labels?: string[];
}

export interface TrackerIssueUpdate {
  title?: string;
  body?: string;
  state?: string;
  assignee?: string;
  addLabels?: string[];
  removeLabels?: string[];
  project?: string;
  removeProject?: boolean;
  parent?: string;
  removeParent?: boolean;
}

export interface TrackerClient {
  command(args: string[], inputText?: string): Promise<TrackerCommandResult>;
  graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<{ data?: T; errors?: Array<{ message: string }> }>;
  issue: {
    list(options?: {
      state?: string;
      label?: string | string[];
      search?: string;
      parent?: string;
      limit?: number;
      json?: string;
      jq?: string;
      /** ZTB-33: scope the read to the named declared source(s) (`--source`). A single selector or
       *  a list; each matches a source by its `name` or its path basename. */
      source?: string | string[];
    }): Promise<unknown>;
    view(identifier: string, options?: { comments?: boolean; json?: string; jq?: string }): Promise<Record<string, unknown>>;
    create(input: TrackerIssueInput): Promise<Record<string, unknown>>;
    edit(identifier: string, input: TrackerIssueUpdate): Promise<Record<string, unknown> | null>;
    comment(identifier: string, body: string): Promise<void>;
    close(identifier: string, options?: { reason?: 'completed' | 'canceled'; comment?: string }): Promise<void>;
  };
  project: {
    list(options?: { status?: string; json?: string; jq?: string }): Promise<unknown>;
    view(identifier: string, options?: { json?: string; jq?: string }): Promise<Record<string, unknown>>;
  };
  snapshot(name?: string, options?: { format?: 'json' | 'text' }): Promise<unknown>;
}
