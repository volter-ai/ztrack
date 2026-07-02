import { describe, expect, test } from 'bun:test';
import { renderCheckReport } from './cliStyle.ts';
import type { CheckResult, CoreRoot, Finding } from './core/engine.ts';

// NO_COLOR keeps the rendered lines plain so the suffix is easy to match exactly.
process.env.NO_COLOR = '1';

const result = (findings: Finding[]): CheckResult<CoreRoot> => ({ ok: !findings.some((f) => f.severity === 'error'), findings });

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
