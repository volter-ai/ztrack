// ZTB-26: configSchema.ts is now the one authored copy of the config shape — these tests pin the
// behaviors that fall out of that (the type derivation, the generated KNOWN_KEYS table, and the
// source-scan guard against reintroducing an untyped cast). See config.test.ts for the pre-existing
// did-you-mean behavior spec, which these tests do not duplicate.
import { describe, expect, test } from 'bun:test';
import { assertValidTrackerConfigShape, KNOWN_KEYS } from './configSchema.ts';

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

describe('KNOWN_KEYS — generated from TrackerConfigSchema (ZTB-26 dev/02)', () => {
  // The literal this repo carried by hand before dev/02 (src/configSchema.ts, pre-ZTB-26). Pinned
  // here as the expectation the generator must reproduce exactly — today's 11 entries, no more, no
  // fewer. A future schema change that adds/removes a nested object, array, or top-level field
  // must update this literal too — same "the fix is a diff, not a guessing game" contract
  // KNOWN_KEYS itself offers callers of `ztrack`.
  const EXPECTED_KNOWN_KEYS: Record<string, string[]> = {
    '': ['backend', 'local', 'sources', 'board', 'sync', 'evidence', 'relevance', 'validation', 'organization'],
    local: ['teamKey', 'database', 'store'],
    'sources[]': ['path', 'format', 'readonly'],
    sync: ['provider', 'repo', 'policy'],
    evidence: ['store', 'dir'],
    validation: ['entrypoint', 'installedFrom'],
    organization: ['validationPreset', 'externalBrowseUrls', 'caseTypeLabels', 'grammar', 'check', 'lint'],
    'organization.grammar': ['extends', 'slotAliases'],
    'organization.check': ['categories', 'profiles', 'verify'],
    'organization.check.verify[]': ['matchTypes', 'matchLabels', 'inspect', 'categories'],
    'organization.lint': ['rules'],
  };

  test('the generated map has exactly today\'s 11 entries, byte-identical to the pinned literal', () => {
    expect(KNOWN_KEYS).toEqual(EXPECTED_KNOWN_KEYS);
    expect(Object.keys(KNOWN_KEYS)).toHaveLength(11);
  });

  test('ZodRecord paths (organization.lint.rules, organization.check.categories, organization.externalBrowseUrls) are NOT enumerated — their keys are data, not schema vocabulary', () => {
    expect(KNOWN_KEYS['organization.lint.rules']).toBeUndefined();
    expect(KNOWN_KEYS['organization.check.categories']).toBeUndefined();
    expect(KNOWN_KEYS['organization.externalBrowseUrls']).toBeUndefined();
  });
});
