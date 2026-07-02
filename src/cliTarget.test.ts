// The target classifier is fiddly pure logic (file-vs-id, precedence, ambiguity rejection) and
// the home of the old false-green footgun (a dropped positional silently checked nothing), so it
// earns a unit test. The file/loop/sync FLOWS are covered by the live e2e, not here.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { looksLikeIssueId, positionalArgs, resolveTarget } from './cliTarget.ts';

const cwd = '/nonexistent-cwd';

describe('looksLikeIssueId', () => {
  test('accepts every id shape the backend mints or serves, including letter suffixes', () => {
    expect(looksLikeIssueId('ZL-A9')).toBe(true);   // backend-minted-shaped id with a letter suffix
    expect(looksLikeIssueId('ZTA-1')).toBe(true);   // multi-letter team key, numeric suffix
    expect(looksLikeIssueId('PH-12')).toBe(true);   // plain numeric suffix (the common case)
  });
  test('rejects a dot-bearing token (still fails the CLI grammar, unlike the backend\'s looser SAFE_ID)', () => {
    expect(looksLikeIssueId('A.1-5')).toBe(false);
  });
});

describe('positionalArgs', () => {
  test('skips flags and the values of value-taking flags', () => {
    expect(positionalArgs(['ZT-1', '--issues', 'a,b', '--json', './x.md'], new Set(['--issues']))).toEqual(['ZT-1', './x.md']);
  });
  test('handles --flag=value and lone boolean flags', () => {
    expect(positionalArgs(['--phase=gate', 'ZT-2', '--verify-commits'], new Set(['--phase']))).toEqual(['ZT-2']);
  });
});

describe('resolveTarget', () => {
  test('a bare invocation is the whole tracker', () => {
    expect(resolveTarget({ positionals: [], cwd })).toEqual({ kind: 'all' });
  });
  test('--auto-scope forces the auto (gate) target', () => {
    expect(resolveTarget({ positionals: [], forceAuto: true, cwd })).toEqual({ kind: 'auto' });
  });
  test('a bare run inside a worktree that maps to an issue auto-scopes', () => {
    expect(resolveTarget({ positionals: [], inWorktreeIssue: true, cwd })).toEqual({ kind: 'auto' });
  });
  test('an issue-id positional resolves to that issue', () => {
    expect(resolveTarget({ positionals: ['ZT-1'], cwd })).toEqual({ kind: 'issues', ids: ['ZT-1'] });
  });
  test('a letter-suffixed issue id, as the backend mints/serves (ZL-A9, ZTA-1, PH-12), resolves to that issue', () => {
    expect(resolveTarget({ positionals: ['ZL-A9'], cwd })).toEqual({ kind: 'issues', ids: ['ZL-A9'] });
    expect(resolveTarget({ positionals: ['ZTA-1'], cwd })).toEqual({ kind: 'issues', ids: ['ZTA-1'] });
    expect(resolveTarget({ positionals: ['PH-12'], cwd })).toEqual({ kind: 'issues', ids: ['PH-12'] });
  });
  test('a dot-bearing token still fails the CLI grammar (file detection wins first; the rejection message is unchanged)', () => {
    expect(() => resolveTarget({ positionals: ['A.1-5'], cwd })).toThrow(/neither an issue id .* nor a markdown file/);
  });
  test('--issues feeds the issues target when no positional is given', () => {
    expect(resolveTarget({ positionals: [], issuesFlag: ['A-1', 'A-2'], cwd })).toEqual({ kind: 'issues', ids: ['A-1', 'A-2'] });
  });
  test('a .md / path-shaped positional is a file', () => {
    expect(resolveTarget({ positionals: ['./body.md'], cwd })).toEqual({ kind: 'file', path: './body.md' });
    expect(resolveTarget({ positionals: ['sub/dir/issue.md'], cwd })).toEqual({ kind: 'file', path: 'sub/dir/issue.md' });
  });
  test('an existing file (no .md suffix) is still a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tgt-'));
    writeFileSync(join(dir, 'NOTES'), 'x');
    expect(resolveTarget({ positionals: ['NOTES'], cwd: dir })).toEqual({ kind: 'file', path: 'NOTES' });
  });
  test('the FOOTGUN: an ambiguous token (neither file nor id) is rejected, not silently ignored', () => {
    expect(() => resolveTarget({ positionals: ['banana'], cwd })).toThrow(/neither an issue id .* nor a markdown file/);
  });
  test('refuses more than one file target', () => {
    expect(() => resolveTarget({ positionals: ['a.md', 'b.md'], cwd })).toThrow(/single file at a time/);
  });
});
