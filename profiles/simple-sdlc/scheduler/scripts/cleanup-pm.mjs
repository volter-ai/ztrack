#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const cli = process.env.TERMFLEET_CLI || 'termfleet', url = process.env.TERMFLEET_PROVIDER_URL || 'http://127.0.0.1:7376';
const pmIdle = Number(process.env.ZTRACK_PM_IDLE_CLOSE_SECONDS || 180), workerIdle = Number(process.env.ZTRACK_WORKER_IDLE_CLOSE_SECONDS || 900);
const list = spawnSync(`${cli} list --url '${url}'`, { shell: true, encoding: 'utf8' });
if (list.status || !list.stdout.trim()) process.exit(0);
for (const p of JSON.parse(list.stdout)) {
  const limit = p.name === 'pm' ? pmIdle : p.name === 'develop' || p.name === 'review' ? workerIdle : Infinity;
  if (p.id && Number.isFinite(p.activity?.idleSeconds) && p.activity.idleSeconds >= limit) spawnSync(`${cli} close --url '${url}' --id ${p.id}`, { shell: true, stdio: 'inherit' });
}
