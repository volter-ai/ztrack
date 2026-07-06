// ZTB-23 dev/04: a CROSS-CUTTING check concern (like sync conflicts, src/sync/conflicts.ts) —
// document-source header-block diagnostics, read directly off disk rather than through the
// backend's `issue list` JSON contract (which has no room for a per-issue "this metadata was
// silently discarded" note without widening every caller's row shape). `ztrack check`'s
// multi-issue document scan (a `format: "document"` source, ZTB-4) parses each item's own
// `status:`/`assignee:` header block the same way the single-issue loose-file path
// (`fileToRecord`, src/check.ts) does — but unlike that path, it had no `loose_header_ignored`
// diagnostic when the block silently vanished for lack of a blank-line terminator (e.g.
// `assignee: me` immediately followed by prose). This closes that gap: it re-resolves every
// declared `document` source and surfaces `DocumentSource.headerDiagnostics()` as findings,
// merged into `checkTracker`'s result exactly like `conflictFindings` already is.
import type { Finding } from './core/engine.ts';
import type { TrackerConfig } from './types.ts';
import { resolveSources } from './sources.ts';
import { DocumentSource } from './backends/documentSource.ts';

/** One already-constructed DocumentSource's header diagnostics as findings — shared by the
 *  tracker-wide sweep below and by `checkFile`'s document mode (src/check.ts), so both surfaces
 *  report the identical `loose_header_ignored` shape for the identical silent-discard. */
export function documentSourceHeaderFindings(source: DocumentSource, path: string): Finding[] {
  return source.headerDiagnostics().map((d) => ({
    code: 'loose_header_ignored', severity: 'warning' as const, issueId: d.issueId,
    message: `${path}: ${d.message}`,
    origin: { path },
  }));
}

export function documentHeaderFindings(projectRoot: string, config: Pick<TrackerConfig, 'sources'>): Finding[] {
  const sources = resolveSources(projectRoot, config).filter((s) => s.format === 'document');
  const findings: Finding[] = [];
  for (const resolved of sources) {
    // Construction re-parses the file (the same parse the backend itself would do to serve
    // `issue list`) — cheap (one file, `ztrack check` frequency), and keeps this module a pure
    // reader with no shared mutable state with the backend's own DocumentSource instances.
    let source: DocumentSource;
    try {
      source = new DocumentSource(resolved);
    } catch {
      continue; // the backend's own read path surfaces a real parse failure; this is best-effort
    }
    findings.push(...documentSourceHeaderFindings(source, resolved.dir));
  }
  return findings;
}
