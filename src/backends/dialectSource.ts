// A dialect LENS over one markdown file (docs/DIALECTS.md): the file's own task-list idiom
// (emoji status registers, checkbox rosters, …) served as ordinary issues, read-only by
// construction. The sibling of DocumentSource with the native grammar swapped for a declared
// dialect (src/dialects.ts) — same IssueSource contract, same CanonicalIssue presentation
// defaults, but EVERY write fails closed with the materialize pointer: a lens never edits the
// repo's file, that's the whole trust proposition. `ztrack import <file>` is the opt-in upgrade
// that converts the file to native grammar and drops the lens.
import { existsSync, readFileSync } from 'node:fs';
import type { ResolvedSource } from '../sources.ts';
import { parseWithDialect, type Dialect, type DialectDiagnostic, type DialectIssue } from '../dialects.ts';
import { type CanonicalIssue, stateTypeOf } from './markdown.ts';
import type { IssueSource, SourceOrigin } from './issueSource.ts';

function lensWriteError(location: string): Error {
  return new Error(
    `markdown backend (dialect source '${location}'): this file is a read-only dialect lens — ` +
    `edit the file directly, or materialize it with \`ztrack import ${location}\` to manage it through ztrack.`,
  );
}

function toCanonical(issue: DialectIssue): CanonicalIssue {
  return {
    assignees: [], body: issue.body, branchName: '',
    canceledAt: null, children: issue.children, comments: [], completedAt: null,
    // Deterministic empties, exactly DocumentSource's presentation defaults — a lens has no
    // stored timestamps either, and round-trips must never depend on wall-clock time.
    createdAt: '', devProgress: null, identifier: issue.id, labels: [], parent: issue.parent,
    priority: 0, project: null, state: issue.status, stateType: stateTypeOf(issue.status),
    title: issue.title, updatedAt: '', url: `local://tracker/issue/${issue.id}`,
  };
}

export class DialectSource implements IssueSource {
  readonly format = 'document' as const;
  readonly readonlySource = true; // a lens is read-only by CONSTRUCTION, not by configuration
  readonly isDefault: boolean;
  readonly location: string;
  readonly name: string;
  readonly dialectName: string;
  private readonly issuesById: Map<string, DialectIssue>;
  private readonly parseDiagnostics: DialectDiagnostic[];

  constructor(resolved: ResolvedSource & { dialect: Dialect }) {
    this.location = resolved.dir;
    this.isDefault = resolved.isDefault;
    this.name = resolved.name;
    this.dialectName = resolved.dialectName ?? 'inline';
    const text = existsSync(this.location) ? readFileSync(this.location, 'utf8').replace(/\r\n?/g, '\n') : '';
    const { diagnostics, issues } = parseWithDialect(text, resolved.dialect);
    this.issuesById = new Map(issues.map((issue) => [issue.id, issue]));
    this.parseDiagnostics = diagnostics;
  }

  ids(): string[] { return [...this.issuesById.keys()]; }

  load(id: string): CanonicalIssue | null {
    const issue = this.issuesById.get(id);
    return issue ? toCanonical(issue) : null;
  }

  /** True iff `id`'s status came from an actual surface token (vocabulary hit / checkbox) rather
   *  than the engine's `draft` default — the check pipeline's lens-leniency input. */
  statusExplicit(id: string): boolean { return this.issuesById.get(id)?.statusExplicit ?? false; }

  /** The engine's parse diagnostics (duplicate ids, unrecognized status tokens) — surfaced by
   *  `ztrack check` the same cross-cutting way DocumentSource.headerDiagnostics() is. */
  diagnostics(): DialectDiagnostic[] { return [...this.parseDiagnostics]; }

  origin(id: string): SourceOrigin {
    const issue = this.issuesById.get(id);
    return {
      path: this.location,
      ...(issue ? { lineEnd: issue.lineEnd, lineStart: issue.lineStart } : {}),
    };
  }

  write(): void { throw lensWriteError(this.location); }
  delete(): void { throw lensWriteError(this.location); }
}
