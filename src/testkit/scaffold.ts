// Reusable scaffolder for REALISTIC ztrack project fixtures — the infrastructure the core-matrix
// e2es build on, instead of hand-rolling `mkdtemp + init + one scaffold issue` per test. A project
// is a real git repo (real history + a real commit SHA for evidence), `ztrack init`'d (local) or
// `init --sync`'d (linked), seeded with issues from a declarative spec, optionally committed (so
// clones/CI/worktrees see them) with branches for auto-scope tests.
//
// The four issue SHAPES each produce a KNOWN check outcome under --verify-commits (proven by
// scaffold.test.ts): `pending` → GREEN, `realCommit` → GREEN, `fakeCommit` → RED
// (evidence_commit_not_found), `noEvidence` → RED (passed_ac_missing_evidence).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..', '..');     // src/testkit -> repo root
const CLI = join(REPO, 'src', 'cli.ts');

export type IssueShape = 'pending' | 'realCommit' | 'fakeCommit' | 'noEvidence';
export type IssueSpec = { title: string; shape: IssueShape; label?: string; state?: string; assignee?: string };

const AC = (checked: '[ ]' | '[x]', lines: string) => `Summary: work to do.\n\n## Acceptance Criteria\n\n- ${checked} dev/01 v1 do the observable thing\n${lines}`;
const bodyFor = (shape: IssueShape, sha: string): string => ({
  pending: AC('[ ]', '  - status: pending\n'),
  realCommit: AC('[x]', `  - status: passed\n  - evidence ev1: image=x.png commit=${sha} acv=1\n  - proof: "shows it" -> ev1\n`),
  fakeCommit: AC('[x]', '  - status: passed\n  - evidence ev1: image=x.png commit=deadbeef acv=1\n  - proof: "shows it" -> ev1\n'),
  noEvidence: AC('[x]', '  - status: passed\n'),
}[shape]);

export type ScaffoldedProject = {
  root: string;
  sha: string;                                                  // a real commit SHA in the repo
  ids: string[];                                                // created issue ids, in spec order
  zt: (...args: string[]) => { code: number; out: string };
  git: (...args: string[]) => { code: number; out: string };
  branch: (name: string) => void;                              // create + checkout a branch
  commitAll: () => void;
  cleanup: () => void;
};

export type ScaffoldOpts = { team?: string; issues: IssueSpec[]; commit?: boolean; sync?: { repo: string } };

export function scaffoldProject(opts: ScaffoldOpts): ScaffoldedProject {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-fixture-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));     // so the preset resolves 'ztrack/preset-kit'
  const zt = (...a: string[]) => { const r = spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
  const git = (...a: string[]) => { const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' }); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };

  git('init', '-q'); git('config', 'user.email', 't@t.co'); git('config', 'user.name', 't');
  writeFileSync(join(root, 'code.txt'), 'real source content\n');
  git('add', 'code.txt'); git('commit', '-q', '-m', 'base');   // a real commit → SHA for realCommit evidence + branches resolve
  const sha = git('rev-parse', 'HEAD').out.trim();

  zt('init', '--team', opts.team ?? 'APP', ...(opts.sync ? ['--sync', 'github', '--repo', opts.sync.repo] : []));

  const ids: string[] = [];
  for (const spec of opts.issues) {
    const file = join(root, `seed-${ids.length + 1}.md`);
    writeFileSync(file, bodyFor(spec.shape, sha));
    const out = zt('issue', 'create', '--title', spec.title, '--label', spec.label ?? 'type:case', '--state', spec.state ?? 'ready', '--assignee', spec.assignee ?? 'me', '--body-file', file).out;
    ids.push((/\b([A-Z]+-\d+)\b/.exec(out)?.[1]) ?? '');
  }

  const commitAll = () => { git('add', '-A'); git('commit', '-q', '-m', 'seed issues'); };
  if (opts.commit) commitAll();

  return {
    root, sha, ids, zt, git,
    branch: (name: string) => { git('checkout', '-q', '-b', name); },
    commitAll,
    cleanup: () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* */ } },
  };
}
