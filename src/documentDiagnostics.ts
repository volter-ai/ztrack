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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Finding } from './core/engine.ts';
import type { TrackerConfig } from './types.ts';
import { resolveSources } from './sources.ts';
import { DocumentSource } from './backends/documentSource.ts';
import { parseMarkdownDocumentSource } from './documentParser.ts';

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

// Don't content-scan a sibling bigger than this — a document source is a hand-authored plan file;
// anything this size is a log/artifact, and the scan must never make `check` crawl one.
const SIBLING_SCAN_MAX_BYTES = 4 * 1024 * 1024;

/** The "dark sibling" sweep: an `.md` file sitting in the SAME directory as a registered
 *  `format: "document"` source, itself holding issues in document grammar (id-bearing headings —
 *  same digit-carrying detection as `checkFile`'s mode flip, src/check.ts) but NOT registered as
 *  a source — the exact shape of the incident that motivated this: nine `workstream-*.md` files
 *  registered, a tenth authored beside them and silently invisible to `issue list`/`check`/`loop`.
 *  A warning (never gates by default), fired only on an UN-scoped `ztrack check` (inventory-level
 *  advice belongs on the full-tracker view, not on `check <issue-id>` or the per-issue loop
 *  gate). Registration is only ever OFFERED — mutating tracker-config.json is the user's call. */
export function unregisteredSiblingFindings(projectRoot: string, config: Pick<TrackerConfig, 'sources'>): Finding[] {
  const sources = resolveSources(projectRoot, config);
  const documentDirs = [...new Set(sources.filter((s) => s.format === 'document').map((s) => dirname(s.dir)))];
  if (!documentDirs.length) return []; // nothing to be a sibling OF — a no-document tracker is never scanned
  const registeredPaths = new Set(sources.map((s) => s.dir));
  const findings: Finding[] = [];
  for (const dir of documentDirs) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries.sort()) {
      if (!entry.toLowerCase().endsWith('.md')) continue;
      const path = join(dir, entry);
      if (registeredPaths.has(path)) continue;
      let ids: string[];
      try {
        if (statSync(path).size > SIBLING_SCAN_MAX_BYTES) continue;
        ids = parseMarkdownDocumentSource(readFileSync(path, 'utf8'), path)
          .filter((p) => p.lineStart !== undefined && /\d/.test(p.id))
          .map((p) => p.id);
      } catch { continue; } // unreadable / not parseable — best-effort, never fail the check over a bystander file
      if (!ids.length) continue;
      const rel = relative(projectRoot, path);
      const shown = ids.length > 4 ? `${ids.slice(0, 4).join(', ')}, …` : ids.join(', ');
      findings.push({
        code: 'unregistered_document_sibling', severity: 'warning',
        message: `${rel} sits beside registered document source(s) and holds ${ids.length} issue(s) in document grammar (${shown}) but is NOT a registered source — the tracker cannot see them.`,
        fix: `Register it: \`ztrack import ${rel} --register\` — or move the file elsewhere if it is intentionally not tracked.`,
        origin: { path },
      });
    }
  }
  return findings;
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
