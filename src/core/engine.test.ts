import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { check, checkRoot, type Preset } from './engine.ts';

const RootSchema = z.object({ issues: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), status: z.string(), acceptanceCriteria: z.array(z.object({ id: z.string(), status: z.string(), evidence: z.array(z.object({ id: z.string() })) })) })) }).strict();
type R = z.infer<typeof RootSchema>;
const emptyIssue = { id: 'A-1', title: 't', summary: '', status: 'open', acceptanceCriteria: [] };

describe('check() runner', () => {
  test('a rule that throws becomes a finding, not a crash (public extension point)', () => {
    const preset = {
      name: 'throwy',
      schema: z.object({ issues: z.array(z.any()) }),
      parse: () => ({ issues: [] }),
      rules: [{ name: 'boom', run: () => { throw new Error('kaboom'); } }],
      primitives: {},
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = check(preset as any, 'anything');
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.code).toBe('rule_threw');
    expect(result.findings[0]?.message).toContain('boom');
    expect(result.findings[0]?.message).toContain('kaboom');
  });

  test('rules receive the validated ValidationInput { context, root }', () => {
    let seenInput: unknown;
    const preset: Preset<R> = {
      name: 'spy', schema: RootSchema, parse: () => ({ issues: [emptyIssue] }),
      rules: [{ name: 'spy', run: (input) => { seenInput = input; return []; } }],
    };
    const result = check(preset, 'x', { now: '2026-01-01', git: { existingCommits: ['abc'] } });
    expect(result.ok).toBe(true);
    expect((seenInput as { root: R }).root.issues[0]?.id).toBe('A-1');
    expect((seenInput as { context: { now?: string } }).context.now).toBe('2026-01-01');
  });

  test('an unknown context key is rejected by the strict ValidationInputSchema', () => {
    const preset: Preset<R> = { name: 'p', schema: RootSchema, parse: () => ({ issues: [] }), rules: [] };
    // @ts-expect-error — bogus context field must not be accepted
    const result = check(preset, 'x', { bogus: true });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === 'wellformed_shape')).toBe(true);
  });

  test('checkRoot validates an already-parsed root and flags a bad shape', () => {
    const preset: Preset<R> = { name: 'p', schema: RootSchema, parse: () => ({ issues: [] }), rules: [] };
    expect(checkRoot(preset, { issues: [emptyIssue] }).ok).toBe(true);
    const bad = checkRoot(preset, { cases: [] });
    expect(bad.ok).toBe(false);
    expect(bad.findings[0]?.code).toBe('root_shape_invalid');
  });

  test('categories selector skips rules deeper than requested; invariants always run', () => {
    const preset: Preset<R> = {
      name: 'p', schema: RootSchema, parse: () => ({ issues: [emptyIssue] }),
      rules: [
        { name: 'inv', run: () => [{ code: 'inv', severity: 'warning', message: 'i' }] },
        { name: 'deep', category: 'code', depth: 3, run: () => [{ code: 'deep', severity: 'warning', message: 'd' }] },
        { name: 'shallow', category: 'code', depth: 1, run: () => [{ code: 'shallow', severity: 'warning', message: 's' }] },
      ],
    };
    const codes = check(preset, 'x', { categories: { code: 1 } }).findings.map((f) => f.code).sort();
    expect(codes).toEqual(['inv', 'shallow']);
  });
});
