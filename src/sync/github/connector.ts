// The GitHub issue CONNECTOR — cursor-based incremental ingestion, the twin's native sync model
// (kernel `runConnectorPoll` + a persisted `since` cursor), replacing the snapshot fold ztrack
// used to call. Each poll asks GitHub for only the issues whose `updated_at` advanced past the
// cursor (`GET /issues?since=<cursor>&state=all&sort=updated`), pages through them, and hands
// each as a `ConnectorObservation`. The runner shadow-diffs (an unchanged re-observation appends
// nothing), advances the cursor to `max(updated_at) − 1ms`, and persists it under
// `.volter/github/cursors/<owner>-<repo>.json`. So: closed issues come through (state=all), the
// read is incremental (only what changed), and there is no shallow 30-item page.
//
// This is ztrack's standalone github provider using its OWN executor (which handles GET query
// params correctly, unlike the twin's bundled one); it is written to lift into
// `@volter-ai-dev/twin-github` verbatim — it would be the first real user of the poll framework.
import type { ConnectorObservation, WorldConnector } from '@volter-ai-dev/twin';
import type { GithubExecute } from '@volter-ai-dev/twin-github';

type Row = Record<string, unknown>;
const nameList = (v: unknown, key: 'login' | 'name'): string[] =>
  Array.isArray(v) ? v.map((e) => (e && typeof e === 'object' ? String((e as Record<string, unknown>)[key] ?? '') : '')).filter(Boolean) : [];

// Per-status error message: name the repo + the operation, then add the likely fix so a sync
// failure is actionable from the log line alone, not a bare "(HTTP 404)" that could be any repo.
function listIssuesFailedMessage(repository: string, page: number, status: number): string {
  const op = `list issues (page ${page}) for ${repository}`;
  if (status === 404) return `github connector: ${op} failed (HTTP 404) — the repo doesn't exist, is private, or the token can't see it; check the owner/repo spelling and the token's repo access`;
  if (status === 401 || status === 403) return `github connector: ${op} failed (HTTP ${status}) — the token is missing, expired, or lacks the scope to read issues on ${repository}; check the token's 'repo'/'issues' scope`;
  return `github connector: ${op} failed (HTTP ${status})`;
}

export function githubIssueConnector(execute: GithubExecute, owner: string, repo: string): WorldConnector {
  const repository = `${owner}/${repo}`;
  return {
    service: 'github',
    cursorFile: `${owner}-${repo}.json`,
    async fetchSince({ cursor, limit }) {
      const observations: ConnectorObservation[] = [];
      let truncated = false;
      for (let page = 1; !truncated; page++) {
        const params: Row = { owner, repo, state: 'all', sort: 'updated', direction: 'desc', per_page: 100, page };
        if (cursor) params.since = cursor;           // empty cursor = full bootstrap
        const res = await execute.request('GET /repos/{owner}/{repo}/issues', params);
        if (res.status >= 400) throw new Error(listIssuesFailedMessage(repository, page, res.status));
        const nodes = Array.isArray(res.data) ? (res.data as Row[]) : [];
        for (const n of nodes) {
          if (n.pull_request != null) continue;       // the issues endpoint also returns PRs — drop them
          const number = Number(n.number);
          const observed: Record<string, unknown> = { number, repository };
          if (n.title != null) observed.title = String(n.title);
          if (n.body != null) observed.body = String(n.body);
          if (n.state != null) observed.state = String(n.state);
          const assignees = nameList(n.assignees, 'login');
          if (assignees.length) observed.assignees = assignees;
          const labels = nameList(n.labels, 'name');
          if (labels.length) observed.labels = labels;
          observations.push({
            subject: { type: 'issue', id: `${repository}#issue:${number}` },
            observed,
            occurredAt: String(n.updated_at ?? n.created_at ?? ''),
            external: { provider: 'github', id: String(number), ...(n.html_url ? { url: String(n.html_url) } : {}) },
          });
          if (observations.length >= limit) { truncated = true; break; } // safety cap → runner holds the cursor
        }
        if (nodes.length < 100) break;                // last page
      }
      return { observations, truncated };
    },
  };
}
