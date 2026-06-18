#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const cli = process.env.TERMFLEET_CLI || 'termfleet', url = process.env.TERMFLEET_PROVIDER_URL || 'http://127.0.0.1:7376';
const list = spawnSync(`${cli} list --url '${url}'`, { shell: true, encoding: 'utf8' });
if (list.status || !list.stdout.trim()) process.exit(0);
if (JSON.parse(list.stdout).some((p) => p.name === 'ztrack-develop' && p.agent !== 'no-agent')) process.exit(0);
const dirty = spawnSync('git status --porcelain', { shell: true, encoding: 'utf8' }); if (dirty.status || dirty.stdout.trim()) process.exit(0);
const issues = spawnSync('npx ztrack issue list --state open --limit 100 --json identifier,state', { shell: true, encoding: 'utf8' });
if (issues.status || !issues.stdout.trim()) process.exit(0);
for (const i of JSON.parse(issues.stdout)) if (i.state === 'In Progress') spawnSync(`npx ztrack issue edit ${i.identifier} --state Ready`, { shell: true, stdio: 'inherit' });
