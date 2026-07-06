// Black-box e2e for the dialect LENS (docs/DIALECTS.md): a repo's own task-list idiom, declared
// as a `dialect` source, served through the REAL CLI — issue list shows true ids/statuses,
// check reports structural truth without gating (the leniency post-filter: a lens file never
// claimed process discipline, so preset errors on its issues downgrade to warnings), and every
// write path through ztrack fails closed pointing at materialization. The register-only flow —
// zero mutations to the repo's own file — is the property under test throughout.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';

function ztrack(args: string[]): { code: number; stdout: string; stderr: string; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const PLAN = `# Kill questions

### KQ1 — Is it fun?

- **Kills**: the game.
- **Status**: 🟢 PASS, sessions were great.

### KQ2 — Does the min-spec work?

- **Status**: 🔴 untested, harness ready.
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ztrk-lens-e2e-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
  ztrack(['init', '--team', 'ZT']);
  writeFileSync(join(root, 'PLAN.md'), PLAN);
  const configPath = join(root, '.volter', 'tracker-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.sources = [{ dialect: 'emoji-register', path: 'PLAN.md' }];
  writeFileSync(configPath, JSON.stringify(config, null, 2));
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('dialect lens through the real CLI', () => {
  test('issue list serves the file\'s own ids with true statuses; the file is untouched', () => {
    const before = readFileSync(join(root, 'PLAN.md'), 'utf8');
    const r = ztrack(['issue', 'list', '--json', 'identifier,title,state']);
    expect(r.code).toBe(0);
    const rows = JSON.parse(r.stdout) as { identifier: string; state: string; title: string }[];
    const byId = Object.fromEntries(rows.map((row) => [row.identifier, row]));
    expect(byId['KQ1']!.state).toBe('done');
    expect(byId['KQ1']!.title).toBe('Is it fun?');
    expect(byId['KQ2']!.state).toBe('ready');
    expect(readFileSync(join(root, 'PLAN.md'), 'utf8')).toBe(before);
  });

  test('check NEVER gates on a lens issue: preset errors (done with zero ACs, no assignee) downgrade to warnings', () => {
    const r = ztrack(['check']);
    expect(r.code).toBe(0);                                    // the whole point: exit 0
    expect(r.out).toMatch(/dialect lens: reported, never gates/); // ...but the truth is still told
    expect(r.out).toMatch(/ztrack import/);                    // ...with the upgrade path named
  });

  test('a scoped check of one lens issue also stays green', () => {
    expect(ztrack(['check', 'KQ1']).code).toBe(0);
  });

  test('writes through ztrack fail closed with the materialize pointer, file still untouched', () => {
    const before = readFileSync(join(root, 'PLAN.md'), 'utf8');
    const r = ztrack(['issue', 'edit', 'KQ1', '--state', 'ready']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/read-only dialect lens/);
    expect(r.out).toMatch(/ztrack import/);
    expect(readFileSync(join(root, 'PLAN.md'), 'utf8')).toBe(before);
  });
});

// WP5 (docs/DIALECTS.md): detection + the register-only offer. An UNREGISTERED file in a known
// dialect shape gets checked through the detected lens with the exact accept-command printed
// (name auto-filled — the user never has to know dialect names), and accepting it writes ONLY
// the config entry. Test order matters: detection must be probed before registration.
const NOTES = `# Experiments

### EX1 — Onboarding copy test

- **Status**: 🟢 shipped.

### EX2 — Pricing page variant

- **Status**: 🔴 blocked on legal.
`;

describe('dialect detection and the register-only offer', () => {
  test('check <file> on an unregistered dialect-shaped file: checked through the DETECTED lens, exit 0, offer names the dialect', () => {
    writeFileSync(join(root, 'NOTES.md'), NOTES);
    const before = readFileSync(join(root, 'NOTES.md'), 'utf8');
    const r = ztrack(['check', 'NOTES.md']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/matches the 'emoji-register' dialect/);
    expect(r.out).toMatch(/EX1/);
    expect(r.out).toMatch(/ztrack import NOTES\.md --register --dialect emoji-register/);
    expect(readFileSync(join(root, 'NOTES.md'), 'utf8')).toBe(before);
  });

  test('--dialect without --register/--dry-run is refused (a lens registration is an explicit consent)', () => {
    const r = ztrack(['import', 'NOTES.md', '--dialect', 'emoji-register']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/--register/);
  });

  test('import --register --dialect writes ONLY the config entry; the file is byte-untouched; idempotent', () => {
    const configPath = join(root, '.volter', 'tracker-config.json');
    const before = readFileSync(join(root, 'NOTES.md'), 'utf8');
    const r = ztrack(['import', 'NOTES.md', '--register', '--dialect', 'emoji-register']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/lens sees 2 issues/);
    expect(readFileSync(join(root, 'NOTES.md'), 'utf8')).toBe(before);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.sources).toContainEqual({ dialect: 'emoji-register', path: 'NOTES.md' });
    // idempotent: a second run appends nothing
    const again = ztrack(['import', 'NOTES.md', '--register', '--dialect', 'emoji-register']);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/already declared/);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).sources).toEqual(config.sources);
  });

  test('after registration the tracker itself serves the new lens ids', () => {
    const r = ztrack(['issue', 'list', '--json', 'identifier,state']);
    expect(r.code).toBe(0);
    const byId = Object.fromEntries((JSON.parse(r.stdout) as { identifier: string; state: string }[]).map((row) => [row.identifier, row]));
    expect(byId['EX1']!.state).toBe('done');
    expect(byId['EX2']!.state).toBe('ready');
  });

  test('an unknown dialect name fails closed naming the available set', () => {
    const r = ztrack(['import', 'NOTES.md', '--register', '--dialect', 'nope']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/unknown dialect 'nope'/);
    expect(r.out).toMatch(/emoji-register/);
  });
});
