// The transport `ztrack sync github` reaches GitHub over: a `RemoteExecute` (one REST request in,
// the vendor's status, headers and body out), which the GitHub twin's pull
// (`syncGithubFromRemote`) and the kernel's push (`performEntries`) both drive. Auth is the gh CLI
// (or a GITHUB_TOKEN), never a prompted PAT.
import { spawnSync } from 'node:child_process';
import type { RemoteExecute, RemoteExecuteRequest, RemoteExecuteResponse } from '@volter/world-core';

export type GhRun = (args: string[], input?: string) => { status: number | null; stdout: string; stderr: string; error?: Error };
const defaultRun: GhRun = (args, input) => {
  const r = spawnSync('gh', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error } : {}) };
};

const bodyText = (body: RemoteExecuteRequest['body']): string | undefined =>
  body === undefined ? undefined : typeof body === 'string' ? body : new TextDecoder().decode(body);

/** Build the `gh api` argv (and stdin body) for one request. Exposed for unit tests. */
export function ghApiArgs(request: RemoteExecuteRequest): { args: string[]; input?: string } {
  const args = ['api', '--include', '-X', request.method.toUpperCase(), request.path.replace(/^\//, '')];
  for (const [name, value] of Object.entries(request.headers ?? {})) args.push('-H', `${name}: ${value}`);
  const input = bodyText(request.body);
  return input === undefined ? { args } : { args: [...args, '--input', '-'], input };
}

/** Parse `gh api --include` output (status line and headers, a blank line, the body). */
export function parseGhResponse(stdout: string, exitOk: boolean): RemoteExecuteResponse {
  const status = Number(/^HTTP\/[\d.]+ (\d+)/m.exec(stdout)?.[1] ?? (exitOk ? 200 : 500));
  const split = /\r?\n\r?\n/.exec(stdout);
  const head = split ? stdout.slice(0, split.index) : '';
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status, headers, body: split ? stdout.slice(split.index + split[0].length) : stdout };
}

/** A token-backed RemoteExecute: a fetch against the GitHub API. */
export function tokenExecute(token: string, baseUrl = 'https://api.github.com'): RemoteExecute {
  return async (request) => {
    const res = await fetch(`${baseUrl}/${request.path.replace(/^\//, '')}`, {
      method: request.method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'ztrack', 'content-type': 'application/json', ...request.headers },
      ...(request.body === undefined ? {} : { body: bodyText(request.body) }),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => { headers[name] = value; });
    return { status: res.status, headers, body: await res.text() };
  };
}

/** The gh-CLI-backed RemoteExecute. `run` is injectable for tests. */
export function ghExecute(run: GhRun = defaultRun): RemoteExecute {
  return async (request) => {
    const { args, input } = ghApiArgs(request);
    const r = run(args, input);
    if (r.error) throw new Error(`gh api ${request.method} ${request.path} failed to spawn: ${r.error.message} (is the gh CLI installed + 'gh auth login' done?)`);
    return parseGhResponse(r.stdout, r.status === 0);
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

/** The executor ztrack drives: PREFER a real token (env, else gh's own) via fetch; fall back to
 *  shelling `gh api`. Never blocks — bad/missing auth surfaces as an HTTP 401 at request time. */
export function resolveGithubExecute(): RemoteExecute {
  const token = resolveGithubToken();
  return token ? tokenExecute(token) : ghExecute();
}
