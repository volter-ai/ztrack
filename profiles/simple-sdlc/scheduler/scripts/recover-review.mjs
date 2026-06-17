#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const cli = process.env.TERMFLEET_CLI || 'termfleet', url = process.env.TERMFLEET_PROVIDER_URL || 'http://127.0.0.1:7376';
const list = spawnSync(`${cli} list --url '${url}'`, { shell: true, encoding: 'utf8' });
if (list.status || !list.stdout.trim()) process.exit(0);
if (JSON.parse(list.stdout).some((p) => p.name === 'ztrack-review' && p.agent !== 'no-agent')) process.exit(0);
const issues = spawnSync('ztrack issue list --state open --limit 100 --json identifier,state,labels', { shell: true, encoding: 'utf8' });
if (issues.status || !issues.stdout.trim()) process.exit(0);
for (const i of JSON.parse(issues.stdout)) if (i.state === 'In Review' && i.labels?.includes('ztrack:reviewing')) spawnSync(`ztrack issue edit ${i.identifier} --remove-label "ztrack:reviewing"`, { shell: true, stdio: 'inherit' });
