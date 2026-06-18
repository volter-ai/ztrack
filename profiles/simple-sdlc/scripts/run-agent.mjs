#!/usr/bin/env node
// Bundle launch adapter (the ztrack domain seam): maps ztrack's dispatch vocabulary onto the
// domain-free autonomy runner. ZTRACK_AGENT -> which agent to launch; ZTRACK_ISSUE -> an opaque
// param the runner carries through verbatim and exports into the agent's shell (the develop/review
// skills read $ZTRACK_ISSUE). The runner itself knows nothing of "issue" or any ztrack concept.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const name = process.env.ZTRACK_AGENT;
if (!name) throw new Error('ZTRACK_AGENT required');
const issue = process.env.ZTRACK_ISSUE || '';

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, 'autonomy-runner.mjs');
// Per-agent skill prompts live next to this adapter, split by harness (codex uses `$skill`, claude
// uses `/skill`). Default the prompt dir absolutely so the runner resolves it regardless of cwd;
// it is re-exported to nested launches by the runner.
const harness = process.env.TERMFLEET_AGENT || 'codex';
const env = {
  ...process.env,
  AUTONOMY_PROMPT_DIR: process.env.AUTONOMY_PROMPT_DIR || join(here, 'prompts', harness),
};

const args = ['launch', name, ...(issue ? ['--ZTRACK_ISSUE', issue] : [])];
const timeout = Number(process.env.TERMFLEET_LAUNCH_TIMEOUT_MS || 45000);
const r = spawnSync('node', [runner, ...args], { stdio: 'inherit', timeout, env });
// A launch timeout is soft: a tick shouldn't hard-fail because the backend was slow to ack.
process.exit(r.error?.code === 'ETIMEDOUT' ? 0 : (r.status ?? 1));
