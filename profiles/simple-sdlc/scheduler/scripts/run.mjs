#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2), i = args.indexOf('--schedule');
const schedule = JSON.parse(readFileSync(i >= 0 ? args[i + 1] : 'profiles/simple-sdlc/scheduler/schedule.json', 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
do { for (const command of schedule.scripts) {
  spawnSync(command, { shell: true, stdio: 'inherit', env: { ...schedule.env, ...process.env } });
} if (args.includes('--once')) break; else await sleep(Number(schedule.intervalSeconds) * 1000); } while (true);
