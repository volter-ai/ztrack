import { describe, expect, test } from 'bun:test';
import { identifierFromCreateOutput } from './sdk.ts';

describe('identifierFromCreateOutput — backend-agnostic create parsing', () => {
  test('local backend format "<id>\\t<title>"', () => {
    expect(identifierFromCreateOutput('PH-1\tHello world')).toBe('PH-1');
  });
  test('markdown backend format (pretty-printed JSON issue)', () => {
    expect(identifierFromCreateOutput(JSON.stringify({ identifier: 'PH-2', title: 'Hi' }, null, 2))).toBe('PH-2');
  });
  test('bare identifier', () => {
    expect(identifierFromCreateOutput('PH-3\n')).toBe('PH-3');
  });
});
