// ZTB-26: configSchema.ts is now the one authored copy of the config shape — these tests pin the
// behaviors that fall out of that (the type derivation, the generated KNOWN_KEYS table, and the
// source-scan guard against reintroducing an untyped cast). See config.test.ts for the pre-existing
// did-you-mean behavior spec, which these tests do not duplicate.
import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
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

  // Review round 1 caught the raw rejection surfacing as zod's bare "Invalid key in record" —
  // fail-closed but cryptic, and inconsistent with every other key typo in the same config file.
  // The candidates come from the invalid_key issue's own nested values (see describeIssue), so
  // this costs no new hand-synced vocabulary table.
  test('a typo\'d category key gets the same did-you-mean treatment as any other unknown key', () => {
    expect(() => parseTrackerConfig({
      backend: 'markdown',
      organization: { check: { categories: { behavorial: 2 } } },
    })).toThrow(/unknown key "behavorial" at "organization\.check\.categories" — did you mean "behavioral"\?/);
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
    'sources[]': ['path', 'format', 'readonly', 'name'],
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
  //
  // The scan parses each file with the TypeScript compiler and walks the AST, after review round 1
  // proved a line-regex guard trivially evadable four ways: `as (TrackerConfig)`,
  // `as import('./types.ts').TrackerConfig`, a cast split across two lines, and a comment-stripper
  // that ate real code whenever a string literal on the same line contained `//`. Against the AST
  // those are non-events — comments and strings never reach the scanner, a cast is a node (not a
  // line), and the banned names are matched anywhere inside the asserted TYPE (so
  // `Partial<TrackerConfig>`, parenthesized/import()-qualified forms, `as unknown as TrackerConfig`
  // chains, and object types embedding them are all one code path). `satisfies` stays legal: it
  // type-checks against the schema-derived type instead of overriding it.
  //
  // Known residual, by design: matching is name-based, so deliberately laundering the cast through
  // an alias (`type TC = TrackerConfig; x as TC`, a renamed import, `ReturnType<typeof ...>`)
  // evades the scan. The guard targets accidental reintroduction of the pattern, not an author
  // determined to circumvent it — no static name scan can win that game (`as any` is likewise out
  // of scope, per the AC).
  const REPO = resolve(import.meta.dir, '..');
  const CONFIG_TYPE_NAMES = new Set(['TrackerConfig', 'RawTrackerConfig']);

  function typeMentionsConfigType(root: ts.TypeNode): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
      if (found) return;
      if (ts.isTypeReferenceNode(n)) {
        const name = ts.isQualifiedName(n.typeName) ? n.typeName.right.text : n.typeName.text;
        if (CONFIG_TYPE_NAMES.has(name)) { found = true; return; }
      }
      if (ts.isImportTypeNode(n) && n.qualifier) {
        const name = ts.isQualifiedName(n.qualifier) ? n.qualifier.right.text : n.qualifier.text;
        if (CONFIG_TYPE_NAMES.has(name)) { found = true; return; }
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
    return found;
  }

  function castViolations(sourceText: string, fileLabel: string): string[] {
    const sf = ts.createSourceFile(fileLabel, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const violations: string[] = [];
    const visit = (node: ts.Node): void => {
      const cast = ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) ? node : undefined;
      if (cast && typeMentionsConfigType(cast.type)) {
        const { line } = sf.getLineAndCharacterOfPosition(cast.getStart(sf));
        violations.push(`${fileLabel}:${line + 1}: ${cast.getText(sf).replace(/\s+/g, ' ')}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return violations;
  }

  function repoViolations(): string[] {
    const violations: string[] = [];
    for (const file of new Glob('**/*.ts').scanSync({ cwd: resolve(REPO, 'src'), onlyFiles: true })) {
      if (file.endsWith('.test.ts')) continue;
      violations.push(...castViolations(readFileSync(resolve(REPO, 'src', file), 'utf8'), `src/${file}`));
    }
    return violations;
  }

  test('no src/**/*.ts (excluding *.test.ts) casts to TrackerConfig/RawTrackerConfig in any syntactic form', () => {
    expect(repoViolations()).toEqual([]);
  });

  test('guard sanity: catches the two pre-fix hatches AND every review-round-1 evasion of the old regex guard', () => {
    // The forms this AC originally fixed:
    expect(castViolations('const raw = JSON.parse(x) as TrackerConfig;', 'fixture.ts')).toHaveLength(1);
    expect(castViolations('raw = JSON.parse(x) as Partial<TrackerConfig>;', 'fixture.ts')).toHaveLength(1);
    expect(castViolations('const raw = x as RawTrackerConfig;', 'fixture.ts')).toHaveLength(1);
    // Review round 1's proven evasions — each must now be caught:
    expect(castViolations('const sneaky = parsedJson as (TrackerConfig);', 'fixture.ts')).toHaveLength(1);
    expect(castViolations("const c = x as import('./types.ts').TrackerConfig;", 'fixture.ts')).toHaveLength(1);
    expect(castViolations('const c = x as\n  TrackerConfig;', 'fixture.ts')).toHaveLength(1);
    expect(castViolations('const url = "https://example.com"; const raw = JSON.parse(x) as TrackerConfig;', 'fixture.ts')).toHaveLength(1);
    // Forms the old regex never claimed to handle, free with the AST:
    expect(castViolations('const c = <TrackerConfig>x;', 'fixture.ts')).toHaveLength(1);
    expect(castViolations('const c = x as unknown as TrackerConfig;', 'fixture.ts')).toHaveLength(1);
    expect(castViolations('const c = x as { cfg: TrackerConfig };', 'fixture.ts')).toHaveLength(1);
    // NOT flagged: declarations, satisfies, comments, string literals, unrelated identifiers.
    expect(castViolations('export const TrackerConfigSchema = z.object({});', 'fixture.ts')).toHaveLength(0);
    expect(castViolations("export type TrackerConfig = Omit<RawTrackerConfig, 'backend'> & { backend: B };", 'fixture.ts')).toHaveLength(0);
    expect(castViolations('// prose mentioning `as TrackerConfig` stays prose', 'fixture.ts')).toHaveLength(0);
    expect(castViolations("const s = 'not a cast: as TrackerConfig';", 'fixture.ts')).toHaveLength(0);
    expect(castViolations('const cfg = raw satisfies TrackerConfig;', 'fixture.ts')).toHaveLength(0);
    expect(castViolations('const other = x as TrackerConfigSchemaShape;', 'fixture.ts')).toHaveLength(0);
  });
});
