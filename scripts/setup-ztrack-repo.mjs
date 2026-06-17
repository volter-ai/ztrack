#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');

function usage() {
  return `usage: node scripts/setup-ztrack-repo.mjs (--repo <path>|--new <path>) [options]

Options:
  --team <KEY>              Team key for local tracker IDs. Default: APP
  --preset <name>           ztrack init preset. Default: simple-sdlc
  --profile <name>          Operating profile to copy. Default: simple-sdlc
  --install <spec|none>     npm install spec. Default: current package checkout
  --schedule <scheduler|none> Install scheduled runner. Default: scheduler
  --seed-demo-issues        Create starter ztrack issues for the PM tick
  --run                    Run the first profile PM tick after setup. Requires an agent backend.
  --force                  Replace an existing copied profile
`;
}

function argValue(args, name, fallback = '') {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return fallback;
  return value;
}

function run(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result;
}

function ensureNewRepo(target) {
  mkdirSync(target, { recursive: true });
  if (!existsSync(join(target, '.git'))) run(target, 'git', ['init', '-q']);
  if (!existsSync(join(target, 'README.md'))) writeFileSync(join(target, 'README.md'), `# ${target.split(/[\\/]/).pop() || 'app'}\n`);
  if (!existsSync(join(target, 'package.json'))) run(target, 'npm', ['init', '-y']);
}

function ensureExistingRepo(target) {
  if (!existsSync(target)) throw new Error(`repo does not exist: ${target}`);
  if (!existsSync(join(target, 'package.json'))) run(target, 'npm', ['init', '-y']);
}

function copyDir(src, dest, force) {
  if (existsSync(dest)) {
    if (!force) throw new Error(`${dest} already exists; pass --force to replace it`);
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

function writeBody(target, title, source, acText) {
  const body = `# ${title}

## Summary

${source} [1]

## Acceptance Criteria

- [ ] dev/01 status: pending ${acText} [1]

## Sources

[1] Requirement:
> ${source}

## Evidence
`;
  writeFileSync(target, body);
}

function seedDemoIssues(repo) {
  const tmp = mkdtempSync(join(tmpdir(), 'ztrack-seed-'));
  try {
    const issues = [
      {
        title: 'Add health check endpoint',
        state: 'Ready',
        label: 'area:api',
        source: 'Operators need a lightweight health check endpoint before the service can be monitored.',
        ac: 'Expose a health check endpoint with a stable success response.',
      },
      {
        title: 'Document deploy rollback',
        state: 'Backlog',
        label: 'area:docs',
        source: 'Release managers need a rollback runbook before enabling scheduled deployment agents.',
        ac: 'Document rollback triggers, owner, and verification steps.',
      },
    ];

    for (const issue of issues) {
      const body = join(tmp, `${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`);
      writeBody(body, issue.title, issue.source, issue.ac);
      run(repo, 'npx', [
        'ztrack',
        'issue',
        'create',
        '--title',
        issue.title,
        '--label',
        'type:case',
        '--label',
        issue.label,
        '--state',
        issue.state,
        '--assignee',
        'pm',
        '--body-file',
        body,
      ]);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function installPackage(repo, installSpec) {
  if (installSpec === 'none') return;
  run(repo, 'npm', ['install', '-D', installSpec || packageRoot]);
}

function installSchedule(repo, profile, schedule) {
  if (schedule === 'none') return null;
  if (schedule !== 'scheduler') throw new Error(`unsupported --schedule ${schedule}`);
  return join(repo, 'profiles', profile, 'scheduler', 'schedule.json');
}

function installAgentSkills(repo, profileSource) {
  const skills = join(profileSource, 'skills');
  if (!existsSync(skills)) return;
  for (const name of ['pm', 'draft', 'develop', 'review']) {
    const src = join(skills, name);
    if (!existsSync(src)) continue;
    copyDir(src, join(repo, '.agents', 'skills', `ztrack-simple-sdlc-${name}`), true);
    copyDir(src, join(repo, '.claude', 'skills', `ztrack-simple-sdlc-${name}`), true);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return;
  }

  const newPath = argValue(args, '--new');
  const repoPath = argValue(args, '--repo');
  if (!newPath && !repoPath) throw new Error('provide --repo <path> or --new <path>');
  if (newPath && repoPath) throw new Error('provide only one of --repo or --new');

  const repo = resolve(newPath || repoPath);
  const team = argValue(args, '--team', 'APP');
  const preset = argValue(args, '--preset', 'simple-sdlc');
  const profile = argValue(args, '--profile', 'simple-sdlc');
  const installSpec = argValue(args, '--install', packageRoot);
  const schedule = argValue(args, '--schedule', 'scheduler');
  const force = args.includes('--force');
  const shouldRun = args.includes('--run');
  const seed = args.includes('--seed-demo-issues');

  const profileSource = join(packageRoot, 'profiles', profile);
  if (!existsSync(profileSource)) throw new Error(`unknown profile: ${profile}`);

  if (newPath) ensureNewRepo(repo);
  else ensureExistingRepo(repo);

  installPackage(repo, installSpec);
  run(repo, 'npx', ['ztrack', 'init', '--team', team, '--preset', preset]);

  const profileDest = join(repo, 'profiles', profile);
  copyDir(profileSource, profileDest, force);
  installAgentSkills(repo, profileSource);
  const installedSchedule = installSchedule(repo, profile, schedule);
  if (seed) seedDemoIssues(repo);

  let setupTick = null;
  if (shouldRun) {
    const tick = run(repo, 'node', [join(profileDest, 'scheduler', 'scripts', 'run.mjs'), '--once']);
    setupTick = { status: tick.status ?? 0 };
  }

  process.stdout.write(`${JSON.stringify({
    repo,
    preset,
    profile,
    installedProfile: profileDest,
    installedSchedule,
    seededDemoIssues: seed,
    setupTick,
    next: shouldRun
      ? undefined
      : 'Edit profiles/simple-sdlc/scheduler/schedule.json, then run node profiles/simple-sdlc/scheduler/scripts/run.mjs',
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}`);
  process.exit(1);
}
