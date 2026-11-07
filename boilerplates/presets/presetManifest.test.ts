import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guards the convention `config.ts`'s `presetManifest()` relies on: each preset is a `<name>.ts`
// boilerplate plus a `<name>.json` sidecar (description + optional aliases/recommended). Scans the
// dir independently so adding a preset can't silently skip its manifest — the thing that broke the
// visualizer when `default.ts` was renamed without updating every reference.
const DIR = import.meta.dir;
const presetNames = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => f.slice(0, -'.ts'.length));
const sidecar = (name: string) =>
  JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as { description?: string; aliases?: string[]; recommended?: boolean };

describe('preset manifest', () => {
  test('every preset .ts has a .json sidecar with a non-empty description', () => {
    for (const name of presetNames) {
      expect(existsSync(join(DIR, `${name}.json`))).toBe(true);
      const meta = sidecar(name);
      expect(typeof meta.description).toBe('string');
      expect(meta.description!.trim().length).toBeGreaterThan(0);
    }
  });

  test('every .json sidecar has a matching preset .ts', () => {
    const jsons = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length));
    for (const j of jsons) expect(presetNames).toContain(j);
  });

  test('exactly one preset is marked recommended', () => {
    expect(presetNames.filter((n) => sidecar(n).recommended).length).toBe(1);
  });

  test('aliases are unique and do not collide with preset names', () => {
    const names = new Set(presetNames);
    const aliases = presetNames.flatMap((n) => sidecar(n).aliases ?? []);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const a of aliases) expect(names.has(a)).toBe(false);
  });

  test("each preset's exported `name` matches its filename", async () => {
    for (const name of presetNames) {
      const mod = (await import(join(DIR, `${name}.ts`))) as { default?: { name?: string } };
      expect(mod.default?.name).toBe(name);
    }
  });
});
