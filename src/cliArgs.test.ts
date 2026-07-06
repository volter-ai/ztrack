import { describe, expect, test } from 'bun:test';
import { optionValue, optionValues, splitSelectors } from './cliArgs.ts';

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

// ZTB-40: `optionValues` — the repeatable sibling of `optionValue`. Every occurrence, in order,
// both the space form and the `=` form; the same next-token/`--`-guard behavior as `optionValue`.
describe('optionValues', () => {
  test('collects every "--flag value" occurrence, in order', () => {
    expect(optionValues(['--source', 'a', '--source', 'b'], '--source')).toEqual(['a', 'b']);
  });
  test('collects every "--flag=value" occurrence, in order', () => {
    expect(optionValues(['--source=a', '--source=b'], '--source')).toEqual(['a', 'b']);
  });
  test('mixes the space form and the "=" form in encounter order', () => {
    expect(optionValues(['--source', 'a', '--source=b', '--source', 'c'], '--source')).toEqual(['a', 'b', 'c']);
  });
  test('an absent flag returns an empty array', () => {
    expect(optionValues(['--other', 'x'], '--source')).toEqual([]);
  });
  test('a trailing flag with no value contributes nothing (does not consume the next flag)', () => {
    expect(optionValues(['--source', '--other', 'x'], '--source')).toEqual([]);
  });
  test('a negative-number value is still read (not treated as a flag)', () => {
    expect(optionValues(['--source', '-5'], '--source')).toEqual(['-5']);
  });
});

// ZTB-40: `splitSelectors` — the one `--source` grammar shared by `check`/`export` and `issue
// list`. Every occurrence may itself be comma-separated; occurrences and comma-parts union,
// order-preserving, deduped, empties dropped.
describe('splitSelectors', () => {
  test('a single occurrence with no comma passes through unchanged', () => {
    expect(splitSelectors(['alpha'])).toEqual(['alpha']);
  });
  test('splits one comma-separated occurrence into its parts', () => {
    expect(splitSelectors(['alpha,beta'])).toEqual(['alpha', 'beta']);
  });
  test('unions two repeated (non-comma) occurrences', () => {
    expect(splitSelectors(['alpha', 'beta'])).toEqual(['alpha', 'beta']);
  });
  test('unions occurrences that are themselves comma-separated', () => {
    expect(splitSelectors(['alpha', 'beta,gamma'])).toEqual(['alpha', 'beta', 'gamma']);
  });
  test('dedupes across occurrences/parts, keeping first-seen order', () => {
    expect(splitSelectors(['alpha', 'beta,alpha'])).toEqual(['alpha', 'beta']);
  });
  test('trims whitespace around comma-separated parts', () => {
    expect(splitSelectors([' alpha , beta '])).toEqual(['alpha', 'beta']);
  });
  test('drops empty parts (leading/trailing/doubled commas)', () => {
    expect(splitSelectors([',alpha,,beta,'])).toEqual(['alpha', 'beta']);
  });
  test('an empty input array yields an empty selector list', () => {
    expect(splitSelectors([])).toEqual([]);
  });
});
