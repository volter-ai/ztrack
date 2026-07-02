#!/usr/bin/env node
// Parallel test runner: shards test files across N `bun test` processes.
//
// `bun test` runs files serially in one process, and the e2e tier drives the real
// CLI via spawnSync — so the suite's wall time is the SUM of a few hundred blocking
// subprocess calls. The files are independent (every fixture is its own mkdtemp git
// repo), so file-level sharding is safe and cuts wall time by roughly the job count.
//
// Also sets TMPDIR to a fresh dir under /tmp for the children: fixture cwds live in
// TMPDIR, and bun's module resolver readdirs every ancestor of the cwd on startup —
// on machines whose per-user temp dir has accumulated hundreds of thousands of
// entries (e.g. leaked SwiftPM TemporaryDirectory.* dirs), that scan costs ~0.6s
// PER CLI SPAWN. A clean TMPDIR makes the suite immune to temp-dir bloat.
//
// Usage: node scripts/test-parallel.mjs [--jobs N] [extra bun-test args...]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const jobsIdx = argv.indexOf('--jobs');
const JOBS = jobsIdx >= 0
  ? Number(argv.splice(jobsIdx, 2)[1])
  : Math.max(2, Math.min(8, cpus().length - 2));

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.test.ts')) files.push(relative(ROOT, p));
  }
};
walk(join(ROOT, 'src'));
walk(join(ROOT, 'boilerplates'));

// Longest-first packing: subprocess-heavy files (e2e, simulators, scaffold) dominate
// wall time, so start them before the millisecond-scale unit files.
const heavy = (f) => /e2e|simulate|scaffold/.test(f) ? 0 : 1;
files.sort((a, b) => heavy(a) - heavy(b) || a.localeCompare(b));

const tmpRoot = mkdtempSync('/tmp/ztrack-tests-');
const env = { ...process.env, TMPDIR: tmpRoot };

const t0 = performance.now();
const results = [];
let next = 0;

const runOne = (file) => new Promise((resolve) => {
  const started = performance.now();
  const child = spawn('bun', ['test', file, ...argv], { cwd: ROOT, env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ file, code: code ?? 1, out, secs: (performance.now() - started) / 1000 }));
});

const count = (out, kind) => {
  const m = out.match(new RegExp(`^\\s*(\\d+) ${kind}`, 'm'));
  return m ? Number(m[1]) : 0;
};

const worker = async () => {
  while (next < files.length) {
    const file = files[next++];
    const r = await runOne(file);
    results.push(r);
    const mark = r.code === 0 ? '✓' : '✗';
    console.log(`${mark} ${r.file} — ${count(r.out, 'pass')} pass, ${count(r.out, 'fail')} fail (${r.secs.toFixed(1)}s)`);
    if (r.code !== 0) console.log(r.out);
  }
};

await Promise.all(Array.from({ length: JOBS }, worker));
rmSync(tmpRoot, { recursive: true, force: true });

const total = (kind) => results.reduce((n, r) => n + count(r.out, kind), 0);
const failed = results.filter((r) => r.code !== 0);
const wall = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`\n${total('pass')} pass, ${total('skip')} skip, ${total('fail')} fail across ${results.length} files — ${wall}s wall (${JOBS} jobs)`);
if (failed.length) {
  console.log(`failing files: ${failed.map((r) => r.file).join(', ')}`);
  process.exit(1);
}
