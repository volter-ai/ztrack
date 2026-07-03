// The tracker store is local markdown: a folder of human-readable .md files, pure JS.
// `local` is the removed Python/SQLite backend — retained in the union only so an old
// config naming it can be detected and routed to `ztrack migrate-local`. External
// systems (Linear, …) are sync spokes through the worlds pipeline, never live backends.
export type TrackerBackendName = 'local' | 'markdown';

/** One declared markdown source (ZTB-3). `path` is project-root-relative: a DIRECTORY of
 *  one-issue-per-file markdown (`issue-per-file`), or a single markdown FILE decomposed into many
 *  issues by its id-bearing headings (`document` — ZTB-4; see src/documentParser.ts). `format`
 *  defaults from the shape of `path` when omitted: a `.md` file → `document`, anything else →
 *  `issue-per-file`. `readonly: true` marks a source ztrack may read but never write — writes
 *  routed at it (by the target record's `origin.path`) are rejected. A `document` source, even
 *  when not `readonly: true`, only ever accepts a narrow `body`/title splice into an issue's
 *  recorded span (ZTB-4 dev/09 — see backends/documentSource.ts); every wider write (status,
 *  assignee, labels, reparent, comment, delete, create) still fails closed, naming the file. */
export interface TrackerSourceConfig {
  path: string;
  format?: 'issue-per-file' | 'document';
  readonly?: boolean;
}

export interface TrackerConfig {
  backend: TrackerBackendName;
  local?: {
    teamKey?: string;
    database?: string;
    store?: string;
  };
  /**
   * Declared markdown sources the tracker unions by issue id. Absent (the common case) is
   * EXACTLY today's single implicit store: one issue-per-file source at `markdownStoreDir()`
   * (which itself honors `local.teamKey` for id minting and `VOLTER_STATE_DIR` for relocation —
   * those stay properties of that implicit default entry, not a parallel mechanism). The same id
   * appearing in two DIFFERENT declared sources is a config-data error (`issue_id_conflict`
   * finding on `ztrack check`), never silent precedence — precedence is reserved for the
   * worktree board index *within* one source (see `board`).
   */
  sources?: TrackerSourceConfig[];
  /**
   * Board scope for a LOCAL (unlinked) tracker. `branch` (default): the committed per-worktree
   * `.volter` store IS the board — branch-scoped, issues merge with the code, but a coordinator
   * can't see other branches' state. `shared`: the committed store stays per-worktree (board still
   * in git), AND a central symlink index in `<git-common-dir>/ztrack/board` aggregates every
   * worktree's live issues, so a coordinator — and global id allocation — sees ONE board across all
   * worktrees without an external tracker. Ignored when `sync` is set (linked already has one store).
   */
  board?: 'branch' | 'shared';
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
   * Where evidence files (screenshots/artifacts) are stored. Verification is always
   * commit/locator-anchored regardless.
   *  - `commit` (default): the file is committed in `dir` and verified to exist at the cited
   *    commit (`git cat-file -e <sha>:<path>`). Works in both local and linked trackers.
   *  - `attach`: the file is uploaded to the linked provider (a release asset) and verified by its locator URL + digest (`evidence verify`).
   *  - `external`: an object store you configure.
   *  - `auto` (default): resolves to `commit` (the offline, commit-verified, code-adjacent model).
   *    `attach` is opt-in here or per-call via `evidence add --attach`.
   */
  evidence?: {
    store?: 'auto' | 'commit' | 'attach' | 'external';
    /** Directory for evidence files, relative to project root. Default `.volter/evidence`. */
    dir?: string;
  };
  /**
   * Relevance-anchor enforcement. The default preset lets a passed AC declare an optional
   * `paths:` glob; when set, its cited commit must TOUCH one of those paths (else
   * `evidence_commit_unrelated`). This dial controls whether the anchor is mandatory:
   *  - `optional` (default): a passed AC may omit `paths`; relevance is checked only when declared.
   *  - `required`: a passed AC MUST declare `paths` (else `passed_ac_missing_paths`), so EVERY
   *    passed AC's commit is relevance-checked. Non-breaking: existing repos default to `optional`.
   */
  relevance?: 'optional' | 'required';
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
    /** Per-rule severity override for `ztrack check` findings (lint.ts). Keys are rule codes. */
    lint?: { rules?: Record<string, 'warn' | 'error' | 'off'> };
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
