#!/usr/bin/env bun
// Mutation affordances for the default preset — the only way tracker state
// changes. Each op edits the issue markdown (parse -> change object ->
// serialize) AND appends to the separate audit log, so audit history is
// automatic and agents never hand-edit files.
//
//   bun mutate.ts create <id> --repo R --title T --assignee A [--summary S]
//   bun mutate.ts set-status <id> <status> --repo R [--actor X]
//   bun mutate.ts set-pr <id> <branch> --repo R
//   bun mutate.ts ac-add <id> <acId> --repo R --text T [--version N]
//   bun mutate.ts ac-status <id> <acId> <status> --repo R
//   bun mutate.ts evidence-add <id> <acId> --repo R --ev EV --image P --commit SHA --acv N
//   bun mutate.ts proof-set <id> <acId> --repo R --explanation E --refs ev1,ev2

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DefaultRootSchema, parseDefault, serializeIssue, type DefaultRoot } from '../presets/default.ts';
import { appendAudit, setBaselineIssue } from './audit.ts';
import type { AuditEntry } from './engine.ts';

type Issue = DefaultRoot['issues'][number];

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function issuePath(repo: string, id: string): string { return join(repo, 'tracker', `${id}.md`); }
function nowIso(): string { return new Date().toISOString(); }

function load(repo: string, id: string): { path: string; issue: Issue } {
  const path = issuePath(repo, id);
  if (!existsSync(path)) throw new Error(`no such issue ${id} (${path})`);
  const issue = DefaultRootSchema.parse(parseDefault(readFileSync(path, 'utf8'))).issues[0];
  if (!issue) throw new Error(`empty issue file ${id}`);
  return { path, issue };
}
function commit(repo: string, path: string, issue: Issue, entry: Omit<AuditEntry, 'ts' | 'issueId'>): void {
  writeFileSync(path, serializeIssue(issue));
  appendAudit(repo, { ts: nowIso(), issueId: issue.id, ...entry });
  setBaselineIssue(repo, issue); // advance the observer baseline so it won't re-log this change
}

function main() {
  const [cmd, id, ...rest] = process.argv.slice(2);
  const repo = flag(process.argv, 'repo') ?? process.cwd();
  const actor = flag(process.argv, 'actor') ?? 'otto';
  if (!cmd || !id) { console.error('usage: mutate.ts <command> <issueId> ...'); process.exit(2); }

  switch (cmd) {
    case 'create': {
      const path = issuePath(repo, id);
      mkdirSync(dirname(path), { recursive: true });
      if (existsSync(path)) throw new Error(`issue ${id} already exists`);
      const issue = {
        id, title: flag(process.argv, 'title') ?? id, summary: flag(process.argv, 'summary') ?? '',
        status: 'draft' as const, assignee: flag(process.argv, 'assignee') ?? '', acceptanceCriteria: [],
      };
      writeFileSync(path, serializeIssue(issue as Issue));
      appendAudit(repo, { ts: nowIso(), issueId: id, op: 'create', actor });
      setBaselineIssue(repo, issue as Issue);
      break;
    }
    case 'set-status': {
      const to = rest[0]!;
      const { path, issue } = load(repo, id);
      const from = issue.status;
      issue.status = to as Issue['status'];
      commit(repo, path, issue, { op: 'status', field: 'status', from, to, actor });
      break;
    }
    case 'set-pr': {
      const branch = rest[0]!;
      const { path, issue } = load(repo, id);
      const from = issue.pr?.url;
      issue.pr = { url: branch };
      commit(repo, path, issue, { op: 'set-pr', field: 'pr', from, to: branch, actor });
      break;
    }
    case 'ac-add': {
      const acId = rest[0]!;
      const { path, issue } = load(repo, id);
      issue.acceptanceCriteria.push({
        id: acId, status: 'pending', checked: false,
        text: flag(process.argv, 'text') ?? acId, version: Number(flag(process.argv, 'version') ?? 1), evidence: [],
      });
      commit(repo, path, issue, { op: 'ac.add', field: acId, to: 'pending', actor });
      break;
    }
    case 'ac-status': {
      const acId = rest[0]!; const to = rest[1]!;
      const { path, issue } = load(repo, id);
      const ac = issue.acceptanceCriteria.find((a) => a.id === acId);
      if (!ac) throw new Error(`no AC ${acId} on ${id}`);
      const from = ac.status;
      ac.status = to as Issue['acceptanceCriteria'][number]['status'];
      ac.checked = to === 'passed';
      commit(repo, path, issue, { op: 'ac.status', field: acId, from, to, actor });
      break;
    }
    case 'evidence-add': {
      const acId = rest[0]!;
      const { path, issue } = load(repo, id);
      const ac = issue.acceptanceCriteria.find((a) => a.id === acId);
      if (!ac) throw new Error(`no AC ${acId} on ${id}`);
      const ev = { id: flag(process.argv, 'ev') ?? `ev${ac.evidence.length + 1}`, image: flag(process.argv, 'image')!, commit: (flag(process.argv, 'commit') ?? '').toLowerCase(), acVersion: Number(flag(process.argv, 'acv') ?? ac.version) };
      ac.evidence.push(ev);
      commit(repo, path, issue, { op: 'evidence.add', field: `${acId}/${ev.id}`, to: ev.image, actor });
      break;
    }
    case 'proof-set': {
      const acId = rest[0]!;
      const { path, issue } = load(repo, id);
      const ac = issue.acceptanceCriteria.find((a) => a.id === acId);
      if (!ac) throw new Error(`no AC ${acId} on ${id}`);
      ac.proof = { explanation: flag(process.argv, 'explanation') ?? '', evidenceRefs: (flag(process.argv, 'refs') ?? '').split(',').map((s) => s.trim()).filter(Boolean) };
      commit(repo, path, issue, { op: 'proof.set', field: acId, to: ac.proof.explanation, actor });
      break;
    }
    default:
      console.error(`unknown command: ${cmd}`); process.exit(2);
  }
  console.log(`✓ ${cmd} ${id}`);
}

main();
