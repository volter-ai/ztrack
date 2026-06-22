import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMarkdownFiles, loadBundledPreset } from './checkFile.ts';

function gitRepo(): { root: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), 'ztcf-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: root });
  g('init', '-q');
  g('config', 'user.email', 'u@x.com');
  g('config', 'user.name', 'u');
  writeFileSync(join(root, 'app.txt'), 'hi');
  g('add', '-A');
  g('commit', '-q', '-m', 'initial');
  return { root, sha: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim() };
}

const issueMd = (commit: string) =>
  `# Add /health endpoint\n\n## Acceptance Criteria\n\n- [x] dev/01 status: passed GET /health returns 200. commit: ${commit} [E1]\n\n## Evidence\n\n- [E1] type: pr ac: dev/01 repo: org/repo number: 1 head: main justification: PR adds it.\n`;

describe('zero-config check <file.md> with the bundled basic preset', () => {
  test('the bundled preset compiles in-process (no on-disk install)', () => {
    const preset = loadBundledPreset('basic');
    expect(typeof preset.rules === 'object' || Array.isArray(preset.rules)).toBe(true);
  });

  test('a real cited commit passes; a fabricated one fails on commit existence', async () => {
    const { root, sha } = gitRepo();

    const good = join(root, 'good.md');
    writeFileSync(good, issueMd(sha));
    const okResult = await checkMarkdownFiles([good], { projectRoot: root });
    expect(okResult.ok).toBe(true);
    expect(okResult.findings).toEqual([]);

    const bad = join(root, 'bad.md');
    writeFileSync(bad, issueMd('deadbeef'));
    const badResult = await checkMarkdownFiles([bad], { projectRoot: root });
    expect(badResult.ok).toBe(false);
    // the ONLY error is the fabricated commit — not assignee/metadata noise on a lone file
    const errors = badResult.findings.filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('basic_checked_ac_commit_hash_missing');
  });

  test('a checked AC with no evidence and no commit fails (the core value prop)', async () => {
    const { root } = gitRepo();
    const f = join(root, 'bare.md');
    writeFileSync(f, '# Bare claim\n\n## Acceptance Criteria\n\n- [x] dev/01 status: passed It works.\n\n## Evidence\n');
    const result = await checkMarkdownFiles([f], { projectRoot: root });
    expect(result.ok).toBe(false);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('basic_checked_ac_missing_commit_hash');
    expect(codes).toContain('basic_checked_ac_missing_evidence');
  });
});
