import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RuleClassification } from '../checkRules.ts';
import { trackerBackendScriptPath, trackerConfigPath } from '../config.ts';
import { TrackerSnapshotSchema, TrackerValidationReportSchema, type TrackerFinding, type TrackerSnapshot } from '../snapshotContract.ts';
import type { TrackerPresetRuntime } from '../presets.ts';

type JsonObject = Record<string, any>;

const CHECKBOX_RE = /^\s*-\s+\[(?<checked>[ xX])\]\s+(?<body>.+)$/gm;
const AC_ID_RE = /\b(?<prefix>AC[- ]?|case\/|dev\/|ext\/|proc\/)(?<num>\d{1,3})\b/i;
const COMMIT_RE = /\bcommit[:\s]+(?<sha>[0-9a-f]{7,40})\b/i;
const EVIDENCE_RE = /\[E(?<num>\d+)\]/g;
const SOURCE_RE = /(?<![A-Za-z])\[(?:source\s*)?(?<num>\d+)\]/gi;
const STATUS_RE = /\bstatus:\s*(pending|passed|failed|stale|blocked|descoped)\b/i;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function runTracker(args: string[], projectRoot: string): unknown {
  const result = spawnSync('python3', [trackerBackendScriptPath(), ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PROJECT_ROOT: projectRoot,
      TRACKER_PROJECT_ROOT: projectRoot,
      CONFIG_FILE: trackerConfigPath(projectRoot),
    },
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `tracker backend failed: ${args.join(' ')}`);
  return JSON.parse(result.stdout || 'null');
}

function issueIdentifier(issue: JsonObject): string {
  return stringValue(issue.identifier) || stringValue(issue.id) || stringValue(issue.number);
}

function labelsValue(issue: JsonObject): string[] {
  const labels = issue.labels;
  if (Array.isArray(labels)) return labels.map((label) => isObject(label) ? stringValue(label.name) : stringValue(label)).filter(Boolean);
  if (isObject(labels) && Array.isArray(labels.nodes)) return labels.nodes.map((label) => isObject(label) ? stringValue(label.name) : stringValue(label)).filter(Boolean);
  return [];
}

function stateName(issue: JsonObject): string {
  return stringValue(issue.state) || (isObject(issue.state) ? stringValue(issue.state.name) : '') || 'open';
}

function stateType(issue: JsonObject): string {
  return stringValue(issue.stateType) || (isObject(issue.state) ? stringValue(issue.state.type) : '') || 'open';
}

function titleFromBody(body: string): string {
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? '';
}

function normalizedAcId(body: string): string {
  const match = AC_ID_RE.exec(body);
  if (!match?.groups) return body.split(/\s+/, 1)[0] ?? 'AC';
  const prefix = match.groups.prefix.toLowerCase().replace(' ', '-');
  const num = String(Number(match.groups.num)).padStart(2, '0');
  return prefix.endsWith('/') ? `${prefix}${num}` : `AC-${num}`;
}

function acText(body: string): string {
  return body
    .replace(AC_ID_RE, '')
    .replace(STATUS_RE, '')
    .replace(COMMIT_RE, '')
    .replace(EVIDENCE_RE, '')
    .replace(SOURCE_RE, '')
    .replace(/\bAC-Version:\s*acv_[0-9a-f]{8,64}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function acceptanceCriteria(body: string) {
  return [...body.matchAll(CHECKBOX_RE)].map((match) => {
    const row = match.groups?.body ?? '';
    const status = STATUS_RE.exec(row)?.[1]?.toLowerCase() ?? (match.groups?.checked?.toLowerCase() === 'x' ? 'passed' : 'pending');
    return {
      id: normalizedAcId(row),
      type: normalizedAcId(row).split('/')[0].toLowerCase(),
      checked: match.groups?.checked?.toLowerCase() === 'x',
      status,
      body: row,
      text: acText(row),
      sourceRefs: [...new Set([...row.matchAll(SOURCE_RE)].flatMap((m) => m.groups?.num ? [m.groups.num] : []))].sort(),
      evidenceRefs: [...new Set([...row.matchAll(EVIDENCE_RE)].flatMap((m) => m.groups?.num ? [`E${m.groups.num}`] : []))].sort(),
      commitHashes: COMMIT_RE.exec(row)?.groups?.sha ? [COMMIT_RE.exec(row)!.groups!.sha!.toLowerCase()] : [],
    };
  });
}

function evidenceEntries(body: string) {
  return [...body.matchAll(/^\s*\[(E\d+)\]\s+(.+)$/gm)].map((match) => ({
    id: match[1]!,
    type: /\btype:\s*([^\s]+)/i.exec(match[2]!)?.[1] ?? 'evidence',
    fields: Object.fromEntries([...match[2]!.matchAll(/\b([a-z][a-z0-9-]*)\s*:\s*([^\s]+)/gi)].map((m) => [m[1]!, m[2]!])),
    ac: [...match[2]!.matchAll(/\bac:\s*([^\s]+)/gi)].flatMap((m) => m[1]!.split(',')),
  }));
}

function normalizeIssue(issue: JsonObject) {
  const body = stringValue(issue.body) || stringValue(issue.description);
  const identifier = issueIdentifier(issue);
  const ac = acceptanceCriteria(body);
  const evidence = evidenceEntries(body);
  return {
    identifier,
    title: stringValue(issue.title) || titleFromBody(body),
    summary: '',
    body,
    validatedIssue: { preset: 'generic', acceptanceCriteria: ac, evidence, proofs: [] },
    acceptanceCriteria: ac,
    markdownDiagnostics: body.trim() ? [] : [{ level: 'warning', code: 'issue_body_empty', message: 'Issue body is empty.' }],
    state: stateName(issue),
    status: stateType(issue),
    stateType: stateType(issue),
    createdAt: stringValue(issue.createdAt),
    assignee: stringValue(issue.assignee),
    labels: labelsValue(issue),
    project: isObject(issue.project) ? stringValue(issue.project.name) : stringValue(issue.project),
    comments: [],
    branchName: stringValue(issue.branchName),
    sources: [],
    linkedIssues: [],
    blocks: [],
    blockedBy: [],
    skillRuns: [],
    history: [],
    unmappedCheckedAcCount: 0,
    threadRedirects: [],
    taskIssues: [],
  };
}

function exportGenericSnapshot(options: unknown): TrackerSnapshot {
  const opts = isObject(options) ? options : {};
  const projectRoot = stringValue(opts.projectRoot) || process.cwd();
  const issues = runTracker([
    'issue',
    'list',
    '--state',
    'all',
    '--limit',
    String(Number(opts.limit) || 5000),
    '--json',
    'identifier,title,body,description,state,stateType,assignee,labels,project,branchName,createdAt,updatedAt',
  ], projectRoot);
  const wanted = Array.isArray(opts.issues) ? new Set(opts.issues.map(String)) : null;
  const cases = (Array.isArray(issues) ? issues.filter(isObject) : [])
    .filter((issue) => !wanted || wanted.has(issueIdentifier(issue)))
    .map(normalizeIssue);
  return TrackerSnapshotSchema.parse({
    schema: 'tracker-snapshot@1',
    projectRoot,
    preset: 'generic',
    cases,
    noCaseSkillRuns: [],
    threadRedirects: [],
    messages: [],
    annotations: [],
    malformed: { messages: 0, annotations: 0 },
  });
}

function checkGenericSnapshot(rawSnapshot: unknown, options: unknown) {
  const snapshot = TrackerSnapshotSchema.parse(rawSnapshot);
  const opts = isObject(options) ? options : {};
  const projectRoot = stringValue(opts.projectRoot) || snapshot.projectRoot || process.cwd();
  const findings: TrackerFinding[] = [];
  for (const currentCase of snapshot.cases) {
    if (currentCase.stateType !== 'canceled' && !stringValue(currentCase.assignee)) {
      findings.push({ level: 'error', code: 'case_missing_assignee', issue: currentCase.identifier, message: 'Non-canceled tracker cases must have a concrete assignee.' });
    }
    const evidenceIds = new Set((currentCase.validatedIssue.evidence ?? []).map((entry) => entry.id));
    for (const ac of currentCase.acceptanceCriteria) {
      if (!ac.checked && ac.status !== 'passed') continue;
      const commits = Array.isArray((ac as any).commitHashes) ? (ac as any).commitHashes as string[] : [];
      if (commits.length === 0) {
        findings.push({ level: 'error', code: 'checked_ac_missing_commit_hash', issue: currentCase.identifier, message: `Checked AC ${ac.id} does not cite a commit hash.` });
      }
      for (const sha of commits) {
        const exists = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: projectRoot }).status === 0;
        if (!exists) findings.push({ level: 'error', code: 'checked_ac_commit_hash_missing', issue: currentCase.identifier, message: `Checked AC ${ac.id} cites missing commit ${sha}.` });
      }
      if (ac.evidenceRefs.length === 0) {
        findings.push({ level: 'error', code: 'checked_ac_missing_evidence', issue: currentCase.identifier, message: `Checked AC ${ac.id} does not cite evidence.` });
      }
      for (const ref of ac.evidenceRefs) {
        if (!evidenceIds.has(ref)) findings.push({ level: 'error', code: 'checked_ac_unknown_evidence', issue: currentCase.identifier, message: `Checked AC ${ac.id} cites unknown evidence ${ref}.` });
      }
    }
  }
  return TrackerValidationReportSchema.parse({
    valid: findings.filter((finding) => finding.level === 'error').length === 0,
    summary: {
      cases: snapshot.cases.length,
      openCases: snapshot.cases.filter((currentCase) => !['completed', 'canceled'].includes(currentCase.stateType)).length,
      errors: findings.filter((finding) => finding.level === 'error').length,
      warnings: findings.filter((finding) => finding.level === 'warning').length,
      findingCounts: Object.fromEntries([...new Set(findings.map((finding) => finding.code))].map((code) => [code, findings.filter((finding) => finding.code === code).length])),
      status: findings.some((finding) => finding.level === 'error') ? 'fail' : 'pass',
    },
    findings,
  });
}

function classifyGenericRuleCode(code: string): RuleClassification & { explicit: boolean } {
  const category = code.includes('commit') || code.includes('evidence') ? 'code' : 'wellformed';
  return { category, depth: 1, explicit: true };
}

export const GENERIC_PRESET: TrackerPresetRuntime = {
  name: 'generic',
  scaffoldIssueBody: (title: string) => `# ${title}\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending Describe the work.\n\n## Evidence\n`,
  parseIssueMarkdown: (body: string) => ({ preset: 'generic', acceptanceCriteria: acceptanceCriteria(body), evidence: evidenceEntries(body), proofs: [] }),
  markdownDiagnostics: (body: string) => body.trim() ? [] : [{ level: 'warning', code: 'issue_body_empty', message: 'Issue body is empty.' }],
  snapshot: {
    exportSnapshot: exportGenericSnapshot,
    checkSnapshot: checkGenericSnapshot,
    classifyRuleCode: classifyGenericRuleCode,
  },
};
