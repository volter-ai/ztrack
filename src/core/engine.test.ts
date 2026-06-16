import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { check } from './engine.ts';

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
});
