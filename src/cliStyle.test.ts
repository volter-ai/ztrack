import { describe, expect, test } from 'bun:test';
import { renderCheckReport } from './cliStyle.ts';

describe('CLI human renderer', () => {
  test('renders a grouped failing check report instead of raw JSON', () => {
    const text = renderCheckReport({
      ok: false,
      export: { issues: [{ id: 'LOCAL-1', title: 't', summary: '', status: 'open', acceptanceCriteria: [] }] },
      findings: [
        { severity: 'error', code: 'checked_ac_commit_hash_missing', issueId: 'LOCAL-1', message: 'Checked AC ac/01 cites missing commit deadbee.' },
        { severity: 'error', code: 'checked_ac_unknown_evidence', issueId: 'LOCAL-1', message: 'Checked AC ac/01 cites unknown evidence E1.' },
      ],
    });

    expect(text).toContain('ztrack check failed');
    expect(text).toContain('issues 1');
    expect(text).toContain('LOCAL-1');
    expect(text).toContain('checked_ac_commit_hash_missing');
    expect(text).toContain('produce evidence');
    expect(text).not.toContain('"summary"');
  });
});
