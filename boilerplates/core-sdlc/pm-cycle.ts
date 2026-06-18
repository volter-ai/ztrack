#!/usr/bin/env bun
// The PM cycle — the runnable implementation of agents/pm.md + ROADMAP-STANDARDS.
// Deterministic loop: read the tracker export -> decide the next dispatch ->
// launch the develop/review agent through your agent runner -> wait for the issue's state to
// advance -> repeat, until nothing is ready or in-review-clean. Sequential
// (WIP=1) so concurrent develop agents never collide in one working tree.
//
//   AGENT_LAUNCHER_CLI=<launcher> bun pm-cycle.ts --repo <projectRepo> [--launcher-url <url>] [--max-min 15]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../../src/core/engine.ts';
import { DefaultPreset, prBranchesFrom } from '../../src/presets/default.ts';
import { gitWorld } from '../../src/core/gitWorld.ts';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
const REPO = flag('repo', process.cwd())!;
const URL = flag('launcher-url', flag('url', ''))!;
const MAX_MS = Number(flag('max-min', '15')) * 60_000;
// Path to your agent launcher CLI. It must support:
//   <launcher> claude new -y --name <name> --cwd <repo> --prompt-file <file> [--url <url>]
const AGENT_LAUNCHER_CLI = process.env.AGENT_LAUNCHER_CLI;
if (!AGENT_LAUNCHER_CLI) throw new Error('Set AGENT_LAUNCHER_CLI to your agent launcher command before running this boilerplate.');
// This boilerplate lives at <ztrack>/boilerplates/core-sdlc/; resolve the package root from it.
const ZTRACK = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOILER = join(ZTRACK, 'boilerplates', 'core-sdlc');
const VALIDATOR = join(ZTRACK, 'src', 'core', 'cli.ts');
const MUTATE = join(ZTRACK, 'src', 'core', 'mutate.ts');
const TRACKER_DIR = join(REPO, 'tracker');

function log(m: string) { console.log(`[pm ${new Date().toISOString().slice(11, 19)}] ${m}`); }

interface IssueState { id: string; status: string; ok: boolean }
function readIssues(): IssueState[] {
  const files = existsSync(TRACKER_DIR) ? readdirSync(TRACKER_DIR).filter((f) => f.endsWith('.md')).sort() : [];
  const out: IssueState[] = [];
  for (const f of files) {
    const md = readFileSync(join(TRACKER_DIR, f), 'utf8');
    const r = check(DefaultPreset, md, gitWorld(REPO, prBranchesFrom(md)));
    for (const i of r.export?.issues ?? []) out.push({ id: i.id, status: i.status, ok: r.findings.filter((x) => x.issueId === i.id).every((x) => x.severity !== 'error') });
  }
  return out;
}

function launch(...a: string[]): string {
  return execFileSync(AGENT_LAUNCHER_CLI!, [...a, ...(URL ? ['--url', URL] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function dispatch(role: 'develop' | 'review', id: string): string {
  const promptFile = `/tmp/pm-${role}-${id}.prompt.md`;
  writeFileSync(promptFile, role === 'develop' ? developPrompt(id) : reviewPrompt(id));
  const out = launch('claude', 'new', '-y', '--name', `${role}-${id}`, '--cwd', REPO, '--prompt-file', promptFile);
  return /"terminalId":\s*"([^"]+)"/.exec(out)?.[1] ?? '(unknown)';
}

async function sleep(ms: number) { await new Promise((r) => setTimeout(r, ms)); }
async function waitForState(id: string, expected: string, maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(10_000);
    const issue = readIssues().find((i) => i.id === id);
    if (issue?.status === expected) return true;
    if (issue?.status === 'failed') return false;
    log(`  …${id} is ${issue?.status} (waiting for ${expected}, ${Math.round((Date.now() - start) / 1000)}s)`);
  }
  return false;
}

async function main() {
  log(`PM cycle on ${REPO}${URL ? ` via ${URL}` : ''}`);
  let n = 0;
  while (true) {
    const issues = readIssues();
    const reviewable = issues.find((i) => i.status === 'in-review' && i.ok);
    const ready = issues.find((i) => i.status === 'ready');
    let role: 'develop' | 'review'; let id: string; let expected: string;
    if (reviewable) { role = 'review'; id = reviewable.id; expected = 'done'; }
    else if (ready) { role = 'develop'; id = ready.id; expected = 'in-review'; }
    else { log(`idle — nothing ready or in-review-clean. states: ${issues.map((i) => `${i.id}:${i.status}`).join(', ')}`); break; }

    n += 1;
    log(`tick ${n}: dispatch ${role} for ${id} (expect -> ${expected})`);
    const terminalId = dispatch(role, id);
    log(`  launched ${role} in ${terminalId}`);
    const ok = await waitForState(id, expected, MAX_MS);
    if (!ok) { log(`STUCK: ${id} did not reach ${expected} within ${MAX_MS / 60000}min — stopping cycle`); break; }
    log(`✓ ${id} reached ${expected}`);
  }
  log('cycle complete');
}

function developPrompt(id: string): string {
  const branch = id.toLowerCase();
  return `You are the DEVELOP agent. cwd is the project repo. Implement issue ${id} end-to-end and move it to in-review. Use the MUTATION AFFORDANCES to change tracker state — never hand-edit tracker/*.md. Work autonomously.

Read first: ${BOILER}/agents/develop.md, ${BOILER}/standards/CODE-STANDARDS.md, ${BOILER}/standards/ISSUE-STANDARDS.md
Issue file (read its ACs): tracker/${id}.md

Mutation CLI:   bun ${MUTATE} <op> ${id} ... --repo .
Validator:      bun ${VALIDATOR} check tracker/${id}.md --repo .

Steps:
1. git checkout -b ${branch}
2. Implement EACH acceptance criterion in the app (index.html / app.js / styles). Commit on ${branch}.
3. Capture a screenshot proving each AC to tracker/evidence/${branch}-<acId>.png (serve with python3 -m http.server, screenshot headlessly with npx playwright). Commit the screenshots on ${branch}.
4. SHA=$(git rev-parse ${branch})
5. For EACH AC <acId> (with its current version <v>):
   bun ${MUTATE} evidence-add ${id} <acId> --repo . --ev ev1 --image tracker/evidence/${branch}-<acId>.png --commit $SHA --acv <v>
   bun ${MUTATE} proof-set ${id} <acId> --repo . --explanation "<how the screenshot proves this AC>" --refs ev1
   bun ${MUTATE} ac-status ${id} <acId> passed --repo .
6. bun ${MUTATE} set-pr ${id} ${branch} --repo .
7. bun ${MUTATE} set-status ${id} in-review --repo .
8. Validate — must print PASS: bun ${VALIDATOR} check tracker/${id}.md --repo .
   If it fails, fix (never weaken an AC) until PASS. Evidence commit must equal the branch head.
9. Print: OUTCOME: ready-for-review. Do not merge.`;
}

function reviewPrompt(id: string): string {
  const branch = id.toLowerCase();
  return `You are the REVIEW agent. cwd is the project repo. Review issue ${id} and merge it if it genuinely holds. Use MUTATION AFFORDANCES — never hand-edit tracker/*.md. Work autonomously.

Read first: ${BOILER}/agents/review.md, ${BOILER}/standards/ISSUE-STANDARDS.md, ${BOILER}/standards/CODE-STANDARDS.md
Issue file: tracker/${id}.md   (currently in-review, PR = branch ${branch})

Mutation CLI:   bun ${MUTATE} <op> ${id} ... --repo .
Validator:      bun ${VALIDATOR} check tracker/${id}.md --repo .

Steps:
1. Validate — must print PASS: bun ${VALIDATOR} check tracker/${id}.md --repo .
2. For each passed AC, open its cited screenshot and confirm it shows the stated behavior. The validator proves freshness; you prove it is TRUE.
3. If any AC is not actually met: bun ${MUTATE} ac-status ${id} <acId> failed --repo . ; print OUTCOME: changes-requested ; STOP (do not merge).
4. If all hold: git checkout main && git merge --no-ff ${branch} -m "merge ${branch}"
5. bun ${MUTATE} set-status ${id} done --repo .
6. Validate again — must PASS (done is legal because the PR is merged).
7. Print: OUTCOME: merged.`;
}

void main();
