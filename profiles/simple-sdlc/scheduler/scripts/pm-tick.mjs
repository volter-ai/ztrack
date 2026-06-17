#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const result = spawnSync('node', ['profiles/simple-sdlc/scripts/run-agent.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, ZTRACK_AGENT: 'pm' },
});
process.exit(result.status ?? 1);
