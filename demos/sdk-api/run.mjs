#!/usr/bin/env node
import { createTrackerClient } from 'ztrack';

const client = createTrackerClient();

const body = `# SDK API dry run

## Acceptance Criteria

- [ ] dev/01 status: pending Create and read an issue through the SDK.

## Evidence
`;

const created = await client.issue.create({
  title: 'SDK API dry run',
  body,
  state: 'In Progress',
  assignee: 'sdk-demo',
  labels: ['type:case'],
});

const identifier = String(created.identifier ?? '');
if (!identifier) {
  throw new Error('SDK issue create did not return an identifier');
}

const viewed = await client.issue.view(identifier, { json: 'identifier,title,state,labels,body' });
const list = await client.issue.list({ label: 'type:case', limit: 10, json: 'identifier,title,state' });

console.log(JSON.stringify({
  created: identifier,
  title: viewed.title,
  listed: Array.isArray(list) ? list.length : 0,
}, null, 2));
