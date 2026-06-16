import { describe, expect, test } from 'bun:test';
import { optionValue } from './cliArgs.ts';

describe('optionValue', () => {
  test('reads a normal "--flag value"', () => {
    expect(optionValue(['--title', 'Hello'], '--title')).toBe('Hello');
  });
  test('supports "--flag=value"', () => {
    expect(optionValue(['--title=Hello world'], '--title')).toBe('Hello world');
  });
  test('does NOT consume a following flag as the value (returns fallback)', () => {
    expect(optionValue(['--commit', '--evidence', 'E1'], '--commit', 'FB')).toBe('FB');
  });
  test('a missing flag returns the fallback', () => {
    expect(optionValue(['--other', 'x'], '--title', 'FB')).toBe('FB');
  });
  test('a flag at the end with no value returns the fallback', () => {
    expect(optionValue(['--title'], '--title', 'FB')).toBe('FB');
  });
  test('a negative-number value is still read (not treated as a flag)', () => {
    expect(optionValue(['--limit', '-5'], '--limit')).toBe('-5');
  });
});
