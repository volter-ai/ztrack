#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const r = spawnSync('node', ["profiles/simple-sdlc/scripts/run-agent.mjs"], { stdio: 'inherit', env: { ...process.env, AUTONOMY_AGENT: "pm" } });
process.exit(r.status == null ? 1 : r.status);
