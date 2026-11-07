// The Jira sync provider (company RFC 0026 decision 2): a ticket is an arc, statuses mapped by the project's table,
// comments paged in full. Standalone like sync/github, over the Jira twin (@volter/twin-jira) as its engine.
//
//   ztrack issues  <--map-->  jira tickets  <--twin fold/morph/egress-->  the Jira site
export { syncJira, type JiraSyncOpts, type JiraSyncResult } from './sync.ts';
export { resolveJiraExecute } from './execute.ts';
export { DEFAULT_STATUSES, boardToJiraStatus, jiraToBoardStatus, type StatusTable } from './map.ts';
export { linkedJira, syncLinkedJira } from './linked.ts';
