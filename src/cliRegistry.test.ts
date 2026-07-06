// ZTB-24 dev/04: the registry<->help drift test — makes help-vs-parser drift impossible in either
// direction, and a source-level meta-scan that catches a parsed flag nobody registered. Unit only
// (no spawning): everything below calls exported, side-effect-free (or config-free) functions
// directly and captures their stdout.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRY, allRegisteredFlagTokens, flagTokensForTest } from './cliRegistry.ts';
import { printIssueActionHelp, printResourceHelp } from './cliHelp.ts';
import { handleCheckCommand } from './cliCheck.ts';
import { handleImportCommand } from './cliImport.ts';
import { handleWaiverCommand } from './cliWaiver.ts';
import { handleCompletionsCommand } from './cliCompletions.ts';

function captured(fn: () => unknown): string {
  const orig = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: unknown) => { out += String(chunk); return true; }) as typeof process.stdout.write;
  try { fn(); } finally { process.stdout.write = orig; }
  return out;
}
async function capturedAsync(fn: () => Promise<unknown>): Promise<string> {
  const orig = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: unknown) => { out += String(chunk); return true; }) as typeof process.stdout.write;
  try { await fn(); } finally { process.stdout.write = orig; }
  return out;
}

// One "help group": every registry path in `paths` renders (all of, or is covered by) `text()`.
// Most groups are a single command with its own dedicated usage line; a few share ONE resource-
// level help block across several sibling subcommands (loop start/stop/status, tx plan/apply, the
// four evidence subcommands, the two api subcommands, the four waiver actions, the two completions
// shells) — for those, the check is over the UNION of the group's registered flags, not any single
// sibling, since that's genuinely how the help is organized today.
type Group = {
  paths: string[][];
  text: () => string | Promise<string>;
  // Flags of OTHER commands legitimately mentioned in this group's help prose (cross-references,
  // e.g. init's onboarding narrative naming `import --register`/`loop start --until`/`issue list
  // --actionable`, or sync's `init --sync` back-reference) — real flags, just not this command's
  // own, so direction-B (every --token in the text is THIS command's) must not flag them.
  crossRef?: string[];
};
const GROUPS: Group[] = [
  { paths: [['check']], text: () => capturedAsync(() => handleCheckCommand(['check', '--help'])) },
  { paths: [['export']], text: () => capturedAsync(() => handleCheckCommand(['export', '--help'])) },
  { paths: [['issue', 'scaffold']], text: () => captured(() => printIssueActionHelp('scaffold')) },
  { paths: [['issue', 'list']], text: () => captured(() => printIssueActionHelp('list')) },
  { paths: [['issue', 'view']], text: () => captured(() => printIssueActionHelp('view')) },
  { paths: [['issue', 'get']], text: () => captured(() => printIssueActionHelp('get')) },
  { paths: [['issue', 'create']], text: () => captured(() => printIssueActionHelp('create')) },
  { paths: [['issue', 'edit']], text: () => captured(() => printIssueActionHelp('edit')) },
  { paths: [['issue', 'comment']], text: () => captured(() => printIssueActionHelp('comment')) },
  { paths: [['issue', 'close']], text: () => captured(() => printIssueActionHelp('close')) },
  { paths: [['issue', 'patch']], text: () => captured(() => printIssueActionHelp('patch')) },
  // `issue delete` has zero flags — nothing to check bidirectionally, but exercised anyway so a
  // future flag added to either side without the other trips the test.
  { paths: [['issue', 'delete']], text: () => captured(() => printIssueActionHelp('delete')) },
  { paths: [['ac', 'patch']], text: () => captured(() => printResourceHelp('ac')) },
  { paths: [['project', 'list']], text: () => captured(() => printResourceHelp('project')) },
  {
    paths: [['init']],
    text: () => captured(() => printResourceHelp('init')),
    // init's onboarding narrative names the very next commands an operator would run —
    // `import --register`, `loop start --until`, `issue list --actionable`, and `--source` (the
    // "declare more sources" paragraph) — all real flags of OTHER commands, not init's own.
    crossRef: ['--register', '--until', '--actionable', '--source'],
  },
  { paths: [['migrate-local']], text: () => captured(() => printResourceHelp('migrate-local')) },
  { paths: [['loop', 'start'], ['loop', 'stop'], ['loop', 'status']], text: () => captured(() => printResourceHelp('loop')) },
  { paths: [['import']], text: () => capturedAsync(() => handleImportCommand(['import', '--help'])) },
  { paths: [['fmt']], text: () => captured(() => printResourceHelp('fmt')) },
  { paths: [['lint']], text: () => captured(() => printResourceHelp('lint')) },
  { paths: [['tx', 'plan'], ['tx', 'apply']], text: () => captured(() => printResourceHelp('tx')) },
  {
    paths: [['sync', 'github']],
    text: () => captured(() => printResourceHelp('sync')),
    // "--repo/--policy default to the `init --sync` link" — a real back-reference to init's flag.
    crossRef: ['--sync'],
  },
  { paths: [['evidence', 'add'], ['evidence', 'keygen'], ['evidence', 'verify'], ['evidence', 'export']], text: () => captured(() => printResourceHelp('evidence')) },
  { paths: [['api', 'query'], ['api', 'serve']], text: () => captured(() => printResourceHelp('api')) },
  { paths: [['mcp', 'serve']], text: () => captured(() => printResourceHelp('mcp')) },
  { paths: [['visualizer']], text: () => captured(() => printResourceHelp('visualizer')) },
  { paths: [['viz']], text: () => captured(() => printResourceHelp('viz')) },
  { paths: [['waiver', 'sign'], ['waiver', 'clear'], ['waiver', 'status'], ['waiver', 'migrate']], text: () => capturedAsync(() => handleWaiverCommand(['waiver', '--help'])) },
  { paths: [['completions', 'bash'], ['completions', 'zsh']], text: () => captured(() => handleCompletionsCommand(['completions', '--help'], 'ztrack')) },
  // No exported, side-effect-free help renderer exists for these two (both zero-flag commands —
  // `snapshot` has no dedicated help at all; `preset upgrade`'s usage is printed inline in cli.ts's
  // main(), not through an importable function) — nothing to check bidirectionally either way.
];

function specFor(path: string[]) {
  const spec = REGISTRY.find((s) => s.path.length === path.length && s.path.every((t, i) => t === path[i]));
  if (!spec) throw new Error(`no registry entry for ${path.join(' ')}`);
  return spec;
}

describe('cliRegistry <-> help drift (ZTB-24 dev/04)', () => {
  for (const group of GROUPS) {
    const label = group.paths.map((p) => p.join(' ')).join(' / ');
    test(`${label}: every non-hidden registered flag appears in its help text`, async () => {
      const text = await group.text();
      const specs = group.paths.map(specFor);
      const nonHidden = new Set(specs.flatMap((s) => flagTokensForTest(s, false)));
      const missing = [...nonHidden].filter((f) => !text.includes(f));
      expect(missing).toEqual([]);
    });

    test(`${label}: every --flag token in its help text is a registered flag (or a documented cross-reference)`, async () => {
      const text = await group.text();
      const specs = group.paths.map(specFor);
      const registered = new Set(specs.flatMap((s) => flagTokensForTest(s, true)));
      const found = new Set(text.match(/--[a-z][a-z-]*/g) ?? []);
      const unregistered = [...found].filter((f) => !registered.has(f) && !(group.crossRef ?? []).includes(f));
      expect(unregistered).toEqual([]);
    });
  }
});

describe('cliRegistry meta-scan: every parsed flag literal is registered (ZTB-24 dev/04)', () => {
  // Non-parse false positives found in prose/comments — each justified. Empty today; kept as the
  // documented escape hatch the spec calls for if a future addition needs it.
  const ALLOW: string[] = [];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) { out.push(...walk(p)); continue; }
      if (entry.endsWith('.test.ts')) continue; // test files intentionally use unregistered/bogus flags
      if (entry.endsWith('.ts')) out.push(p);
    }
    return out;
  }

  test('optionValue/flagVal/flagAll/.includes parse-site literals are all registered somewhere', () => {
    const repoSrc = join(import.meta.dir);
    const files = walk(repoSrc);
    const registered = allRegisteredFlagTokens();
    const found = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/optionValue\([^,]+,\s*'(--[a-z][a-z-]*)'/g)) found.add(m[1]!);
      for (const m of text.matchAll(/flagVal\([^,]+,\s*'([a-z][a-z-]*)'/g)) found.add(`--${m[1]!}`);
      for (const m of text.matchAll(/flagAll\([^,]+,\s*'([a-z][a-z-]*)'/g)) found.add(`--${m[1]!}`);
      for (const m of text.matchAll(/\.includes\('(--[a-z][a-z-]*)'\)/g)) found.add(m[1]!);
    }
    const unregistered = [...found].filter((f) => !registered.has(f) && !ALLOW.includes(f));
    expect(unregistered).toEqual([]);
  });
});

describe('cliRegistry hygiene (ZTB-24 dev/04)', () => {
  test('no duplicate flag names (or aliases) within one command', () => {
    const dupes: string[] = [];
    for (const spec of REGISTRY) {
      const seen = new Set<string>();
      for (const f of spec.flags) {
        for (const token of [f.name, ...(f.aliases ?? [])]) {
          const key = `${spec.path.join(' ')}: ${token}`;
          if (seen.has(token)) dupes.push(key);
          seen.add(token);
        }
      }
    }
    expect(dupes).toEqual([]);
  });

  test('every registered path is unique', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const spec of REGISTRY) {
      const key = spec.path.join(' ');
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });
});
