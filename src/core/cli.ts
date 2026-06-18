#!/usr/bin/env bun
// The `tracker check` affordance over the core. Reads an issue markdown file,
// builds the git-world context from a real repo, runs the `default` preset's
// validator, prints findings, and exits non-zero if it does not pass.
//
// Local PR model (no GitHub): an issue's `PR:` value is a git branch name.
//   headSha = the branch tip; merged = the branch is contained in `main`.
// That makes the freshness and `done`-merge checks real against a local repo.

import { readFileSync } from 'node:fs';
import { checkDefault, prBranchesFrom } from '../presets/default.ts';
import { gitWorld } from './gitWorld.ts';

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd !== 'check') {
    console.error('usage: cli.ts check <issue.md> [--repo <dir>] [--json]');
    process.exit(2);
  }
  const file = args.find((a) => !a.startsWith('--') && a !== 'check');
  const repo = (args[args.indexOf('--repo') + 1] && args.includes('--repo')) ? args[args.indexOf('--repo') + 1]! : process.cwd();
  const asJson = args.includes('--json');
  if (!file) { console.error('error: no issue file given'); process.exit(2); }

  const markdown = readFileSync(file, 'utf8');
  const ctx = gitWorld(repo, prBranchesFrom(markdown));
  const result = checkDefault(markdown, ctx);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.ok ? '✓ PASS' : '✗ FAIL');
    for (const f of result.findings) {
      const loc = [f.issueId, f.acId, f.evidenceId].filter(Boolean).join('/');
      console.log(`  [${f.severity}] ${f.code}${loc ? ` (${loc})` : ''}: ${f.message}`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}

main();
