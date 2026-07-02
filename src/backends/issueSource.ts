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
  ids(): string[];
  load(id: string): CanonicalIssue | null;
  origin(id: string): SourceOrigin;
  /** Persist `c` into this source. A `document` source always throws (fail closed — see
   *  documentSource.ts's `documentWriteError`; write-back lands in ZTB-4 dev/09). */
  write(c: CanonicalIssue): void;
  /** Remove `id` from this source. A `document` source always throws, same as `write`. */
  delete(id: string): void;
}
