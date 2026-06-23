// The tracker store is local markdown: a folder of human-readable .md files, pure JS.
// `local` is the removed Python/SQLite backend — retained in the union only so an old
// config naming it can be detected and routed to `ztrack migrate-local`. External
// systems (Linear, …) are sync spokes through the worlds pipeline, never live backends.
export type TrackerBackendName = 'local' | 'markdown';

export interface TrackerConfig {
  backend: TrackerBackendName;
  local?: {
    teamKey?: string;
    database?: string;
    store?: string;
  };
  /**
   * A permanently-linked external task tracker. Set by `ztrack init --sync github --repo o/n`.
   * When present, `ztrack sync` needs no `--repo`, and user-facing `check`/`loop start`
   * best-effort sync the tracker with it (the Stop-hook gate never does — it must not hammer
   * the API mid-loop). Only `github` today; the provider lives at `src/sync/<provider>/`.
   */
  sync?: {
    provider: 'github';
    repo: string;
    /** Three-way reconcile policy for the bidirectional sync. Default `merge` (field-level:
     *  non-overlapping concurrent edits merge, a same-field collision is surfaced). `hub-wins`
     *  = GitHub authoritative on collision; `twin-wins` = the local tracker authoritative. */
    policy?: 'hub-wins' | 'twin-wins' | 'merge';
  };
  /**
   * Preferred validation architecture: ztrack loads one repo-local validation
   * entrypoint after init. The entrypoint owns parser/schema/render semantics.
   * Legacy configs that only set `organization.validationPreset` must be
   * migrated with `ztrack init --preset <starter>`.
   */
  validation?: {
    /** Path relative to project root, for example ".volter/tracker/validation/preset.mts". */
    entrypoint?: string;
    /** Starter/template used to install the entrypoint, e.g. "basic" or "speckit". */
    installedFrom?: string;
  };
  /** Project conventions consumed by installed validation and compatibility paths. */
  organization?: {
    /**
     * @deprecated Legacy named selector. New repos must use validation.entrypoint
     * installed by `ztrack init --preset <starter>`, which resolves to a core
     * preset (a standalone `Preset`). Configs with only this field are rejected.
     */
    validationPreset?: string;
    /** Per-system browse URL templates with an {id} placeholder, e.g. jira: "https://example.atlassian.net/browse/{id}". */
    externalBrowseUrls?: Record<string, string>;
    /**
     * Which top-level issue types are inspected as cases. Absent = the built-in
     * default set (type:case/bug/feature/... plus source:* labels). A label here is
     * matched against issue labels
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
     * For deeper project-specific semantics, prefer a repo-local preset-owned
     * parser + Zod schema instead of growing this DSL.
     */
    grammar?: { extends?: string; slotAliases?: Record<string, string[]> };
    /**
     * Rule-category selector for `ztrack check` (maps to Context.categories).
     * Absent = run every rule. New validation semantics belong in preset Zod
     * schemas + rules, not here.
     */
    check?: {
      /** Per-category depth: { sourced, code, visual, behavioral } 0-3 (0 = off). */
      categories?: Partial<Record<'sourced' | 'code' | 'visual' | 'behavioral' | 'wellformed', number>>;
      /** Process profiles a preset's rulebook can gate on (open set; preset-defined). */
      profiles?: string[];
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
