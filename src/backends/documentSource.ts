// ZTB-4 dev/08: a `format: "document"` source's on-disk machinery — one markdown FILE, parsed
// (src/documentParser.ts) into many issues at construction. Read-only for now: `write`/`delete`
// always fail closed (dev/09 — write-back riding on ZTB-5's position-preserving serialization).
import { existsSync, readFileSync } from 'node:fs';
import type { IssueSource, SourceOrigin } from './issueSource.ts';
import type { CanonicalIssue } from './markdown.ts';
import { parseMarkdownDocumentSource, type DocumentParsedIssue } from '../documentParser.ts';
import type { ResolvedSource } from '../sources.ts';

/** The exact fail-closed message every write path shows for a document-sourced issue (edit,
 *  comment, close, delete via `MarkdownBackend.requireSourceWritable`, and `DocumentSource.write`/
 *  `.delete` themselves as defense-in-depth) — always names the source file. */
export function documentWriteError(filePath: string): Error {
  return new Error(
    `the source '${filePath}' is a "document" source (one markdown file holding many issues); ztrack cannot write ` +
    'back to it yet — document-source write-back (splicing an edit into the file in place, preserving everything ' +
    "else byte-for-byte) lands with ZTB-4 dev/09, built on ZTB-5's position-preserving serialization. Edit the " +
    'file directly for now, or move this issue to an issue-per-file source.',
  );
}

function toCanonicalIssue(parsed: DocumentParsedIssue): CanonicalIssue {
  return {
    identifier: parsed.id, title: parsed.title, body: parsed.body,
    // No frontmatter to read a status from — default to the same "freshly minted" values
    // `issue create` uses for an omitted `--state` (draft / open; see markdownBackend.ts).
    state: 'draft', stateType: 'open',
    assignees: [], labels: [], project: null, parent: parsed.parent, children: parsed.children,
    branchName: '', priority: 0, devProgress: null,
    // Deterministic, not per-load-varying (unlike `new Date().toISOString()`) — a document source
    // has no stored timestamps, so round-trip/idempotency never depends on wall-clock time.
    createdAt: '', updatedAt: '', completedAt: null, canceledAt: null,
    url: `local://tracker/issue/${parsed.id}`, comments: [],
  };
}

interface LoadedIssue { issue: CanonicalIssue; lineStart?: number; lineEnd?: number }

export class DocumentSource implements IssueSource {
  readonly format = 'document' as const;
  readonly readonlySource: boolean;
  readonly isDefault: boolean;
  readonly location: string; // the file itself — ResolvedSource.dir names a FILE for a document source
  private readonly byId: Map<string, LoadedIssue>;

  constructor(resolved: ResolvedSource) {
    this.location = resolved.dir;
    this.readonlySource = resolved.readonly;
    this.isDefault = resolved.isDefault; // always false in practice: a file path never equals markdownStoreDir()
    const text = existsSync(this.location) ? readFileSync(this.location, 'utf8') : '';
    this.byId = new Map(parseMarkdownDocumentSource(text, this.location).map((parsed) => [
      parsed.id,
      { issue: toCanonicalIssue(parsed), lineStart: parsed.lineStart, lineEnd: parsed.lineEnd },
    ]));
  }

  ids(): string[] { return [...this.byId.keys()]; }
  load(id: string): CanonicalIssue | null { return this.byId.get(id)?.issue ?? null; }
  origin(id: string): SourceOrigin {
    const entry = this.byId.get(id);
    return {
      path: this.location,
      ...(entry?.lineStart !== undefined ? { lineStart: entry.lineStart } : {}),
      ...(entry?.lineEnd !== undefined ? { lineEnd: entry.lineEnd } : {}),
    };
  }
  write(_c: CanonicalIssue): void { throw documentWriteError(this.location); }
  delete(_id: string): void { throw documentWriteError(this.location); }
}
