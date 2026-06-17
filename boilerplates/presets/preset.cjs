// Repo-local ztrack validation preset.
//
// This file is intentionally plain CommonJS so a fresh project can edit it
// without a build step. It starts from the __ZTRACK_PRESET_NAME__ starter.
// Replace these rules with your team's actual workflow.
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { dirname, join } = require('node:path');

const CHECKBOX_RE = /^\s*-\s+\[(?<checked>[ xX])\]\s+(?<body>.+)$/gm;
const AC_ID_RE = /^\s*(?<prefix>AC[- ]?|case\/|dev\/|ext\/|proc\/)(?<num>\d{1,3})\b/i;
const STATUS_FIELD_RE = /^\s*(?:\S+\s+){0,2}status:\s*(?<status>pending|passed|failed|stale|blocked|descoped)\b/i;
const COMMIT_RE_G = /\bcommit[:\s]+(?<sha>[0-9a-f]{7,40})\b/gi;
const EVIDENCE_RE = /\[E(?<num>\d+)\]/g;
const SOURCE_RE = /(?<![A-Za-z])\[(?:source\s*)?(?<num>\d+)\]/gi;
const FIELD_RE = /\b([a-z][a-z0-9-]*)\s*:\s*(.+?)(?=\s+[a-z][a-z0-9-]*\s*:|$)/gi;

const PRESET_NAME = '__ZTRACK_PRESET_NAME__';
const REQUIRE_SOURCE_MARKER = '__ZTRACK_REQUIRE_SOURCE_MARKER__' === 'true';
const REQUIRE_SDLC_GATES = '__ZTRACK_REQUIRE_SDLC_GATES__' === 'true';
const REQUIRE_SPEC_SECTIONS = '__ZTRACK_REQUIRE_SPEC_SECTIONS__' === 'true';
const REQUIRE_SPECKIT_SECTIONS = '__ZTRACK_REQUIRE_SPECKIT_SECTIONS__' === 'true';

function backendScriptPath() {
  const candidates = [];
  try {
    const resolved = dirname(require.resolve('ztrack'));
    candidates.push(
      join(resolved, '..', 'backend', 'tracker-local.py'),
      join(resolved, '..', '..', 'backend', 'tracker-local.py'),
    );
  } catch {
    // A repo-local preset may be loaded from a project that has no local
    // node_modules/ztrack. In that case, resolve relative to the running CLI
    // entrypoint (`.../dist/cli.js` or `.../src/cli.ts`).
  }
  if (process.argv[1]) candidates.push(join(dirname(process.argv[1]), '..', 'backend', 'tracker-local.py'));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Could not locate ztrack backend/tracker-local.py for the repo-local preset.');
  return found;
}

function configPath(projectRoot) {
  return join(projectRoot, '.volter', 'tracker-config.json');
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function runTracker(args, projectRoot) {
  const result = spawnSync('python3', [backendScriptPath(), ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PROJECT_ROOT: projectRoot,
      TRACKER_PROJECT_ROOT: projectRoot,
      CONFIG_FILE: configPath(projectRoot),
    },
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'tracker backend failed');
  return JSON.parse(result.stdout || 'null');
}

function parseAcId(body) {
  const match = AC_ID_RE.exec(body);
  if (!match || !match.groups) return { id: body.trim().split(/\s+/, 1)[0] || 'AC', type: 'ac' };
  const prefix = match.groups.prefix.toLowerCase();
  const num = String(Number(match.groups.num)).padStart(2, '0');
  if (prefix.endsWith('/')) return { id: `${prefix.slice(0, -1)}/${num}`, type: prefix.slice(0, -1) };
  return { id: `AC-${num}`, type: 'ac' };
}

function acceptanceCriteria(body) {
  return [...String(body || '').matchAll(CHECKBOX_RE)].map((match) => {
    const row = match.groups.body || '';
    const checked = match.groups.checked.toLowerCase() === 'x';
    const status = (STATUS_FIELD_RE.exec(row) || { groups: {} }).groups.status || (checked ? 'passed' : 'pending');
    const parsed = parseAcId(row);
    return {
      id: parsed.id,
      type: parsed.type,
      checked,
      status,
      body: row,
      text: row.replace(/\s{2,}/g, ' ').trim(),
      sourceRefs: [...new Set([...row.matchAll(SOURCE_RE)].map((m) => m.groups.num))].sort(),
      evidenceRefs: [...new Set([...row.matchAll(EVIDENCE_RE)].map((m) => `E${m.groups.num}`))].sort(),
      commitHashes: [...new Set([...row.matchAll(COMMIT_RE_G)].map((m) => m.groups.sha.toLowerCase()))],
    };
  });
}

function evidenceEntries(body) {
  return [...String(body || '').matchAll(/^\s*\[(E\d+)\]\s+(.+)$/gm)].map((match) => {
    const fields = Object.fromEntries([...match[2].matchAll(FIELD_RE)].map((m) => [m[1].toLowerCase(), m[2].trim()]));
    return { id: match[1], type: fields.type || 'evidence', fields, ac: (fields.ac || '').split(',').map((s) => s.trim()).filter(Boolean) };
  });
}

function sourceMarkers(body) {
  return [...new Set([...String(body || '').matchAll(SOURCE_RE)].map((m) => m.groups.num))].sort();
}

function normalizeIssue(issue) {
  const body = stringValue(issue.body) || stringValue(issue.description);
  const identifier = stringValue(issue.identifier) || stringValue(issue.id) || stringValue(issue.number);
  const ac = acceptanceCriteria(body);
  const evidence = evidenceEntries(body);
  return {
    identifier,
    title: stringValue(issue.title),
    body,
    state: stringValue(issue.state) || 'open',
    stateType: stringValue(issue.stateType) || 'open',
    assignee: stringValue(issue.assignee),
    labels: Array.isArray(issue.labels) ? issue.labels.map(String) : [],
    validatedIssue: { preset: PRESET_NAME, acceptanceCriteria: ac, evidence, proofs: [] },
    acceptanceCriteria: ac,
    sources: sourceMarkers(body).map((number) => ({ number, content: `[${number}]` })),
  };
}

function exportSnapshot(options = {}) {
  const projectRoot = stringValue(options.projectRoot) || process.cwd();
  const rows = runTracker([
    'issue', 'list', '--state', 'all', '--limit', String(Number(options.limit) || 5000),
    '--json', 'identifier,title,body,description,state,stateType,assignee,labels',
  ], projectRoot);
  const wanted = Array.isArray(options.issues) ? new Set(options.issues.map(String)) : null;
  return {
    schema: 'tracker-snapshot@1',
    projectRoot,
    preset: PRESET_NAME,
    cases: (Array.isArray(rows) ? rows : []).filter((row) => !wanted || wanted.has(String(row.identifier || ''))).map(normalizeIssue),
    noCaseSkillRuns: [],
    threadRedirects: [],
    messages: [],
    annotations: [],
    malformed: { messages: 0, annotations: 0 },
  };
}

function checkSnapshot(snapshot, options = {}) {
  const projectRoot = stringValue(options.projectRoot) || stringValue(snapshot && snapshot.projectRoot) || process.cwd();
  const gitAvailable = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: projectRoot }).status === 0;
  const findings = [];
  for (const issue of Array.isArray(snapshot.cases) ? snapshot.cases : []) {
    const id = stringValue(issue.identifier) || 'unknown';
    const body = stringValue(issue.body);
    if (REQUIRE_SOURCE_MARKER && !sourceMarkers(body).length) {
      findings.push({ level: 'error', code: `${PRESET_NAME}_case_missing_source_marker`, issue: id, message: 'Case body must cite at least one [N] source marker.' });
    }
    if (issue.stateType !== 'canceled' && !stringValue(issue.assignee)) {
      findings.push({ level: 'error', code: `${PRESET_NAME}_case_missing_assignee`, issue: id, message: 'Non-canceled cases must have an assignee.' });
    }
    if (REQUIRE_SPEC_SECTIONS) {
      for (const section of ['Requirements', 'Acceptance Criteria']) {
        if (!new RegExp(`^##\\s+${section}\\s*$`, 'im').test(body)) {
          findings.push({ level: 'error', code: `${PRESET_NAME}_missing_${section.toLowerCase().replace(/\s+/g, '_')}`, issue: id, message: `Spec issue must include ## ${section}.` });
        }
      }
    }
    if (REQUIRE_SPECKIT_SECTIONS) {
      for (const section of ['User Stories', 'Functional Requirements', 'Tasks']) {
        if (!new RegExp(`^##\\s+${section}\\s*$`, 'im').test(body)) {
          findings.push({ level: 'error', code: `${PRESET_NAME}_missing_${section.toLowerCase().replace(/\s+/g, '_')}`, issue: id, message: `Spec Kit issue must include ## ${section}.` });
        }
      }
    }
    if (REQUIRE_SDLC_GATES && issue.stateType !== 'canceled' && (!issue.acceptanceCriteria || issue.acceptanceCriteria.length === 0)) {
      findings.push({ level: 'error', code: `${PRESET_NAME}_case_missing_acceptance_criteria`, issue: id, message: 'Active cases must include at least one acceptance criterion.' });
    }
    const evidenceIds = new Set((issue.validatedIssue && issue.validatedIssue.evidence || []).map((entry) => entry.id));
    let passedCount = 0;
    for (const ac of issue.acceptanceCriteria || []) {
      if (ac.checked || ac.status === 'passed') passedCount += 1;
      if (!ac.checked && ac.status !== 'passed') continue;
      if (!ac.commitHashes || ac.commitHashes.length === 0) {
        findings.push({ level: 'error', code: `${PRESET_NAME}_checked_ac_missing_commit_hash`, issue: id, message: `Checked AC ${ac.id} does not cite a commit hash.` });
      }
      if (gitAvailable) {
        for (const sha of ac.commitHashes || []) {
          if (spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: projectRoot }).status !== 0) {
            findings.push({ level: 'error', code: `${PRESET_NAME}_checked_ac_commit_hash_missing`, issue: id, message: `Checked AC ${ac.id} cites missing commit ${sha}.` });
          }
        }
      }
      if (!ac.evidenceRefs || ac.evidenceRefs.length === 0) {
        findings.push({ level: 'error', code: `${PRESET_NAME}_checked_ac_missing_evidence`, issue: id, message: `Checked AC ${ac.id} does not cite evidence.` });
      }
      for (const ref of ac.evidenceRefs || []) {
        if (!evidenceIds.has(ref)) findings.push({ level: 'error', code: `${PRESET_NAME}_checked_ac_unknown_evidence`, issue: id, message: `Checked AC ${ac.id} cites unknown evidence ${ref}.` });
      }
    }
    if (REQUIRE_SDLC_GATES && ['done', 'completed'].includes(String(issue.stateType || issue.state || '').toLowerCase())) {
      const acCount = (issue.acceptanceCriteria || []).length;
      if (acCount === 0 || passedCount < acCount) {
        findings.push({ level: 'error', code: `${PRESET_NAME}_done_with_unpassed_acceptance_criteria`, issue: id, message: 'Done cases require every acceptance criterion to be passed.' });
      }
    }
  }
  const errors = findings.filter((finding) => finding.level === 'error').length;
  const warnings = findings.length - errors;
  return {
    valid: errors === 0,
    summary: {
      cases: Array.isArray(snapshot.cases) ? snapshot.cases.length : 0,
      openCases: Array.isArray(snapshot.cases) ? snapshot.cases.filter((issue) => !['completed', 'canceled'].includes(String(issue.stateType || ''))).length : 0,
      errors,
      warnings,
      findingCounts: Object.fromEntries([...new Set(findings.map((finding) => finding.code))].map((code) => [code, findings.filter((finding) => finding.code === code).length])),
      status: errors > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass',
    },
    findings,
  };
}

module.exports = {
  name: PRESET_NAME,
  scaffoldIssueBody(title) {
    if (PRESET_NAME === 'simple-spec') return `# ${title}\n\n## Summary\n\nShort statement of the feature or behavior. [1]\n\n## Requirements\n\n- The system must describe one concrete requirement. [1]\n\n## Acceptance Criteria\n\n- [ ] spec/01 status: pending Describe one observable acceptance criterion. [1]\n\n## Sources\n\n[1] Requirement:\nPaste the source text here.\n\n## Evidence\n`;
    if (PRESET_NAME === 'speckit') return `# ${title}\n\n## Summary\n\nSpec Kit feature summary. [1]\n\n## User Stories\n\n- As a user, I can do something valuable.\n\n## Functional Requirements\n\n- FR-001: The system must describe one concrete behavior. [1]\n\n## Tasks\n\n- [ ] task/01 status: pending Implement the first verifiable task. [1]\n\n## Acceptance Criteria\n\n- [ ] spec/01 status: pending The feature satisfies the primary user story. [1]\n\n## Sources\n\n[1] Requirement:\nPaste the source text here.\n\n## Evidence\n`;
    return `# ${title}\n\n## Summary\n\n${REQUIRE_SOURCE_MARKER ? 'Source-grounded summary. [1]' : 'Short statement of the work.'}\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending Describe one observable outcome.${REQUIRE_SOURCE_MARKER ? ' [1]' : ''}\n\n${REQUIRE_SOURCE_MARKER ? '## Sources\\n\\n[1] Requirement:\\nPaste the source text here.\\n\\n' : ''}## Evidence\n`;
  },
  parseIssueMarkdown(body) {
    return { preset: PRESET_NAME, acceptanceCriteria: acceptanceCriteria(body), evidence: evidenceEntries(body), proofs: [], sources: sourceMarkers(body).map((number) => ({ number, content: `[${number}]` })) };
  },
  markdownDiagnostics(body) {
    return !REQUIRE_SOURCE_MARKER || sourceMarkers(body).length ? [] : [{ level: 'warning', code: `${PRESET_NAME}_no_source_marker`, message: 'Issue body has no [N] source marker.' }];
  },
  snapshot: {
    exportSnapshot,
    checkSnapshot,
    classifyRuleCode(code) {
      return { category: code.includes('commit') || code.includes('evidence') ? 'code' : 'sourced', depth: 1, explicit: true };
    },
  },
};
