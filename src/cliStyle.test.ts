import { describe, expect, test } from 'bun:test';
import { renderCheckReport } from './cliStyle.ts';

describe('CLI human renderer', () => {
  test('renders a grouped failing check report instead of raw JSON', () => {
    const text = renderCheckReport({
      valid: false,
      summary: { cases: 1, openCases: 1, errors: 2, warnings: 0, status: 'fail' },
      findings: [
        { level: 'error', code: 'checked_ac_commit_hash_missing', issue: 'LOCAL-1', message: 'Checked AC ac/01 cites missing commit deadbee.' },
        { level: 'error', code: 'checked_ac_unknown_evidence', issue: 'LOCAL-1', message: 'Checked AC ac/01 cites unknown evidence E1.' },
      ],
    });

    expect(text).toContain('ztrack check failed');
    expect(text).toContain('cases 1');
    expect(text).toContain('LOCAL-1');
    expect(text).toContain('checked_ac_commit_hash_missing');
    expect(text).toContain('produce evidence');
    expect(text).not.toContain('"summary"');
  });
});
