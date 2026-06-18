#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

function usage() {
  return 'usage: ztrack-profile-check [--repo path] [--profile simple-sdlc]\n';
}

function value(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message, detail = {}) {
  return { ok: false, message, ...detail };
}

function checkProfile(repo, profileName) {
  const rel = (p) => join(repo, p);
  const profilePath = rel(`profiles/${profileName}/profile.json`);
  const findings = [];
  if (!existsSync(profilePath)) return [fail('missing profile manifest', { path: profilePath })];
  const manifest = readJson(profilePath);
  const required = [
    manifest.readme,
    manifest.scheduler?.schedule,
    ...(manifest.scheduler?.scripts ?? []),
    manifest.scripts?.runAgent,
    ...(manifest.standards ?? []),
  ].filter(Boolean);
  for (const path of required) if (!existsSync(rel(path))) findings.push(fail('missing profile file', { path }));

  const schedulePath = manifest.scheduler?.schedule;
  if (schedulePath && existsSync(rel(schedulePath))) {
    const schedule = readJson(rel(schedulePath));
    for (const command of schedule.scripts ?? []) {
      const script = command.replace(/^node\s+/, '');
      if (!existsSync(rel(script))) findings.push(fail('scheduled script target missing', { command }));
    }
  }

  const skillTexts = [];
  for (const [role, skill] of Object.entries(manifest.skills ?? {})) {
    for (const path of [skill.source, skill.codex, skill.claude]) {
      if (!existsSync(rel(path))) findings.push(fail('missing installed skill', { role, path }));
    }
    if (skill.source && existsSync(rel(skill.source))) {
      const text = readFileSync(rel(skill.source), 'utf8');
      skillTexts.push(text);
      if (!text.includes(`name: ${skill.name}`)) findings.push(fail('skill frontmatter name mismatch', { role, path: skill.source }));
    }
  }

  for (const standard of manifest.standards ?? []) {
    if (!skillTexts.some((text) => text.includes(standard))) {
      findings.push(fail('standard is listed but no skill reads it', { path: standard }));
    }
  }
  return findings;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(usage());
  process.exit(0);
}
const repo = resolve(value(args, '--repo', process.cwd()));
const profile = value(args, '--profile', 'simple-sdlc');
const findings = checkProfile(repo, profile);
process.stdout.write(`${JSON.stringify({ ok: findings.length === 0, profile, findings }, null, 2)}\n`);
process.exit(findings.length === 0 ? 0 : 1);
