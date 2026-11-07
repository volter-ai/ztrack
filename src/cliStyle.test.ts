import { describe, expect, test } from 'bun:test';
import { renderCheckReport, summarizeResult } from './cliStyle.ts';
import type { CheckResult, CoreRoot, Finding } from './core/engine.ts';

// NO_COLOR keeps the rendered lines plain so the suffix is easy to match exactly.
process.env.NO_COLOR = '1';

const result = (findings: Finding[]): CheckResult<CoreRoot> => ({ ok: !findings.some((f) => f.severity === 'error'), findings });

// ZTB-19 (ZL-E9c): the exact 0.37.0 repro — a malformed issue fails shape validation, so
// `export` never gets populated, yet two findings cite `root.issues.0` for that very issue.
// The summary must not say "issues 0" while its own findings insist otherwise.
describe('summarizeResult — cannot contradict its own findings (ZL-E9c)', () => {
  test('export unset (shape-invalid root): falls back to examinedIssues instead of reporting 0', () => {
    const malformed: CheckResult<CoreRoot> = {
      ok: false,
      examinedIssues: 1,
      findings: [
        { code: 'root_shape_invalid', severity: 'error', message: 'Input does not match the preset root schema.' },
        { code: 'wellformed_shape', severity: 'error', message: 'root.issues.0.title: Too small: expected string to have >=1 characters' },
        { code: 'wellformed_shape', severity: 'error', message: 'root.issues.0.status: Invalid option: expected one of "draft"|"ready"|"in-progress"|"in-review"|"done"' },
      ],
    };
    const summary = summarizeResult(malformed);
    expect(summary).toEqual({ issues: 1, errors: 3, warnings: 0, acknowledged: 0, status: 'fail' });
    // the load-bearing assertion: the count is not 0 while a finding cites issue index 0
    expect(summary.issues).not.toBe(0);
  });

  test('export unset and examinedIssues also unset (unknown preset/zod crash): falls back to 0, not a crash', () => {
    const crashed: CheckResult<CoreRoot> = { ok: false, findings: [{ code: 'schema_error', severity: 'error', message: 'boom' }] };
    expect(summarizeResult(crashed).issues).toBe(0);
  });

  test('export populated (the normal, successful path): still reads from export, ignoring examinedIssues', () => {
    const ok: CheckResult<CoreRoot> = { ok: true, findings: [], examinedIssues: 99, export: { issues: [{ id: 'A-1' } as CoreRoot['issues'][number]] } };
    expect(summarizeResult(ok).issues).toBe(1);
  });
});

describe('renderCheckReport — ZTB-2 origin suffix', () => {
  test('a finding with origin gets a dim " — path:line" suffix, project-root-relative', () => {
    const out = renderCheckReport(result([{ code: 'evidence_commit_not_found', severity: 'error', message: 'm', issueId: 'A-1', origin: { path: '/repo/.volter/tracker/markdown/A-1.md', line: 12 } }]), { projectRoot: '/repo' });
    expect(out).toContain('evidence_commit_not_found — .volter/tracker/markdown/A-1.md:12');
  });

  test('a finding with origin but no line prints just the path (no trailing colon)', () => {
    const out = renderCheckReport(result([{ code: 'evidence_commit_not_found', severity: 'error', message: 'm', issueId: 'A-1', origin: { path: '/repo/.volter/tracker/markdown/A-1.md' } }]), { projectRoot: '/repo' });
    expect(out).toContain('evidence_commit_not_found — .volter/tracker/markdown/A-1.md\n');
  });

  test('a finding without origin renders with no suffix at all', () => {
    const out = renderCheckReport(result([{ code: 'evidence_commit_not_found', severity: 'error', message: 'm', issueId: 'A-1' }]), { projectRoot: '/repo' });
    expect(out).toContain('evidence_commit_not_found\n');
    expect(out).not.toContain('—');
  });

  test('without a projectRoot, the absolute origin path renders as-is (still additive, just unrelativized)', () => {
    const out = renderCheckReport(result([{ code: 'c', severity: 'error', message: 'm', issueId: 'A-1', origin: { path: '/repo/.volter/tracker/markdown/A-1.md' } }]));
    expect(out).toContain('c — /repo/.volter/tracker/markdown/A-1.md');
  });
});
