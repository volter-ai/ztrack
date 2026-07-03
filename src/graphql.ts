import type { TrackerBackend } from './types.ts';

function findCall(query: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*\\(`).exec(query);
  if (!match) return null;
  let depth = 1;
  let i = match.index + match[0].length;
  let inString = false;
  let escaped = false;
  const start = i;
  while (i < query.length) {
    const ch = query[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return query.slice(start, i);
    }
    i += 1;
  }
  return null;
}

function argString(args: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*:\\s*"((?:\\\\.|[^"])*)"`, 's').exec(args);
  return match ? JSON.parse(`"${match[1]}"`) as string : undefined;
}

function argInt(args: string, name: string, fallback: number): number {
  const match = new RegExp(`\\b${name}\\s*:\\s*(\\d+)`).exec(args);
  return match ? Number(match[1]) : fallback;
}

function argStringList(args: string, name: string): string[] {
  const match = new RegExp(`\\b${name}\\s*:\\s*\\[(.*?)\\]`, 's').exec(args);
  if (!match) return [];
  return [...match[1]!.matchAll(/"((?:\\.|[^"])*)"/g)].map((item) => JSON.parse(`"${item[1]}"`) as string);
}

function labelsFromFilter(args: string): string[] {
  const match = /\blabels\s*:\s*\{\s*includes\s*:\s*\[(.*?)\]/s.exec(args);
  if (!match) return [];
  return [...match[1]!.matchAll(/"((?:\\.|[^"])*)"/g)].map((item) => JSON.parse(`"${item[1]}"`) as string);
}

// ── selection-set filtering (ztrack issue #19: this executor used to return every field it
// happened to fetch, ignoring the query's `{ ... }` selection entirely — real GraphQL only
// returns what was asked for). This is a hand-rolled string scanner (not a real GraphQL AST),
// consistent with the rest of this file — but it does implement selection filtering recursively
// for nested fields/connections, which is the actually-requested behavior, not just a doc caveat.

// String-aware match of the CLOSING bracket for the OPENING bracket at `openIdx` (which must hold
// `openCh`). Shared by argument-paren skipping and selection-set brace extraction.
function matchBalanced(text: string, openIdx: number, openCh: string, closeCh: string): number {
  let depth = 1;
  let i = openIdx + 1;
  let inString = false;
  let escaped = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function skipWhitespaceAndCommas(text: string, i: number): number {
  let j = i;
  while (j < text.length && /[\s,]/.test(text[j]!)) j += 1;
  return j;
}

// Strip `# line comments` (GraphQL's only comment form), string-aware so a `#` inside a quoted
// argument value isn't treated as a comment start.
function stripComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '#') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue; }
    out += ch;
  }
  return out;
}

/** Locate the top-level occurrence of a root field `name` in `query` and return the raw text
 *  INSIDE its selection set (the `{ ... }` immediately following its optional `(...)` arguments) —
 *  or null if no selection set immediately follows (defensive fallback: callers then skip
 *  filtering and return every field, i.e. today's behavior, rather than guessing). */
function fieldSelectionRaw(query: string, name: string): string | null {
  const nameMatch = new RegExp(`\\b${name}\\b`).exec(query);
  if (!nameMatch) return null;
  let i = nameMatch.index + name.length;
  i = skipWhitespaceAndCommas(query, i);
  if (query[i] === '(') {
    const close = matchBalanced(query, i, '(', ')');
    if (close === -1) return null;
    i = skipWhitespaceAndCommas(query, close + 1);
  }
  if (query[i] === '@') return null; // a directive on the root field itself — bail to unfiltered fallback
  if (query[i] !== '{') return null;
  const close = matchBalanced(query, i, '{', '}');
  return close === -1 ? null : query.slice(i + 1, close);
}

interface SelectionField { responseKey: string; field: string; sub?: SelectionField[] }
type SelectionResult = { fields: SelectionField[] } | { error: string };

const NAME_RE = /^[_A-Za-z][_0-9A-Za-z]*/;

/** Parse the inside of a `{ ... }` selection set into a flat list of requested fields (with their
 *  own nested selections, recursively). NOT a full GraphQL parser: fragments (`...Name`, `... on
 *  Type`) and directives (`@include`/`@skip`) are DELIBERATELY unsupported — silently ignoring
 *  either would risk returning the wrong fields (a fragment's fields dropped entirely, or a
 *  conditional field always/never included), so this returns a clear error instead of guessing. */
function parseSelectionSet(raw: string): SelectionResult {
  const text = stripComments(raw);
  const fields: SelectionField[] = [];
  let i = 0;
  while (true) {
    i = skipWhitespaceAndCommas(text, i);
    if (i >= text.length) break;
    if (text.startsWith('...', i)) {
      return { error: 'ztrack GraphQL: fragments (`...`) are not supported by this executor' };
    }
    const m1 = NAME_RE.exec(text.slice(i));
    if (!m1) return { error: `ztrack GraphQL: could not parse selection set near "${text.slice(i, i + 20)}"` };
    let name1 = m1[0];
    i += name1.length;
    i = skipWhitespaceAndCommas(text, i);
    let responseKey = name1;
    let field = name1;
    if (text[i] === ':') {
      i = skipWhitespaceAndCommas(text, i + 1);
      const m2 = NAME_RE.exec(text.slice(i));
      if (!m2) return { error: `ztrack GraphQL: could not parse alias near "${text.slice(i, i + 20)}"` };
      field = m2[0];
      i += field.length;
      i = skipWhitespaceAndCommas(text, i);
    }
    if (text[i] === '(') {
      const close = matchBalanced(text, i, '(', ')');
      if (close === -1) return { error: `ztrack GraphQL: unbalanced arguments on field "${field}"` };
      i = skipWhitespaceAndCommas(text, close + 1);
    }
    if (text[i] === '@') {
      return { error: `ztrack GraphQL: directives (@...) are not supported (on field "${field}")` };
    }
    let sub: SelectionField[] | undefined;
    if (text[i] === '{') {
      const close = matchBalanced(text, i, '{', '}');
      if (close === -1) return { error: `ztrack GraphQL: unbalanced selection set on field "${field}"` };
      const nested = parseSelectionSet(text.slice(i + 1, close));
      if ('error' in nested) return nested;
      sub = nested.fields;
      i = close + 1;
    }
    fields.push({ responseKey, field, sub });
  }
  return { fields };
}

/** Filter a fetched value down to exactly the requested `fields` — recursively, and mapped over
 *  arrays (both plain arrays and the `{ nodes: [...] }` connection wrapper fall out of the same
 *  recursion: `nodes` is just a field whose value happens to be an array). A requested field that
 *  isn't present on the fetched value is simply omitted — this executor can't fabricate data it
 *  never fetched, independent of selection-set support. */
function applySelection(value: unknown, fields: SelectionField[]): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => applySelection(item, fields));
  if (typeof value !== 'object') return value; // a scalar selected with sub-fields — return as-is
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const { responseKey, field, sub } of fields) {
    if (!(field in obj)) continue;
    out[responseKey] = sub ? applySelection(obj[field], sub) : obj[field];
  }
  return out;
}

/** Apply query-supplied field selection to a root field's fetched `value`. Root-field ALIASING
 *  (e.g. `myIssues: issues { ... }`) is not specially handled — the response still comes back
 *  under the canonical key (`issues`), matching this executor's pre-existing hardcoded response
 *  shape; that's an existing limitation, not something this change regresses. */
function selectField(query: string, name: string, value: unknown): { value: unknown } | { error: string } {
  const raw = fieldSelectionRaw(query, name);
  if (raw === null) return { value }; // no selection set found — unfiltered fallback (defensive)
  const parsed = parseSelectionSet(raw);
  if ('error' in parsed) return { error: parsed.error };
  return { value: applySelection(value, parsed.fields) };
}

function selected(query: string, name: string, value: unknown): Record<string, unknown> {
  const result = selectField(query, name, value);
  return 'error' in result ? { errors: [{ message: result.error }] } : { data: { [name]: result.value } };
}

function inputBlock(query: string, name: string): string {
  const call = findCall(query, name) ?? '';
  const match = /\binput\s*:\s*\{/.exec(call);
  if (!match) return call;
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  // String-aware brace scan: a '}' inside a quoted value (e.g. a body containing '}')
  // must not close the input block early and silently drop the remaining fields.
  let inString = false;
  let escaped = false;
  while (i < call.length) {
    const ch = call[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return call.slice(start, i);
    }
    i += 1;
  }
  return call.slice(start);
}

// `issue create` stdout differs by backend (local: "<id>\t<title>"; markdown: JSON).
function identifierFromCreateOutput(stdout: string): string {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { identifier?: unknown }).identifier === 'string') {
      return (parsed as { identifier: string }).identifier;
    }
  } catch { /* not JSON — fall through */ }
  return trimmed.split(/\s+/)[0] ?? '';
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout || 'null');
}

function normalizeIssue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const issue = value as Record<string, unknown>;
  const identifier = String(issue.identifier ?? issue.number ?? '');
  if (!identifier) return null;
  const rawLabels = issue.labels;
  const labels = Array.isArray(rawLabels)
    ? rawLabels.map((label) => typeof label === 'object' && label ? label : { name: String(label) })
    : (rawLabels && typeof rawLabels === 'object' && 'nodes' in rawLabels ? (rawLabels as { nodes?: unknown[] }).nodes ?? [] : []);
  const state = issue.state && typeof issue.state === 'object'
    ? issue.state
    : { name: issue.state, type: issue.stateType };
  const parent = typeof issue.parent === 'string'
    ? { id: issue.parent, identifier: issue.parent }
    : issue.parent;
  const project = typeof issue.project === 'string'
    ? { id: issue.project, name: issue.project }
    : issue.project;
  return {
    ...issue,
    id: issue.id ?? identifier,
    identifier,
    number: identifier,
    body: issue.body ?? issue.description,
    description: issue.description ?? issue.body,
    state,
    stateType: issue.stateType ?? (state as Record<string, unknown>).type,
    parent,
    project,
    labels: { nodes: labels },
    comments: issue.comments && typeof issue.comments === 'object' && 'nodes' in issue.comments
      ? issue.comments
      : { nodes: Array.isArray(issue.comments) ? issue.comments : [] },
  };
}

async function commandJson(backend: TrackerBackend, args: string[]): Promise<unknown> {
  return parseJson((await backend.command(args)).stdout);
}

export async function executeTrackerGraphql(
  backend: TrackerBackend,
  query: string,
  _variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (backend.name === 'local') {
    return parseJson((await backend.command(['api', 'query', '--query', query])).stdout) as Record<string, unknown>;
  }

  if (/\bissueCreate\b/.test(query)) {
    const data = inputBlock(query, 'issueCreate');
    const title = argString(data, 'title');
    if (!title) return selected(query, 'issueCreate', { success: false, issue: null });
    const args = ['issue', 'create', '--title', title];
    const body = argString(data, 'body') ?? argString(data, 'description');
    const state = argString(data, 'state');
    const parent = argString(data, 'parent');
    const project = argString(data, 'project');
    const labels = labelsFromFilter(data).concat(argStringList(data, 'labels'));
    if (body) args.push('--body', body);
    if (state) args.push('--state', state);
    if (parent) args.push('--parent', parent);
    if (project) args.push('--project', project);
    for (const label of labels) args.push('--label', label);
    const out = (await backend.command(args)).stdout.trim();
    const identifier = identifierFromCreateOutput(out);
    const issue = normalizeIssue(await commandJson(backend, ['issue', 'view', identifier, '--comments', '--json']));
    return selected(query, 'issueCreate', { success: Boolean(issue), issue });
  }

  if (/\bcommentCreate\b/.test(query)) {
    const data = inputBlock(query, 'commentCreate');
    const issue = argString(data, 'issueId') ?? argString(data, 'issue');
    const body = argString(data, 'body');
    if (!issue || !body) return selected(query, 'commentCreate', { success: false, comment: null });
    await backend.command(['issue', 'comment', issue, '--body', body]);
    return selected(query, 'commentCreate', { success: true, comment: { body } });
  }

  if (/\bsnapshot\b/.test(query)) {
    return selected(query, 'snapshot', await commandJson(backend, ['snapshot', 'project-manager', '--format', 'json']));
  }

  // Routing only needs to know a root field NAME was mentioned — arguments are optional in real
  // GraphQL (`{ issues { nodes { title } } }` is valid with no `(...)` at all), so this no longer
  // requires `findCall` (which needs a paren) to even recognize the query's root field.
  if (/\bissue\b/.test(query)) {
    const issueArgs = findCall(query, 'issue') ?? '';
    const id = argString(issueArgs, 'id') ?? argString(issueArgs, 'identifier');
    const issue = id ? normalizeIssue(await commandJson(backend, ['issue', 'view', id, '--comments', '--json'])) : null;
    return selected(query, 'issue', issue);
  }

  if (/\bissues\b/.test(query)) {
    const issuesArgs = findCall(query, 'issues') ?? '';
    const firstArg = argInt(issuesArgs, 'first', 0);
    const args = ['issue', 'list', ...(firstArg > 0 ? ['--limit', String(firstArg)] : []), '--json', 'id,identifier,number,title,body,description,state,stateType,createdAt,updatedAt,project,parent,labels,url,priority'];
    const state = argString(issuesArgs, 'state');
    const text = argString(issuesArgs, 'text');
    if (state) args.push('--state', state);
    if (text) args.push('--search', text);
    for (const label of labelsFromFilter(issuesArgs)) args.push('--label', label);
    const issues = await commandJson(backend, args);
    const nodes = Array.isArray(issues) ? issues.map(normalizeIssue).filter(Boolean) : [];
    return selected(query, 'issues', { nodes });
  }

  if (/\bprojects\b/.test(query)) {
    const projectsArgs = findCall(query, 'projects') ?? '';
    const projects = await commandJson(backend, ['project', 'list', '--json', 'id,name,status,state,progress,targetDate']);
    return selected(query, 'projects', { nodes: Array.isArray(projects) ? projects.slice(0, argInt(projectsArgs, 'first', 50)) : [] });
  }

  return { errors: [{ message: 'Unsupported tracker GraphQL query root' }] };
}
