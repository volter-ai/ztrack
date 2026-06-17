#!/usr/bin/env bun
// The speckit PM cycle — the manager loop for the Spec Kit SDLC, analogous to
// boilerplates/core-sdlc/pm-cycle.ts. It reads each feature's derived stage (from
// the speckit preset) and dispatches the matching Spec Kit skill through your
// agent runner to
// push it forward, then waits for the stage to advance and repeats. You only add
// feature requests to .specify/backlog.json; the cycle drives the rest:
//
//   (no constitution) -> /speckit-constitution
//   (backlog request, no spec) -> /speckit-specify
//   specifying  -> /speckit-clarify     (resolve [NEEDS CLARIFICATION])
//   planning    -> /speckit-plan
//   tasking     -> /speckit-tasks
//   in-progress -> /speckit-implement   (+ our verification: cite commits)
//   done        -> nothing
//
//   AGENT_LAUNCHER_CLI=<launcher> bun pm-cycle.ts --repo <speckitProject> [--launcher-url <url>] [--max-min 20]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSpeckit, buildSpeckitBundle } from '../../src/presets/speckitCore.ts';
import { gitWorld } from '../../src/core/gitWorld.ts';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
const REPO = flag('repo', process.cwd())!;
const URL = flag('launcher-url', flag('url', ''))!;
const MAX_MS = Number(flag('max-min', '20')) * 60_000;
// Path to your agent launcher CLI. It must support:
//   <launcher> claude new -y --name <name> --cwd <repo> --prompt-file <file> [--url <url>]
const AGENT_LAUNCHER_CLI = process.env.AGENT_LAUNCHER_CLI;
if (!AGENT_LAUNCHER_CLI) throw new Error('Set AGENT_LAUNCHER_CLI to your agent launcher command before running this boilerplate.');

function log(m: string) { console.log(`[speckit-pm ${new Date().toISOString().slice(11, 19)}] ${m}`); }

// ── read state ───────────────────────────────────────────────────────────────
function constitutionOk(): boolean {
  const p = join(REPO, '.specify', 'memory', 'constitution.md');
  if (!existsSync(p)) return false;
  const c = readFileSync(p, 'utf8');
  return /##\s*Core Principles/i.test(c) && /^###\s+/m.test(c) && !/\[PRINCIPLE/i.test(c) && !/\[PROJECT/i.test(c);
}
function featureFiles(slug: string): Array<{ path: string; content: string }> {
  const dir = join(REPO, 'specs', slug); const files: Array<{ path: string; content: string }> = [];
  const walk = (abs: string, rel: string) => { for (const e of readdirSync(abs, { withFileTypes: true })) { const a = join(abs, e.name), r = `${rel}/${e.name}`; if (e.isDirectory()) walk(a, r); else files.push({ path: r, content: readFileSync(a, 'utf8') }); } };
  walk(dir, `specs/${slug}`);
  const con = join(REPO, '.specify', 'memory', 'constitution.md');
  if (existsSync(con)) files.push({ path: '.specify/memory/constitution.md', content: readFileSync(con, 'utf8') });
  return files;
}
interface Feature { slug: string; status: string }
function readFeatures(): Feature[] {
  const specsDir = join(REPO, 'specs'); if (!existsSync(specsDir)) return [];
  const out: Feature[] = [];
  for (const slug of readdirSync(specsDir).sort()) {
    const dir = join(specsDir, slug);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    const files = featureFiles(slug);
    if (!files.some((f) => /spec\.md$/.test(f.path))) continue;
    const r = checkSpeckit(buildSpeckitBundle(files), gitWorld(REPO, []));
    const issue = r.export?.issues[0];
    if (issue) out.push({ slug, status: issue.status });
  }
  return out;
}
function readBacklog(): Array<{ description: string }> {
  const p = join(REPO, '.specify', 'backlog.json');
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return []; }
}

// ── dispatch a Spec Kit skill through the configured agent launcher ──────────
function launch(...a: string[]): string {
  return execFileSync(AGENT_LAUNCHER_CLI!, [...a, ...(URL ? ['--url', URL] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function dispatch(label: string, prompt: string): string {
  const f = `/tmp/speckit-pm-${label}.prompt.md`; writeFileSync(f, prompt);
  // The launch can return a "ready" timeout while the session is actually created
  // (the launcher is busy). That's fine - we poll for the stage to advance, not for
  // the launch's return — so never let a launch-timeout kill the loop.
  try {
    const out = launch('claude', 'new', '-y', '--create-timeout-ms', '180000', '--name', label, '--cwd', REPO, '--prompt-file', f);
    return /"terminalId":\s*"([^"]+)"/.exec(out)?.[1] ?? '(launched)';
  } catch (e) {
    log(`  (launch returned an error: ${String((e as Error)?.message ?? e).split('\n')[0]!.slice(0, 70)} — terminal likely created; polling)`);
    return '(launch-timeout)';
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(desc: string, predicate: () => boolean, maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(12_000);
    if (predicate()) return true;
    log(`  …waiting for ${desc} (${Math.round((Date.now() - start) / 1000)}s)`);
  }
  return false;
}

const PLAN_TECH = 'a single static index.html plus app.js, vanilla JavaScript (ES2022), no dependencies, no build step';
function skillPrompt(skill: string, slug: string): string {
  const base = `You are running ONE step of the GitHub Spec Kit workflow in this repo (the /speckit-* skills are installed). Work autonomously; make reasonable choices; do NOT ask questions.`;
  if (skill === 'clarify') return `${base}\n\nUse the **speckit-clarify** skill for the feature in specs/${slug}/ and resolve every [NEEDS CLARIFICATION] marker with a concrete decision recorded in the spec. Then stop. Print OUTCOME: clarified.`;
  if (skill === 'plan') return `${base}\n\nUse the **speckit-plan** skill for specs/${slug}/. Technical context: ${PLAN_TECH}. Make sure the Constitution Check section is filled and passes. Then stop. Print OUTCOME: planned.`;
  if (skill === 'tasks') return `${base}\n\nUse the **speckit-tasks** skill for specs/${slug}/ to generate the phased task list (Setup / Foundational / per-User-Story / Polish). Then stop. Print OUTCOME: tasked.`;
  if (skill === 'implement') return `${base}\n\nUse the **speckit-implement** skill for specs/${slug}/: write real, working code (index.html + app.js) that satisfies every user story, and commit it with git. Then — for our tracker's VERIFICATION layer (an extension beyond stock Spec Kit) — make sure every completed task is checked [x] in specs/${slug}/tasks.md AND append the implementing commit to each completed task line as " (commit: <short-sha>)" using real shas from \`git log --oneline\`; commit that change. Then stop. Print OUTCOME: implemented.`;
  return base;
}

async function main() {
  log(`speckit PM cycle on ${REPO}${URL ? ` via ${URL}` : ''}`);
  let n = 0;
  while (true) {
    n += 1;
    if (!constitutionOk()) {
      log(`tick ${n}: no constitution -> /speckit-constitution`);
      const s = dispatch('speckit-constitution', `You are running ONE step of GitHub Spec Kit in this repo. Use the **speckit-constitution** skill to write this project's constitution: a few concrete Core Principles (e.g. simplicity, verifiable completion, accessibility) under "## Core Principles" as "### " headings, plus a "## Governance" section. Replace ALL template placeholders. Work autonomously; do not ask questions. Print OUTCOME: constitution.`);
      log(`  launched in ${s}`);
      if (!await waitFor('constitution to be written', constitutionOk, MAX_MS)) { log('STUCK on constitution'); break; }
      log('✓ constitution ready'); continue;
    }
    const features = readFeatures();
    const pending = features.find((f) => f.status !== 'done');
    if (pending) {
      const skill = ({ specifying: 'clarify', planning: 'plan', tasking: 'tasks', 'in-progress': 'implement' } as Record<string, string>)[pending.status];
      if (!skill) { log(`feature ${pending.slug} is ${pending.status} — no skill mapped; stopping`); break; }
      const expected = ({ clarify: (f: Feature) => f.status !== 'specifying', plan: (f: Feature) => f.status === 'tasking', tasks: (f: Feature) => f.status === 'in-progress', implement: (f: Feature) => f.status === 'done' } as Record<string, (f: Feature) => boolean>)[skill]!;
      log(`tick ${n}: feature ${pending.slug} is ${pending.status} -> /speckit-${skill}`);
      const s = dispatch(`speckit-${skill}-${pending.slug}`, skillPrompt(skill, pending.slug));
      log(`  launched /speckit-${skill} in ${s}`);
      const ok = await waitFor(`${pending.slug} to advance past ${pending.status}`, () => { const f = readFeatures().find((x) => x.slug === pending.slug); return !!f && expected(f); }, MAX_MS);
      if (!ok) { log(`STUCK: ${pending.slug} did not advance from ${pending.status}`); break; }
      log(`✓ ${pending.slug} advanced`); continue;
    }
    const backlog = readBacklog();
    if (features.length < backlog.length) {
      const req = backlog[features.length]!;
      log(`tick ${n}: backlog request -> /speckit-specify: "${req.description.slice(0, 60)}…"`);
      const before = features.length;
      const s = dispatch('speckit-specify', `You are running ONE step of GitHub Spec Kit in this repo. Use the **speckit-specify** skill to create a specification for: ${req.description}\n\nProduce user stories with priorities (P1/P2) and Given/When/Then acceptance scenarios, functional requirements (FR-###), measurable success criteria (SC-###), and key entities. Work autonomously; make reasonable choices; do not ask questions. Print OUTCOME: specified.`);
      log(`  launched /speckit-specify in ${s}`);
      if (!await waitFor('a new spec to appear', () => readFeatures().length > before, MAX_MS)) { log('STUCK on specify'); break; }
      log('✓ new feature specified'); continue;
    }
    log(`idle — nothing to do. features: ${features.map((f) => `${f.slug}:${f.status}`).join(', ') || '(none)'}`);
    break;
  }
  log('cycle complete');
}

void main();
