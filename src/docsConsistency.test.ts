import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Guards the doc-drift classes that bit us repeatedly: a doc linking a moved/deleted page, a doc
// citing a `boilerplates/presets/<name>.ts` that was renamed away, or a `--preset <name>` that
// isn't a real preset/alias. The fix for each was always "edit N scattered docs and miss one" —
// this catches the miss in CI. CHANGELOG is excluded (historical; it names docs as they were).
const REPO = resolve(import.meta.dir, '..');
const DOCS = [
  'README.md', 'PRESET-GUIDE.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'boilerplates/README.md',
  ...readdirSync(join(REPO, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
];

// Valid `--preset` tokens = preset filenames + their declared aliases (from the sidecars) + the
// `<name>` placeholder. Same source `presetManifest()` reads, computed independently here.
const presetDir = join(REPO, 'boilerplates/presets');
const presetNames = readdirSync(presetDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => f.slice(0, -3));
const aliases = presetNames.flatMap((n) => {
  const j = join(presetDir, `${n}.json`);
  return existsSync(j) ? (JSON.parse(readFileSync(j, 'utf8')).aliases ?? []) : [];
});
const validPresetTokens = new Set([...presetNames, ...aliases, '<name>']);

describe('docs consistency', () => {
  test('every relative markdown/HTML link resolves to a real file', () => {
    const broken: string[] = [];
    for (const doc of DOCS) {
      const text = readFileSync(join(REPO, doc), 'utf8');
      const targets = [
        ...[...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!),       // [text](target)
        ...[...text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!),       // <a href="target">
      ];
      for (const raw of targets) {
        const target = raw.split('#')[0]!.trim();                        // drop #anchor
        if (!target || /^(https?:|mailto:)/.test(target)) continue;      // external / anchor-only
        if (!existsSync(resolve(REPO, dirname(doc), target))) broken.push(`${doc} -> ${raw}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('every cited boilerplates/presets/<name>.ts exists', () => {
    const missing: string[] = [];
    for (const doc of DOCS) {
      const text = readFileSync(join(REPO, doc), 'utf8');
      // Handle both `…/<name>.ts` and brace-expansion `…/{a,b,c}.ts` (the form that slipped past
      // the first version of this guard and let ARCHITECTURE.md cite a renamed `default.ts`).
      for (const m of text.matchAll(/boilerplates\/presets\/(\{[a-z0-9,-]+\}|[a-z][a-z0-9-]*)\.ts/g)) {
        const names = m[1]!.startsWith('{') ? m[1]!.slice(1, -1).split(',') : [m[1]!];
        for (const n of names) if (!existsSync(join(presetDir, `${n}.ts`))) missing.push(`${doc} -> boilerplates/presets/${n}.ts`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('every backtick-cited src/**/*.ts path exists', () => {
    const missing: string[] = [];
    for (const doc of DOCS.concat('TESTING.md')) {
      const text = readFileSync(join(REPO, doc), 'utf8');
      for (const m of text.matchAll(/`(src\/[a-zA-Z0-9/_.-]+\.ts)`/g)) {
        if (!existsSync(join(REPO, m[1]!))) missing.push(`${doc} -> ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('every documented `ztrack <command>` is a real CLI command', () => {
    // Valid commands extracted from the dispatch (cli.ts + handle* modules + resource-help) — no
    // hardcoded list, so it stays in sync. Catches a documented-but-removed command (e.g. the
    // phantom `snapshot project-manager` the architecture review found).
    const cliSrc = ['src/cli.ts', 'src/cliCheck.ts', 'src/cliEvidence.ts', 'src/cliCompletions.ts', 'src/cliHelp.ts', 'src/cliInit.ts', 'src/cliLoop.ts', 'src/cliWaiver.ts']
      .map((f) => readFileSync(join(REPO, f), 'utf8')).join('\n');
    const commands = new Set([
      ...[...cliSrc.matchAll(/args\[0\]\s*[=!]==\s*'([a-z][a-z-]*)'/g)].map((m) => m[1]!),
      ...[...cliSrc.matchAll(/resource === '([a-z][a-z-]*)'/g)].map((m) => m[1]!),
    ]);
    const unknown: string[] = [];
    for (const doc of DOCS) {
      const text = readFileSync(join(REPO, doc), 'utf8');
      // Only inside inline-code / fenced-code spans, and only where `ztrack` is the INVOKED command
      // (line-start or after `npx`/`$ `) — so `cd ztrack` or prose "add ztrack to …" isn't flagged.
      const spans = [...text.matchAll(/`[^`\n]+`/g), ...text.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
      for (const span of spans) {
        for (const m of span.matchAll(/(?:^|npx |\$ )ztrack[ \t]+([a-z][a-z-]+)/gm)) {
          if (!commands.has(m[1]!)) unknown.push(`${doc} -> ztrack ${m[1]}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  test('every `--preset <name>` in docs names a real preset or alias', () => {
    const unknown: string[] = [];
    for (const doc of DOCS) {
      const text = readFileSync(join(REPO, doc), 'utf8');
      for (const m of text.matchAll(/--preset\s+([^\s`)]+)/g)) {
        const tok = m[1]!;
        if (tok.startsWith('<') || tok.includes('|')) continue; // `<name>` placeholder / `a|b|c` enum-example
        if (!validPresetTokens.has(tok)) unknown.push(`${doc} -> --preset ${tok}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
