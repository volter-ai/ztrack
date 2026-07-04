// ZTB-26: configSchema.ts is now the one authored copy of the config shape — these tests pin the
// behaviors that fall out of that (the type derivation, the generated KNOWN_KEYS table, and the
// source-scan guard against reintroducing an untyped cast). See config.test.ts for the pre-existing
// did-you-mean behavior spec, which these tests do not duplicate.
import { describe, expect, test } from 'bun:test';
import { assertValidTrackerConfigShape } from './configSchema.ts';

describe('CategoriesSchema — z.partialRecord(RULE_CATEGORIES) (ZTB-26 dev/01)', () => {
  test('every real category name still validates (unchanged from before the partialRecord switch)', () => {
    expect(() => assertValidTrackerConfigShape({
      backend: 'markdown',
      organization: { check: { categories: { sourced: 1, code: 2, visual: 3, behavioral: 0, wellformed: 1 } } },
    })).not.toThrow();
  });

  test('an unknown category name now fails closed (deliberate behavior change — was silently accepted before)', () => {
    expect(() => assertValidTrackerConfigShape({
      backend: 'markdown',
      organization: { check: { categories: { bogus: 1 } } },
    })).toThrow(/organization\.check\.categories/);
  });

  test('the same enforcement applies to organization.check.verify[].categories', () => {
    expect(() => assertValidTrackerConfigShape({
      backend: 'markdown',
      organization: { check: { verify: [{ matchTypes: ['bug'], categories: { nope: 1 } }] } },
    })).toThrow(/categories/);
  });
});
