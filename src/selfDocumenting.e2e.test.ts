// Self-documenting + self-closing: a red finding names the exact fix, and running that fix turns
// the gate green. Proves an agent can resolve a failure from the finding ALONE (no hard-coded
// knowledge of `ac patch`) — the property that makes the ralph loop actually close.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';
const zt = (...a: string[]) => { const r = spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const git = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });

describe('findings are self-documenting AND self-closing', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-selfdoc-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    git('init', '-q'); git('config', 'user.email', 't@t.co'); git('config', 'user.name', 't');
    zt('init', '--team', 'APP');
  }, 30_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('a red AC tells the agent the fix; running that fix makes the gate green', () => {
    // real work first → a real commit whose SHA is the legitimate evidence
    writeFileSync(join(root, 'feat.ts'), 'export const x = 1;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'feat'); const sha = git('rev-parse', 'HEAD').stdout.trim();
    // a checked AC with NO evidence → red
    writeFileSync(join(root, 'b.md'), '## Acceptance Criteria\n\n- [x] dev/01 v1 do it\n  - status: passed\n');
    zt('issue', 'create', '--title', 'F', '--label', 'type:case', '--state', 'ready', '--assignee', 'me', '--body-file', 'b.md');

    // the agent runs the gate and READS the finding's fix (no prior knowledge of `ac patch`)
    const out = zt('check', '--json', '--verify-commits').out;
    const result = JSON.parse(out.slice(out.indexOf('{'))) as { findings: Array<{ code: string; fix?: string; acId?: string }> };
    const finding = result.findings.find((f) => f.code === 'passed_ac_missing_evidence')!;
    expect(finding.fix).toMatch(/ztrack ac patch APP-1 dev\/01 --json/); // the finding names the exact command + target

    // the agent does EXACTLY what the fix says (filling the placeholders with the real sha) —
    // evidence + proof, the two things the findings flagged.
    const patch = { evidence: [{ id: 'ev1', commit: sha, acVersion: 1 }], proof: { explanation: 'ev1 shows the outcome', evidenceRefs: ['ev1'] } };
    expect(zt('ac', 'patch', 'APP-1', 'dev/01', '--json', JSON.stringify(patch)).code).toBe(0);

    // gate is now green — the loop closed from the finding alone
    expect(zt('check', '--verify-commits').code).toBe(0);
  }, 60_000);
});
