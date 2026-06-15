// The tracker store is local, with two interchangeable backends at parity:
// `local` (SQLite, scales) and `markdown` (a folder of .md files, human-readable
// and easy while a project fits in memory/disk). External systems (Linear, …)
// are sync spokes through the worlds pipeline — never alternate live backends.
export type TrackerBackendName = 'local' | 'markdown';

export interface TrackerConfig {
  backend: TrackerBackendName;
  local?: {
    teamKey?: string;
    database?: string;
    store?: string;
  };
  /**
   * Target validation architecture: tracker loads one repo-local validation
   * entrypoint after init. The entrypoint owns parser/schema/render semantics.
   * `organization.validationPreset` remains supported during migration.
   */
  validation?: {
    /** Path relative to project root, for example ".volter/tracker/validation/preset.ts". */
    entrypoint?: string;
    /** Starter/template used to install the entrypoint, e.g. "peak" or "speckit". */
    installedFrom?: string;
  };
  /** Deployment-specific conventions consumed by organization validation. */
  organization?: {
    /**
     * Compatibility validation selector. New repos should prefer validation.entrypoint,
     * installed by `tracker init --preset <name>`.
     * The current tracker-snapshot rulebook still honors
     * organization.grammar/check during migration.
     */
    validationPreset?: string;
    /** Regex sources (no flags) for external issue keys cited in client channels and case sources, e.g. "PEAK-\\d+". */
    linkedIssuePatterns?: string[];
    /** Per-system browse URL templates with an {id} placeholder, e.g. jira: "https://example.atlassian.net/browse/{id}". */
    externalBrowseUrls?: Record<string, string>;
    /**
     * Which top-level issue types are inspected as cases. Absent = the built-in
     * default set (type:case/bug/feature/delivery/topic/project +
     * source:stakeholder/jira). A label here is matched against issue labels
     * verbatim; this is how a project teaches the tracker its own type vocabulary.
     */
    caseTypeLabels?: string[];
    /**
     * Compatibility pluggable grammar: map the
     * tracker's normalized slots to a team's own heading vocabulary. Each slot's
     * accepted titles default to its canonical title; aliases here are added.
     * e.g. { slotAliases: { acceptanceCriteria: ["Done When"] } } lets a
     * team write "## Done When" and have its ACs picked up.
     *
     * Target architecture: new teams should prefer a preset-owned parser + Zod
     * schema (`strategy/tracker-architecture.md`) instead of growing this DSL.
     */
    grammar?: { extends?: string; slotAliases?: Record<string, string[]> };
    /**
     * Compatibility check selector for the current tracker-snapshot rulebook.
     * Absent = full strictness (all categories at max depth, all profiles).
     * New validation semantics belong in preset Zod schemas, not here.
     */
    check?: {
      /** Per-category depth: { sourced, code, visual, behavioral } 0-3 (0 = off). */
      categories?: Partial<Record<'sourced' | 'code' | 'visual' | 'behavioral' | 'wellformed', number>>;
      /** Compatibility process profiles. */
      profiles?: Array<'lifecycle' | 'delivery'>;
      /**
       * Per-type verification policy, evaluated in order, last match wins
       * (Renovate packageRules / ESLint overrides shape). Each rule selects
       * issues by `matchTypes` (type:* label suffixes, e.g. "bug") and/or
       * `matchLabels` (verbatim labels), AND-ed within a rule. A matched rule
       * may set `inspect: false` to silence the "checked dev work is not being
       * verified" warning for those issues, and/or `level` to override the
       * strictness applied to them. Issues with checked dev ACs that are not
       * inspected as cases and are not silenced raise dev_work_not_verified.
       */
      verify?: Array<{
        matchTypes?: string[];
        matchLabels?: string[];
        inspect?: boolean;
        categories?: Partial<Record<'sourced' | 'code' | 'visual' | 'behavioral' | 'wellformed', number>>;
      }>;
    };
  };
}

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
