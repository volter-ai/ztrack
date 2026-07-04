// ZTB-26: configSchema.ts is now the one authored copy of the config shape — these tests pin the
// behaviors that fall out of that (the type derivation, the generated KNOWN_KEYS table, and the
// source-scan guard against reintroducing an untyped cast). See config.test.ts for the pre-existing
// did-you-mean behavior spec, which these tests do not duplicate.
import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KNOWN_KEYS, parseTrackerConfig } from './configSchema.ts';

describe('CategoriesSchema — z.partialRecord(RULE_CATEGORIES) (ZTB-26 dev/01)', () => {
  test('every real category name still validates (unchanged from before the partialRecord switch)', () => {
    expect(() => parseTrackerConfig({
      backend: 'markdown',
      organization: { check: { categories: { sourced: 1, code: 2, visual: 3, behavioral: 0, wellformed: 1 } } },
    })).not.toThrow();
  });

  test('an unknown category name now fails closed (deliberate behavior change — was silently accepted before)', () => {
    expect(() => parseTrackerConfig({
      backend: 'markdown',
      organization: { check: { categories: { bogus: 1 } } },
    })).toThrow(/organization\.check\.categories/);
  });

  test('the same enforcement applies to organization.check.verify[].categories', () => {
    expect(() => parseTrackerConfig({
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

describe('no untyped casts on config reads (ZTB-26 dev/03)', () => {
  // The exact hatches ZTB-26 closes: `JSON.parse(...) as TrackerConfig` (importDriver.ts,
  // pre-fix) and `JSON.parse(...) as Partial<TrackerConfig>` (config.ts, pre-fix) both skip
  // TrackerConfigSchema validation entirely while still claiming a typed result. Banning the
  // concrete cast forms (not a blanket `as any` ban — out of scope) makes reintroducing that
  // pattern a test failure instead of a silent regression. `RawTrackerConfig` is banned too:
  // it's the schema-derived raw shape, and casting to it is the same hatch one type-name over.
  const REPO = resolve(import.meta.dir, '..');
  const BANNED_CAST = /\bas\s+(Partial<)?(TrackerConfig|RawTrackerConfig)>?\b/;

  // Blank out comment bodies (keeping line breaks, so reported line numbers stay accurate) before
  // scanning: the ban is on actual cast EXPRESSIONS, not on this very file's own explanatory prose
  // quoting the banned pattern in backticks. Not string-literal-aware, but no string literal in
  // this repo contains `//` or `/*` immediately followed by the banned phrase.
  function stripComments(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/.*$/gm, '');
  }

  function violationsIn(globPattern: string): string[] {
    const violations: string[] = [];
    for (const file of new Glob(globPattern).scanSync({ cwd: resolve(REPO, 'src'), onlyFiles: true })) {
      if (file.endsWith('.test.ts')) continue;
      const text = stripComments(readFileSync(resolve(REPO, 'src', file), 'utf8'));
      text.split('\n').forEach((line, i) => {
        if (BANNED_CAST.test(line)) violations.push(`src/${file}:${i + 1}: ${line.trim()}`);
      });
    }
    return violations;
  }

  test('no src/**/*.ts (excluding *.test.ts) casts to TrackerConfig/Partial<TrackerConfig>/RawTrackerConfig', () => {
    expect(violationsIn('**/*.ts')).toEqual([]);
  });

  test('guard sanity: the banned regex actually matches the two forms this AC fixed (proves the guard is not vacuous)', () => {
    expect(BANNED_CAST.test("const raw = JSON.parse(x) as TrackerConfig;")).toBe(true);
    expect(BANNED_CAST.test("raw = JSON.parse(x) as Partial<TrackerConfig>;")).toBe(true);
    expect(BANNED_CAST.test("const raw = x as RawTrackerConfig;")).toBe(true);
    // Not banned: the schema/type declarations themselves, and unrelated identifiers.
    expect(BANNED_CAST.test("export const TrackerConfigSchema = z.object({")).toBe(false);
    expect(BANNED_CAST.test("export type TrackerConfig = Omit<RawTrackerConfig, 'backend'>")).toBe(false);
  });
});
