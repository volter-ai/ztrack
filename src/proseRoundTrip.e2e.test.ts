// ZTB-10 (residual R4): `ac patch`/`fmt` used to silently delete an issue body's BARE LEADING
// PROSE — content before the first "## " heading that isn't a recognized metadata line (see the
// `prose` schema field comment in boilerplates/presets/simple-sdlc.ts /
// simple-gh-sdlc.ts). Black-box CLI in a real git repo, same style as devWorkflow.e2e.test.ts /
// selfDocumenting.e2e.test.ts: spawn `bun run cli.ts`, read the real stored `.md` file back off
// disk (not just `issue view`), to prove the FIX operates on the actual write path
// (parse -> edit -> serialize, src/modelEdit.ts), not just the in-memory model.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const git = (...a: string[]) => run('git', a);
const zt = (...a: string[]) => { const r = run('bun', ['run', CLI, ...a]); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const storedIssuePath = (id: string) => join(root, '.volter', 'tracker', 'markdown', `${id}.md`);

describe('R4: ac patch no longer drops bare leading prose (ZTB-10)', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-prose-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    git('init', '-q'); git('config', 'user.email', 't@t.co'); git('config', 'user.name', 't');
    zt('init');
  }, 30_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('a plain issue-per-file item: the R4 reproduction body keeps its prose after a real `ac patch`, and the AC change lands', () => {
    // The exact R4 repro from the work order: a bare leading prose paragraph, not under any
    // subsection heading, followed by "## Acceptance Criteria".
    const body = 'Bare leading prose paragraph not under any subsection heading.\n\n## Acceptance Criteria\n\n- [ ] AC-1 v1 do the thing\n';
    writeFileSync(join(root, 'body.md'), body);
    const created = zt('issue', 'create', '--title', 'R4 repro', '--state', 'draft', '--assignee', 'me', '--body-file', 'body.md');
    expect(created.code).toBe(0);

    const before = readFileSync(storedIssuePath('LOCAL-1'), 'utf8');
    expect(before).toContain('Bare leading prose paragraph not under any subsection heading.');

    // real work + a real commit so the evidence is legitimate (not a fabricated sha)
    writeFileSync(join(root, 'feat.ts'), 'export const x = 1;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'feat');
    const sha = git('rev-parse', 'HEAD').stdout.trim();

    const patch = { checked: true, status: 'passed', evidence: [{ id: 'ev1', commit: sha, acVersion: 1 }], proof: { explanation: 'the commit does the thing', evidenceRefs: ['ev1'] } };
    const patched = zt('ac', 'patch', 'LOCAL-1', 'AC-1', '--json', JSON.stringify(patch));
    expect(patched.code).toBe(0);
    expect(JSON.parse(patched.out)).toMatchObject({ issue: 'LOCAL-1', acId: 'AC-1', changed: true });

    // R4: the prose paragraph must STILL be in the stored file after the patch.
    const after = readFileSync(storedIssuePath('LOCAL-1'), 'utf8');
    expect(after).toContain('Bare leading prose paragraph not under any subsection heading.');
    // AND the AC change actually landed.
    expect(after).toContain('- [x] AC-1 v1 do the thing');
    expect(after).toContain('status: passed');
    expect(after).toContain(`commit=${sha}`);

    // the gate is green: real commit, real evidence, real proof — nothing fabricated.
    expect(zt('check', 'LOCAL-1').code).toBe(0);
  }, 30_000);
});
