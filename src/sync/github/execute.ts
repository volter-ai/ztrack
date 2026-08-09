// A `GithubExecute` for the github twin — auth is the gh CLI (or a GITHUB_TOKEN), never a
// prompted PAT. The twin's connector calls `request('GET /repos/{owner}/{repo}/issues',
// { owner, repo, state, per_page })` etc.; we map that to a real GitHub REST call. NOTE: the
// twin's bundled `liveGithubExecute` DROPS non-path params on GET (they go to an unsent body),
// so `state=all`/pagination never reach GitHub — `tokenExecute` below fixes that (GET params
// become a query string; writes send a JSON body).
import { spawnSync } from 'node:child_process';
import type { GithubExecute } from '@volter/twin-github';

// Split a twin route+params into {method, path (templates substituted), rest params}.
export function splitRoute(route: string, params: Record<string, unknown>): { method: string; path: string; rest: Array<[string, unknown]> } {
  const sp = route.indexOf(' ');
  const method = route.slice(0, sp).toUpperCase();
  let path = route.slice(sp + 1).replace(/^\//, '');
  const rest: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(params)) {
    const tok = `{${k}}`;
    if (path.includes(tok)) path = path.replace(tok, encodeURIComponent(String(v)));
    else rest.push([k, v]);
  }
  return { method, path, rest };
}
const isRead = (method: string) => method === 'GET' || method === 'HEAD';
const queryString = (rest: Array<[string, unknown]>) => rest.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');

export type GhRun = (args: string[], input?: string) => { status: number | null; stdout: string; stderr: string; error?: Error };
const defaultRun: GhRun = (args, input) => {
  const r = spawnSync('gh', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error } : {}) };
};

/** Build the `gh api` argv + body for one twin request. Exposed for unit tests. */
export function ghApiArgs(route: string, params: Record<string, unknown> = {}): { args: string[]; input?: string } {
  const { method, path, rest } = splitRoute(route, params);
  let p = path;
  if (isRead(method) && rest.length) p += (p.includes('?') ? '&' : '?') + queryString(rest);
  const args = ['api', '--include', '-X', method, p];
  if (!isRead(method) && rest.length) return { args: [...args, '--input', '-'], input: JSON.stringify(Object.fromEntries(rest)) };
  return { args };
}

/** Parse `gh api --include` output (status line + headers, blank line, body) into {status,data}. */
export function parseGhResponse(stdout: string, exitOk: boolean): { status: number; data: unknown } {
  const m = /^HTTP\/[\d.]+ (\d+)/m.exec(stdout);
  const status = m ? Number(m[1]) : exitOk ? 200 : 500;
  const bodyText = stdout.replace(/^[\s\S]*?\r?\n\r?\n/, '');
  let data: unknown;
  try { data = bodyText.trim() ? JSON.parse(bodyText) : undefined; } catch { data = undefined; }
  return { status, data };
}

/** A token-backed (fetch) GithubExecute that correctly puts GET params in the query string. */
export function tokenExecute(token: string, baseUrl = 'https://api.github.com'): GithubExecute {
  return {
    async request(route, params = {}) {
      const { method, path, rest } = splitRoute(route, params);
      let url = `${baseUrl}/${path}`;
      if (isRead(method) && rest.length) url += (url.includes('?') ? '&' : '?') + queryString(rest);
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        ...(isRead(method) || !rest.length ? {} : { body: JSON.stringify(Object.fromEntries(rest)) }),
      });
      return { status: res.status, data: res.status === 204 ? undefined : await res.json().catch(() => undefined) };
    },
  };
}

/** The gh-CLI-backed GithubExecute. `run` is injectable for tests. */
export function ghExecute(run: GhRun = defaultRun): GithubExecute {
  return {
    async request(route: string, params: Record<string, unknown> = {}) {
      const { args, input } = ghApiArgs(route, params);
      const r = run(args, input);
      if (r.error) throw new Error(`gh api ${route} failed to spawn: ${r.error.message} (is the gh CLI installed + 'gh auth login' done?)`);
      return parseGhResponse(r.stdout, r.status === 0);
    },
  };
}

/** Get a GitHub token without PROMPTING: an explicit env token, else the token the gh CLI is
 *  already authenticated with (`gh auth token`). Returns '' if neither exists. */
export function resolveGithubToken(): string {
  const env = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (env) return env;
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

/** The executor ztrack drives: PREFER a real token (env, else gh's own) via a correct fetch
 *  executor; fall back to shelling `gh api`. Never blocks — bad/missing auth surfaces as an
 *  HTTP 401 at request time, not a stop. */
export function resolveGithubExecute(): GithubExecute {
  const token = resolveGithubToken();
  return token ? tokenExecute(token) : ghExecute();
}
