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
    if (!title) return { data: { issueCreate: { success: false, issue: null } } };
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
    const identifier = out.split(/\s+/)[0]!;
    const issue = normalizeIssue(await commandJson(backend, ['issue', 'view', identifier, '--comments', '--json']));
    return { data: { issueCreate: { success: Boolean(issue), issue } } };
  }

  if (/\bcommentCreate\b/.test(query)) {
    const data = inputBlock(query, 'commentCreate');
    const issue = argString(data, 'issueId') ?? argString(data, 'issue');
    const body = argString(data, 'body');
    if (!issue || !body) return { data: { commentCreate: { success: false, comment: null } } };
    await backend.command(['issue', 'comment', issue, '--body', body]);
    return { data: { commentCreate: { success: true, comment: { body } } } };
  }

  if (/\bsnapshot\b/.test(query)) {
    return { data: { snapshot: await commandJson(backend, ['snapshot', 'project-manager', '--format', 'json']) } };
  }

  const issueArgs = findCall(query, 'issue');
  if (issueArgs) {
    const id = argString(issueArgs, 'id') ?? argString(issueArgs, 'identifier');
    const issue = id ? normalizeIssue(await commandJson(backend, ['issue', 'view', id, '--comments', '--json'])) : null;
    return { data: { issue } };
  }

  const issuesArgs = findCall(query, 'issues');
  if (issuesArgs) {
    const firstArg = argInt(issuesArgs, 'first', 0);
    const args = ['issue', 'list', ...(firstArg > 0 ? ['--limit', String(firstArg)] : []), '--json', 'id,identifier,number,title,body,description,state,stateType,createdAt,updatedAt,project,parent,labels,url,priority'];
    const state = argString(issuesArgs, 'state');
    const text = argString(issuesArgs, 'text');
    if (state) args.push('--state', state);
    if (text) args.push('--search', text);
    for (const label of labelsFromFilter(issuesArgs)) args.push('--label', label);
    const issues = await commandJson(backend, args);
    const nodes = Array.isArray(issues) ? issues.map(normalizeIssue).filter(Boolean) : [];
    return { data: { issues: { nodes } } };
  }

  const projectsArgs = findCall(query, 'projects');
  if (projectsArgs) {
    const projects = await commandJson(backend, ['project', 'list', '--json', 'id,name,status,state,progress,targetDate']);
    return { data: { projects: { nodes: Array.isArray(projects) ? projects.slice(0, argInt(projectsArgs, 'first', 50)) : [] } } };
  }

  return { errors: [{ message: 'Unsupported tracker GraphQL query root' }] };
}
