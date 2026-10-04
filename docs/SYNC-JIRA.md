# `ztrack sync jira`: a Jira site's tickets as the board's arcs

Company RFC 0026 decision 2 ("jira is a ztrack sync right?"). The provider is `src/sync/jira/`, in the form of
`src/sync/github/`, over the Jira twin (`@volter/twin-jira`, an optional peer with `@volter/world-core`).

```sh
npm install -D @volter/world-core @volter/twin-jira
ztrack init --preset kanban --sync jira --site https://peak.atlassian.net --jql "project = PEAK ORDER BY created"
JIRA_EMAIL=… JIRA_API_TOKEN=… ztrack sync jira            # both ways; --pull or --push for one
```

- **Identity.** A ticket the JQL finds is an arc: with no arc, it becomes one. `.volter/sync/jira.json` keeps which
  arc is which ticket. A card with no ticket stays the board's: the client's Jira is never written a ticket it did not
  have, unless the link says `"create": true`.
- **Fields.** Summary ↔ title, description ↔ body (plain text; ADF on the wire), status ↔ status. Each field is
  merged three ways against the last synced base: a change on one side moves to the other, and a field changed on both
  sides is a conflict under the default `merge` policy, left as it is on both and reported (`hub-wins` and `twin-wins`
  choose a side).
- **Statuses** map by the link's `statuses` table, Jira status name → board status, for example
  `{ "To Do": "ready", "In Progress": "in-progress", "In Review": "in-review", "Done": "done" }` (the default adds
  `Backlog` → `draft`). A board status goes to the first Jira status mapped to it, through the transition the ticket's
  workflow offers to that status. A ticket already in a status that stands for the board's status is not moved. An
  unmapped Jira status leaves the board's status as it is.
- **Comments.** Every comment of a bound ticket is added to its arc once, with its author and time. Comments are paged
  past the page a search embeds, so a long thread is never cut (Peak's `board.py` rule).
- **Transport.** `JIRA_EMAIL` + `JIRA_API_TOKEN` (Jira Cloud's basic auth), or `JIRA_TOKEN` as a bearer. A Jira twin's
  URL as the site makes a rehearsal of the same sync, with no client system touched.
