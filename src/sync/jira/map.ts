// Jira statuses <-> board statuses, by the project's table (`sync.statuses` in tracker-config: Jira status name ->
// ztrack status). Unlike GitHub's open/closed, a Jira workflow names every state, so the whole lifecycle round-trips
// where the table maps it. A Jira status the table does not name keeps the board's status as it is; a board status
// the table does not name is not pushed (the ticket keeps its status).
export type StatusTable = Record<string, string>;

/** A typical Jira Software workflow onto the kanban preset's statuses. */
export const DEFAULT_STATUSES: StatusTable = { Backlog: 'draft', 'To Do': 'ready', 'Selected for Development': 'ready', 'In Progress': 'in-progress', 'In Review': 'in-review', Done: 'done' };

/** Jira status -> board status (the table's, matched case-insensitively), or the board's own when unmapped. */
export function jiraToBoardStatus(table: StatusTable, jiraStatus: string | undefined, existing?: string): string {
  const hit = Object.entries(table).find(([name]) => name.toLowerCase() === String(jiraStatus ?? '').toLowerCase());
  return hit ? hit[1] : existing ?? 'draft';
}

/** Board status -> the Jira status it goes to: the table's first name mapping to it. Undefined when none does. */
export function boardToJiraStatus(table: StatusTable, status: string): string | undefined {
  return Object.entries(table).find(([, board]) => board === status)?.[0];
}

/** Whether a ticket in `jiraStatus` already stands for `status` on the board (several Jira statuses may map to one). */
export function sameStatus(table: StatusTable, jiraStatus: string | undefined, status: string): boolean {
  return jiraToBoardStatus(table, jiraStatus, undefined) === status;
}
