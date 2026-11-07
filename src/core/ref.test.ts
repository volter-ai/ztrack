import { describe, expect, test } from 'bun:test';
import { BlockRefSchema, findingId, formatRef, refSegments } from './ref.ts';

describe('universal id (formatRef)', () => {
  test('addresses each level as a colon-delimited path', () => {
    expect(formatRef({ issue: 'APP-1' })).toBe('APP-1');
    expect(formatRef({ issue: 'APP-1', ac: 'dev/01' })).toBe('APP-1:dev/01');
    expect(formatRef({ issue: 'APP-1', ac: 'dev/01', evidence: 'E1' })).toBe('APP-1:dev/01:E1');
    expect(formatRef({ issue: 'APP-1', ac: 'dev/01', proof: true })).toBe('APP-1:dev/01:proof');
  });

  test('proof leaf wins over an evidence segment when both are set', () => {
    expect(formatRef({ issue: 'APP-1', ac: 'dev/01', evidence: 'E1', proof: true })).toBe('APP-1:dev/01:proof');
  });

  test("findingId composes the path from a finding's id parts", () => {
    expect(findingId({ code: 'x', severity: 'error', message: 'm', issueId: 'APP-1', acId: 'dev/01', evidenceId: 'E1' })).toBe('APP-1:dev/01:E1');
    expect(findingId({ code: 'x', severity: 'error', message: 'm', issueId: 'APP-1' })).toBe('APP-1');
    expect(findingId({ code: 'x', severity: 'error', message: 'm' })).toBeUndefined();
  });

  test('refSegments splits and trims', () => {
    expect(refSegments('APP-1:dev/01')).toEqual(['APP-1', 'dev/01']);
    expect(refSegments(' APP-2 : dev/01 ')).toEqual(['APP-2', 'dev/01']);
  });
});

describe('BlockRefSchema', () => {
  test('accepts an issue ref (no ac) and an AC ref; strict about extras/empties', () => {
    expect(BlockRefSchema.safeParse({ issue: 'APP-1' }).success).toBe(true);
    expect(BlockRefSchema.safeParse({ issue: 'APP-1', ac: 'dev/01' }).success).toBe(true);
    expect(BlockRefSchema.safeParse({ issue: 'APP-1', ac: 'dev/01', extra: 1 }).success).toBe(false);
    expect(BlockRefSchema.safeParse({ issue: '' }).success).toBe(false);
  });
});
