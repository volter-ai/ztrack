// docs/DIALECTS.md WP6 — materialize, the opt-in climb: convert a dialect LENS file to the
// native document-source grammar IN PLACE, so its issues stop being read-only. The transform is
// deliberately conservative and additive:
//   - ids already legal in the native heading grammar (`WS-A`, `TF-1001`) are kept VERBATIM —
//     ids belong to the repo; a hyphenless id (`KQ3`) gets the minimal normalization the grammar
//     needs (`KQ-3`), and every such rename is returned as an alias (old -> new) for the caller
//     to record on the source's config entry so old references keep resolving.
//   - statuses become `status:` header-block lines (the native per-section grammar,
//     documentWriteBack.ts); the file's own status markers (emoji bullets, checkbox glyphs the
//     heading transform doesn't touch) are LEFT IN PLACE as prose — this module never deletes a
//     line of user content, only rewrites boundaries and inserts grammar.
//   - a checkbox-item issue has no heading to rewrite, so it BECOMES a section: the item's lines
//     are replaced by a heading (one level under its containing section) + `status:` block +
//     the item's own description.
// Pure text -> text (LF space; the CLI owns CRLF restore), no I/O, no config knowledge — the
// config-entry upgrade lives in importDriver.ts beside the other `--register` planners.
import { parseWithDialect, type Dialect } from './dialects.ts';
import { parseMarkdownDocument } from './markdownDocument.ts';

// The native document grammar's id token, exactly as ID_HEADING_RE (documentParser.ts) captures
// it: alnum-hyphen with at least one interior hyphen before a trailing alnum run.
const NATIVE_HEADING_ID = /^[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9]+$/;

/** The native id for a dialect-parsed id: verbatim when already grammar-legal, else a hyphen
 *  inserted before the first digit run (`KQ3` -> `KQ-3`, `B3x` -> `B-3x`), else null (nothing
 *  the grammar could hold — the caller fails the whole file closed rather than inventing ids). */
export function nativeIdFor(id: string): string | null {
  if (NATIVE_HEADING_ID.test(id)) return id;
  const m = /^([A-Za-z][A-Za-z0-9]*?)(\d[A-Za-z0-9]*)$/.exec(id);
  return m ? `${m[1]}-${m[2]}` : null;
}

export interface MaterializedIssuePlan {
  nativeId: string;
  sourceId: string;
  status: string;
  statusExplicit: boolean;
  title: string;
}

export interface MaterializedLens {
  /** The rewritten file text (LF). */
  after: string;
  /** Only the ids that CHANGED: old file-native spelling -> new grammar-legal id. */
  aliases: Record<string, string>;
  issues: MaterializedIssuePlan[];
}

const HASHES_RE = /^(#{1,6})\s/;

/** `title` falls back to the id when a boundary carried no remainder (dialects.ts) — rendering
 *  that back would duplicate the id into the heading (`### KQ-3 — KQ3`), so treat it as absent. */
function headingFor(hashes: string, nativeId: string, sourceId: string, title: string): string {
  return title === sourceId ? `${hashes} ${nativeId}` : `${hashes} ${nativeId} — ${title}`;
}

/** Materialize one lens file's text. Throws (nothing partial, caller skips the file) when the
 *  lens sees no issues, an id can't be made grammar-legal, or two ids normalize to a collision. */
export function materializeDialectText(text: string, dialect: Dialect): MaterializedLens {
  const { issues } = parseWithDialect(text, dialect);
  if (issues.length === 0) throw new Error('the lens sees no issues in this file — nothing to materialize');

  const aliases: Record<string, string> = {};
  const taken = new Map<string, string>(); // nativeId -> sourceId that claimed it
  const plans: MaterializedIssuePlan[] = [];
  for (const issue of issues) {
    const nativeId = nativeIdFor(issue.id);
    if (!nativeId) throw new Error(`id ${issue.id} cannot be normalized to the native document grammar (needs a digit or an interior hyphen) — rename it in the file first`);
    const holder = taken.get(nativeId);
    if (holder) throw new Error(`ids ${holder} and ${issue.id} both normalize to ${nativeId} — rename one in the file first`);
    taken.set(nativeId, issue.id);
    if (nativeId !== issue.id) aliases[issue.id] = nativeId;
    plans.push({ nativeId, sourceId: issue.id, status: issue.status, statusExplicit: issue.statusExplicit, title: issue.title });
  }

  const lines = text.split('\n');
  const planOf = new Map(issues.map((issue, index) => [issue, plans[index]!]));

  if (dialect.issueBoundary === 'heading') {
    // Bottom-up so insertions never shift a not-yet-edited issue's line numbers.
    for (const issue of [...issues].sort((a, b) => b.lineStart - a.lineStart)) {
      const plan = planOf.get(issue)!;
      const headingIndex = issue.lineStart - 1;
      const hashes = HASHES_RE.exec(lines[headingIndex]!)?.[1] ?? '#'.repeat(2);
      lines[headingIndex] = headingFor(hashes, plan.nativeId, plan.sourceId, plan.title);
      if (!plan.statusExplicit) continue; // no claim in the file -> no claim in the grammar
      const insert = ['', `status: ${plan.status}`];
      if (lines[headingIndex + 1] !== '') insert.push(''); // header block needs its blank terminator
      lines.splice(headingIndex + 1, 0, ...insert);
    }
    return { after: lines.join('\n'), aliases, issues: plans };
  }

  // checkbox-item boundary: each item becomes its own section, one heading level under the
  // section that contains it (the native hierarchy the roster's flat shape maps into).
  const doc = parseMarkdownDocument(text);
  const containingLevel = (lineStart: number): number => {
    let level = 1;
    for (const section of doc.sections) {
      if (section.lineStart < lineStart && section.lineEnd >= lineStart) level = Math.max(level, section.level);
    }
    return Math.min(level + 1, 6);
  };
  for (const issue of [...issues].sort((a, b) => b.lineStart - a.lineStart)) {
    const plan = planOf.get(issue)!;
    const hashes = '#'.repeat(containingLevel(issue.lineStart));
    const body = issue.body.trim();
    const block = [
      headingFor(hashes, plan.nativeId, plan.sourceId, plan.title),
      '',
      `status: ${plan.status}`,
      '',
      ...(body ? [...body.split('\n'), ''] : []),
    ];
    let start = issue.lineStart - 1;
    let count = issue.lineEnd - issue.lineStart + 1;
    // Blank separation on both flanks — a heading glued to a surviving list line would be
    // swallowed into the list by some renderers, and the header block needs clean boundaries.
    if (start > 0 && lines[start - 1] !== '') block.unshift('');
    while (block[block.length - 1] === '' && lines[start + count] === '') block.pop(); // no double blank against an existing one
    lines.splice(start, count, ...block);
  }
  return { after: lines.join('\n'), aliases, issues: plans };
}
