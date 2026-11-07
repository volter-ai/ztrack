// ZTB-4 dev/08: the common per-source contract `MarkdownBackend` routes every command through, at
// the CanonicalIssue level (not the store's frontmatter text) — so a `document` source (one
// markdown file decomposed into many issues, src/documentParser.ts) and an `issue-per-file` source
// (one file per issue, src/backends/markdownBackend.ts's `MarkdownSource`) look identical to
// everything above them: `issue list`/`view`, `--parent` filtering, GraphQL — all of which only
// ever call `backend.command`, which only ever calls these methods.
//
// `MarkdownSource`'s existing internals (resolveBody/originPath/write/delete, the shared-board
// index/trunk union) are UNCHANGED — this interface is layered on top of them additively, so
// issue-per-file's code paths are provably equivalent to pre-ZTB-4.
import type { SourceFormat } from '../sources.ts';
import type { CanonicalIssue } from './markdown.ts';

export interface SourceOrigin { path: string; lineStart?: number; lineEnd?: number }

export interface IssueSource {
  readonly format: SourceFormat;
  readonly readonlySource: boolean;
  readonly isDefault: boolean;
  /** Human-readable "where this source lives", used in error messages (a directory for
   *  `issue-per-file`, the file itself for `document`). */
  readonly location: string;
  /** The `--source` selector for this source (ZTB-33) — `ResolvedSource.name` (config `name`, else
   *  the declared path, else `'default'`). A routing label only; selection also accepts the
   *  basename of `location` (see markdownBackend's `selectSources`). */
  readonly name: string;
  ids(): string[];
  load(id: string): CanonicalIssue | null;
  origin(id: string): SourceOrigin;
  /** Persist `c` into this source. A `document` source (ZTB-4 dev/09 — documentSource.ts) accepts
   *  only a narrow delta (`body`/`title`, splicing into the issue's recorded span) and fails
   *  closed, naming the file and the reason, for anything wider (status/assignee/labels/
   *  project/parent/children/comments, an excised subtree, the umbrella issue, a stale read).
   *
   *  `opts.dryRun` (ztrack#28): run EVERY gate this write would run — the document source's
   *  structural/delta/staleness/integrity guards included — but stop short of the final
   *  filesystem mutation (and any in-memory view refresh). A dry run that returns without
   *  throwing is therefore an honest prediction that the real write would be accepted; a dry
   *  run must never succeed where the real write would refuse. */
  write(c: CanonicalIssue, opts?: { dryRun?: boolean }): void;
  /** Remove `id` from this source. A `document` source always throws (removing a section is a
   *  file edit, not a tracker op — see documentSource.ts's `documentDeleteError`). */
  delete(id: string): void;
}
