// The transport `ztrack sync jira` reaches a Jira site over: a `RemoteExecute` (one REST request in, the vendor's
// status, headers and body out), which the Jira twin's pull (`syncJiraFromRemote`) and the kernel's push
// (`performEntries`) both drive. Auth is the site's API token from the environment, never a prompt:
// JIRA_EMAIL + JIRA_API_TOKEN (Jira Cloud's basic auth), or JIRA_TOKEN as a bearer (a personal access token, or a
// twin's). A twin's site URL works the same, so a rehearsal syncs against the Jira twin with no change.
import type { RemoteExecute } from '@volter/world-core';

export function resolveJiraExecute(site: string, env: Record<string, string | undefined> = process.env): RemoteExecute {
  const base = site.replace(/\/+$/, '');
  const authorization = env.JIRA_EMAIL && env.JIRA_API_TOKEN
    ? `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}`
    : env.JIRA_TOKEN ? `Bearer ${env.JIRA_TOKEN}` : undefined;
  if (!authorization) throw new Error('ztrack sync jira: no credential. Set JIRA_EMAIL and JIRA_API_TOKEN (Jira Cloud), or JIRA_TOKEN.');
  return async (request) => {
    const body = request.body === undefined ? undefined : typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body);
    const res = await fetch(`${base}${request.path.startsWith('/') ? '' : '/'}${request.path}`, {
      method: request.method.toUpperCase(),
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(request.headers ?? {}), authorization },
      ...(body === undefined ? {} : { body }),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => { headers[name] = value; });
    return { status: res.status, headers, body: await res.text() };
  };
}
