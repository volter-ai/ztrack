// Markdown backend (de)serialization — the core of the `markdown` backend, the
// tracker's only store. An issue is stored as one `tracker/<id>.md`: YAML-ish
// frontmatter (flat canonical metadata, JSON-encoded values for lossless round-trip),
// the issue body verbatim, then comments in a trailing `<!--tracker:comments … -->`
// HTML block (invisible to the preset parser, machine-readable here). Serialize and
// parse are inverses by construction (proven by `roundTripDiff`).

// ── canonical issue (the backend-agnostic, source-of-truth shape) ────────────
export interface CanonicalComment { user: string; createdAt: string; body: string }
export interface CanonicalIssue {
  identifier: string;
  title: string;
  body: string;
  state: string;          // state.name (display)
  stateType: string;      // open | completed | canceled
  assignees: string[];
  labels: string[];
  project: string | null;
  parent: string | null;
  children: string[];
  branchName: string;
  priority: number;
  devProgress: string | null;   // local distinguishes null from "" — preserved exactly
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  url: string;
  comments: CanonicalComment[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nodeNames = (v: unknown): string[] => (v && typeof v === 'object' && Array.isArray((v as { nodes?: unknown[] }).nodes) ? (v as { nodes: Array<Record<string, unknown>> }).nodes.map((n) => str(n.name) || str(n.identifier) || str(n.id)).filter(Boolean) : []);
const refOf = (v: unknown): string | null => { if (!v) return null; if (typeof v === 'string') return v; const o = v as Record<string, unknown>; return str(o.identifier) || str(o.id) || str(o.name) || null; };

/** Normalize a raw `tracker issue view --comments --json` object into the canonical shape. */
export function canonicalize(raw: Record<string, unknown>): CanonicalIssue {
  const state = raw.state as { name?: string; type?: string } | undefined;
  const assignees = nodeNames(raw.assignees);
  return {
    identifier: str(raw.identifier) || str(raw.id),
    title: str(raw.title),
    body: str(raw.body) || str(raw.description),
    state: str(state?.name) || (typeof raw.state === 'string' ? str(raw.state) : ''),
    stateType: str(raw.stateType) || str(state?.type),
    assignees: assignees.length ? assignees : (raw.assignee ? [str((raw.assignee as { name?: string }).name)].filter(Boolean) : []),
    labels: nodeNames(raw.labels),
    project: refOf(raw.project),
    parent: refOf(raw.parent),
    children: nodeNames(raw.children),
    branchName: str(raw.branchName),
    priority: typeof raw.priority === 'number' ? raw.priority : 0,
    devProgress: raw.devProgress == null ? null : str(raw.devProgress),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
    completedAt: raw.completedAt == null ? null : str(raw.completedAt),
    canceledAt: raw.canceledAt == null ? null : str(raw.canceledAt),
    url: str(raw.url),
    comments: (raw.comments && typeof raw.comments === 'object' && Array.isArray((raw.comments as { nodes?: unknown[] }).nodes)
      ? (raw.comments as { nodes: Array<Record<string, unknown>> }).nodes
      : []).map((c) => ({ user: str((c.user as { name?: string } | undefined)?.name), createdAt: str(c.createdAt), body: str(c.body) })),
  };
}

// ── serialize: canonical → markdown ──────────────────────────────────────────
const COMMENTS_MARKER = '<!--tracker:comments';
// frontmatter values are JSON-encoded so any content (colons, quotes, newlines-as-\n)
// round-trips exactly; null/empty optional fields are omitted (absent == default).
function fmLine(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === 'string' && value === '') return null;
  return `${key}: ${JSON.stringify(value)}`;
}
export function serializeIssue(c: CanonicalIssue): string {
  const fm = [
    fmLine('identifier', c.identifier), fmLine('title', c.title), fmLine('state', c.state), fmLine('stateType', c.stateType),
    fmLine('assignees', c.assignees), fmLine('labels', c.labels), fmLine('project', c.project), fmLine('parent', c.parent),
    fmLine('children', c.children), fmLine('branchName', c.branchName), fmLine('priority', c.priority),
    `devProgress: ${JSON.stringify(c.devProgress)}`, // always written (null and "" are distinct, both preserved)
    fmLine('createdAt', c.createdAt), fmLine('updatedAt', c.updatedAt), fmLine('completedAt', c.completedAt), fmLine('canceledAt', c.canceledAt),
    fmLine('url', c.url),
  ].filter((l): l is string => l !== null).join('\n');
  return `---\n${fm}\n---\n${c.body}\n${COMMENTS_MARKER}\n${JSON.stringify(c.comments)}\n-->\n`;
}

// ── parse: markdown → canonical (inverse of serialize) ───────────────────────
export function parseIssue(md: string): CanonicalIssue {
  const fmM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md);
  const fm: Record<string, unknown> = {};
  if (fmM) for (const raw of fmM[1]!.split('\n')) { const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(raw); if (m) { try { fm[m[1]!] = JSON.parse(m[2]!); } catch { fm[m[1]!] = m[2]!; } } }
  const rest = fmM ? md.slice(fmM[0].length) : md;
  // The serializer always appends the comments block LAST, so split at the last marker
  // — a body that itself contains "<!--tracker:comments" then round-trips intact.
  const cIdx = rest.lastIndexOf(`\n${COMMENTS_MARKER}`);
  const body = cIdx >= 0 ? rest.slice(0, cIdx) : rest.replace(/\n$/, '');
  let comments: CanonicalComment[] = [];
  if (cIdx >= 0) { const cm = /<!--tracker:comments\r?\n([\s\S]*?)\r?\n-->/.exec(rest.slice(cIdx)); if (cm) { try { comments = JSON.parse(cm[1]!); } catch { comments = []; } } }
  const sA = (k: string): string => (typeof fm[k] === 'string' ? (fm[k] as string) : '');
  const arr = (k: string): string[] => (Array.isArray(fm[k]) ? (fm[k] as string[]) : []);
  return {
    identifier: sA('identifier'), title: sA('title'), body, state: sA('state'), stateType: sA('stateType'),
    assignees: arr('assignees'), labels: arr('labels'),
    project: (fm.project as string | null) ?? null, parent: (fm.parent as string | null) ?? null, children: arr('children'),
    branchName: sA('branchName'), priority: typeof fm.priority === 'number' ? fm.priority : 0,
    devProgress: 'devProgress' in fm ? (fm.devProgress as string | null) : null,
    createdAt: sA('createdAt'), updatedAt: sA('updatedAt'),
    completedAt: (fm.completedAt as string | null) ?? null, canceledAt: (fm.canceledAt as string | null) ?? null,
    url: sA('url'), comments,
  };
}

/** Fields where the serialized form must round-trip exactly. Returns the names that differ. */
export function roundTripDiff(c: CanonicalIssue): string[] {
  const back = parseIssue(serializeIssue(c));
  const keys = Object.keys(c) as (keyof CanonicalIssue)[];
  return keys.filter((k) => JSON.stringify(c[k]) !== JSON.stringify(back[k]));
}
