// A stateful fake GitHub at the RemoteExecute boundary, for the sync scenarios: the repository,
// its (empty) branches and pull requests, and its issues — listed, created and edited (through the
// API, or on GitHub itself with `ghEdit`). The issue
// LIST can lag behind a just-created issue for `lagCalls` calls, modeling GitHub's eventual
// consistency right after `gh issue create`.
import type { RemoteExecute } from '@volter/world-core';

export type GhIssue = { number: number; title: string; body: string; state: string; updated_at: string; created_at: string };

export function fakeGithub(opts: { owner?: string; repo?: string; lagCalls?: number } = {}) {
  const owner = opts.owner ?? 'o';
  const repo = opts.repo ?? 'r';
  const issues = new Map<number, GhIssue>();
  let next = 1;
  let clock = 0;
  let listCalls = 0;
  const ts = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString();
  const answer = (status: number, data?: unknown) => ({ status, headers: { 'content-type': 'application/json' }, body: data === undefined ? '' : JSON.stringify(data) });
  const issueJson = (i: GhIssue) => ({ ...i, id: 1000 + i.number, node_id: `I_${i.number}`, html_url: `https://github.com/${owner}/${repo}/issues/${i.number}`, user: { login: owner }, labels: [], assignees: [], comments: 0 });
  const execute: RemoteExecute = async ({ method, path, body }) => {
    const route = path.replace(/^\//, '').split('?')[0]!;
    const fields = typeof body === 'string' && body ? JSON.parse(body) as Record<string, unknown> : {};
    const base = `repos/${owner}/${repo}`;
    if (method === 'GET' && route === base) return answer(200, { id: 1, name: repo, full_name: `${owner}/${repo}`, owner: { login: owner }, default_branch: 'main', private: false, html_url: `https://github.com/${owner}/${repo}` });
    if (method === 'GET' && route === `${base}/issues`) {
      listCalls += 1;
      return answer(200, listCalls <= (opts.lagCalls ?? 0) ? [] : [...issues.values()].map(issueJson));
    }
    if (method === 'GET') return answer(200, []);
    if (method === 'POST' && route === `${base}/issues`) {
      const n = next++;
      const at = ts();
      issues.set(n, { number: n, title: String(fields.title ?? ''), body: String(fields.body ?? ''), state: 'open', updated_at: at, created_at: at });
      return answer(201, issueJson(issues.get(n)!));
    }
    const edit = new RegExp(`^${base}/issues/(\\d+)$`).exec(route);
    if (method === 'PATCH' && edit) {
      const n = Number(edit[1]);
      const at = ts();
      const cur = issues.get(n) ?? { number: n, title: '', body: '', state: 'open', updated_at: at, created_at: at };
      issues.set(n, { ...cur, ...('title' in fields ? { title: String(fields.title) } : {}), ...('body' in fields ? { body: String(fields.body) } : {}), ...('state' in fields ? { state: String(fields.state) } : {}), updated_at: at });
      return answer(200, issueJson(issues.get(n)!));
    }
    throw new Error(`fakeGithub: unhandled ${method} ${path}`);
  };
  /** An edit made on GitHub itself (someone else's change), as the sync will observe it. */
  const ghEdit = (n: number, fields: Partial<Pick<GhIssue, 'title' | 'body' | 'state'>>) => {
    const cur = issues.get(n);
    if (cur) issues.set(n, { ...cur, ...fields, updated_at: ts() });
  };
  return { execute, issues, ghEdit, listCalls: () => listCalls };
}
