import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Guards the doc-drift classes that bit us repeatedly: a doc linking a moved/deleted page, a doc
// citing a `boilerplates/presets/<name>.ts` that was renamed away, or a `--preset <name>` that
// isn't a real preset/alias. The fix for each was always "edit N scattered docs and miss one" —
// this catches the miss in CI. CHANGELOG is excluded (historical; it names docs as they were).
const REPO = resolve(import.meta.dir, '..');
const DOCS = [
  'README.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'boilerplates/README.md', 'demos/README.md',
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
    const cliSrc = ['src/cli.ts', 'src/cliCheck.ts', 'src/cliEvidence.ts', 'src/cliCompletions.ts', 'src/cliHelp.ts', 'src/cliInit.ts', 'src/cliLoop.ts', 'src/cliWaiver.ts', 'src/cliImport.ts']
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

  // ZTB-25: PR #13 (0.38.0) made `@volter-ai-dev/twin`/`twin-github` OPTIONAL peer dependencies,
  // but the docs kept saying otherwise for a full release — the existence checks above (link,
  // path, command, preset-name) can't catch a doc that's internally consistent but semantically
  // wrong. This phrase list is exactly what dev/01 removed from README.md/docs/EVIDENCE.md/
  // src/presetKit.ts; a legitimate *negated* use (e.g. "not bundled into the CLI") would still
  // trip this on the same substring, so any doc restating the true story must avoid the literal
  // phrase, not just negate it (see docs/EVIDENCE.md's "does not ship inside the CLI's own
  // install" wording).
  test('no doc claims twin is bundled / a regular dependency (the pre-0.38 story)', () => {
    const stalePhrases = ['regular dependency', 'bundled into the cli'];
    const hits: string[] = [];
    for (const doc of DOCS) {
      const text = readFileSync(join(REPO, doc), 'utf8').toLowerCase();
      for (const phrase of stalePhrases) if (text.includes(phrase)) hits.push(`${doc} -> "${phrase}"`);
    }
    expect(hits).toEqual([]);
  });

  // ZTB-25: demos/README.md is prose, not derived from disk, so it silently fell behind as
  // scripts were added (5 of 10 documented; 3 of the missing 5 are actual CI/Publish gates —
  // check-e2e, loop-gate-ci, pm-matrix). Assert its inventory names every demos/*.sh on disk.
  test('demos/README.md inventories every demos/*.sh on disk', () => {
    const scripts = readdirSync(join(REPO, 'demos')).filter((f) => f.endsWith('.sh'));
    const readme = readFileSync(join(REPO, 'demos/README.md'), 'utf8');
    const missing = scripts.filter((f) => !readme.includes(`demos/${f}`));
    expect(missing).toEqual([]);
  });

  // ZTB-34: a full agent-docs audit + a cold-start agent run found three drift classes the
  // existence checks above can't see — docs teaching a REMOVED mechanism (`status: descoped` was
  // never a valid AC status in any shipped preset), teaching docs lagging a shipped philosophy
  // (0.46's ref-pinned waivers reached only ARCHITECTURE.md + --help for a full release), and a
  // new flag reaching only its own reference page (0.47's --source absent from GUIDE/API.md).
  // Same idea as the twin-dependency phrase pin above: semantic pins on load-bearing claims.
  test('no doc instructs the phantom `status: descoped` escape', () => {
    const hits: string[] = [];
    for (const doc of DOCS.concat('plugins/ztrack/README.md', '.claude/skills/ztrack/SKILL.md', 'plugins/ztrack/skills/ztrack/SKILL.md', 'TESTING.md', 'ROADMAP.md')) {
      const text = readFileSync(join(REPO, doc), 'utf8');
      if (text.includes('status: descoped')) hits.push(doc);
    }
    expect(hits).toEqual([]);
  });

  // The `ztrack` skill ships in the plugin (its canonical home — installed users receive it)
  // AND at .claude/skills for agents working on this repo itself. Two copies invite drift;
  // pin them byte-identical so an edit to one without the other fails here, not in a user's
  // session months later.
  test('the plugin skill and the repo-local skill are byte-identical (no drift)', () => {
    const plugin = readFileSync(join(REPO, 'plugins/ztrack/skills/ztrack/SKILL.md'), 'utf8');
    const local = readFileSync(join(REPO, '.claude/skills/ztrack/SKILL.md'), 'utf8');
    expect(local).toBe(plugin);
  });

  test('waiver teaching docs carry the 0.46 ref-pinning philosophy, not just the broad row', () => {
    // README/GUIDE point readers at PRESETS §Waivers as the "full grammar" — so PRESETS must
    // document all three 0.46 pieces, and every doc that teaches signing must at least name the
    // pin (`--ref`) so an agent isn't surprised by `waiver_overbroad` on an unpinned row. The
    // gate README's example must carry the required `--code` (its pre-fix example omitted it).
    const mustMention: Array<[string, string[]]> = [
      ['docs/PRESETS.md', ['ref:', 'waiver_overbroad', 'waiver migrate']],
      ['docs/GUIDE.md', ['--ref', 'waiver_overbroad']],
      ['README.md', ['--ref']],
      ['.claude/skills/ztrack/SKILL.md', ['--ref']],
      ['plugins/ztrack/skills/ztrack/SKILL.md', ['--ref']],
      ['plugins/ztrack/README.md', ['--code']],
    ];
    const missing: string[] = [];
    for (const [doc, needles] of mustMention) {
      const text = readFileSync(join(REPO, doc!), 'utf8');
      for (const n of needles!) if (!text.includes(n)) missing.push(`${doc} missing "${n}"`);
    }
    expect(missing).toEqual([]);
  });

  test('the GUIDE frontier paragraph and API.md TrackerCheckOptions know about --source (0.47)', () => {
    const missing: string[] = [];
    // GUIDE enumerates what composes with --actionable/--blocked and what's rejected; since
    // ZTB-33 the rejection list includes --source. Pin the literal rejection clause (round-2
    // review: a windowed regex matched an unrelated earlier --actionable mention with ~200
    // chars of slack — brittle both ways; the exact clause is what the doc must keep saying).
    const guide = readFileSync(join(REPO, 'docs/GUIDE.md'), 'utf8');
    if (!guide.includes('reject `--parent` and `--source`')) missing.push('docs/GUIDE.md frontier paragraph lost the `--parent`/`--source` rejection clause');
    const api = readFileSync(join(REPO, 'docs/API.md'), 'utf8');
    if (!/TrackerCheckOptions[^\n]*\bsources\?/.test(api)) missing.push('docs/API.md TrackerCheckOptions listing omits sources?');
    expect(missing).toEqual([]);
  });

  // ZTB-25: package.json's "files" allowlist had a phantom `PRESET-GUIDE.md` (renamed to
  // docs/PRESETS.md long ago, see git history) that npm would have silently dropped from the
  // published tarball — no existing guard reads package.json at all. Handles npm's `!exclude`
  // negation entries and glob-style entries (e.g. `!dist/src/**/*.test.*`) via bun's Glob.
  test('every package.json "files" entry resolves to a real path', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { files: string[] };
    const missing: string[] = [];
    for (const raw of pkg.files) {
      const negated = raw.startsWith('!');
      const entry = negated ? raw.slice(1) : raw;
      // `dist` is prepack build output (scripts/build-node-cli.mjs), not committed source — a
      // fresh checkout legitimately doesn't have it yet, so it (and its sub-globs) are exempt.
      if (entry === 'dist' || entry.startsWith('dist/')) continue;
      // Any negated entry may legitimately point at nothing (there's nothing to exclude yet —
      // e.g. `!visualizer/node_modules` on a fresh clone before the visualizer ever installs);
      // only inclusion entries that resolve to nothing are the phantom-entry bug this guards.
      if (negated) continue;
      if (/[*?{}]/.test(entry)) {
        const matches = [...new Glob(entry).scanSync({ cwd: REPO, onlyFiles: true })];
        if (matches.length === 0) missing.push(raw);
      } else if (!existsSync(join(REPO, entry))) {
        missing.push(raw);
      }
    }
    expect(missing).toEqual([]);
  });

  // VIZ-8 dev/01: every backtick-cited `path:line` / `path:line-range` in the docs must resolve —
  // both the FILE must exist and, when a line spec is given, every cited line must be within the
  // file's own current line count. Anchored to repo-root-relative paths only (starting with
  // src/, visualizer/, boilerplates/, or one of a few named root files) so a citation of an
  // INSTALLED-repo path (e.g. `.volter/tracker/visualizer/extension.tsx`, which does not exist in
  // THIS repo at all) is never mistaken for a stale citation — those simply don't match and are
  // skipped, same "don't flag what isn't a claim" posture as the preset-name/command guards above.
  // Line count uses `split('\n').length` (not `wc -l`) so a file with no trailing newline still
  // counts its last line — matching what an editor / the Read tool shows a human, not what a
  // newline-counting tool would.
  const CITE_ANCHOR = /^(?:src|visualizer|boilerplates|docs)\/[A-Za-z0-9_.\/-]+\.(ts|tsx|css|md|json)$|^(?:SECURITY|README|ARCHITECTURE)\.md$|^package\.json$/;
  test('every cited `path:line` / `path:line-range` resolves (file exists, line(s) in range)', () => {
    const problems: string[] = [];
    const lineCountCache = new Map<string, number>();
    const lineCountOf = (rel: string): number => {
      let n = lineCountCache.get(rel);
      if (n === undefined) {
        n = readFileSync(join(REPO, rel), 'utf8').split('\n').length;
        lineCountCache.set(rel, n);
      }
      return n;
    };
    for (const doc of DOCS) {
      const text = readFileSync(join(REPO, doc), 'utf8');
      for (const m of text.matchAll(/`([^`\n]+)`/g)) {
        const inner = m[1]!;
        const citeMatch = /^([A-Za-z0-9_.\/-]+)(?::(\d+)(?:-(\d+))?)?$/.exec(inner);
        if (!citeMatch) continue;
        const [, path, l1, l2] = citeMatch;
        if (!CITE_ANCHOR.test(path!)) continue; // not an anchored repo-relative path — not a claim this guards
        if (!existsSync(join(REPO, path!))) { problems.push(`${doc} -> \`${inner}\`: ${path} does not exist`); continue; }
        if (l1 === undefined) continue; // bare path citation — existence is the whole claim
        const total = lineCountOf(path!);
        const start = Number(l1);
        const end = l2 !== undefined ? Number(l2) : start;
        if (start < 1 || end > total || start > end) {
          problems.push(`${doc} -> \`${inner}\`: line(s) ${start}-${end} out of range (${path} has ${total} lines)`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // VIZ-8 dev/04: token-contract sync. Every `--token` docs/VISUALIZER.md's theming table names
  // must exist as a `:root` custom property in visualizer/client/styles.css, AND every custom
  // property styles.css's `:root` block declares must appear in the doc's table — both
  // directions, so a token renamed on EITHER side (in the CSS, or only updated in the doc) fails
  // here instead of silently drifting (the exact class of bug PRESETS.md's own visualizer-block
  // enum-equality guard, VIZ-7, exists to catch on the preset side).
  test('docs/VISUALIZER.md\'s token table matches styles.css\'s `:root` custom properties exactly', () => {
    const doc = readFileSync(join(REPO, 'docs/VISUALIZER.md'), 'utf8');
    const docTokens = new Set([...doc.matchAll(/`(--[a-z-]+)`/g)].map((m) => m[1]!));

    const css = readFileSync(join(REPO, 'visualizer/client/styles.css'), 'utf8');
    const rootBlock = /:root\s*\{([^}]*)\}/.exec(css);
    expect(rootBlock).not.toBeNull(); // sanity: styles.css still declares a :root block
    const cssTokens = new Set([...rootBlock![1]!.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]!));

    const missingFromDoc = [...cssTokens].filter((t) => !docTokens.has(t));
    const missingFromCss = [...docTokens].filter((t) => !cssTokens.has(t));
    expect({ missingFromDoc, missingFromCss }).toEqual({ missingFromDoc: [], missingFromCss: [] });
  });
});
