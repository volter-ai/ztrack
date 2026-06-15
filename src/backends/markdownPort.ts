#!/usr/bin/env bun
// Lossless port: read every issue through the canonical tracker CLI surface (the
// `local`/SQLite backend), serialize to `tracker/<id>.md` via the markdown backend,
// and PROVE losslessness by round-tripping each one back to the canonical object.
// Storage-layer only — no preset/validation involved.
//
//   bun src/backends/markdownPort.ts --out <dir> [--repo <root>] [--limit N] [--write]
//   (without --write it verifies + reports without touching disk beside --out)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, serializeIssue, roundTripDiff, type CanonicalIssue } from './markdown.ts';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
const has = (n: string) => args.includes(`--${n}`);
const REPO = flag('repo', process.cwd())!;
// the markdown store lives parallel to the SQLite backend (.volter/tracker/tracker.sqlite),
// as a peer backend's local data dir (.volter/tracker/ is gitignored runtime state).
const OUT = flag('out', join(REPO, '.volter', 'tracker', 'markdown'))!;
const LIMIT = flag('limit') ? Number(flag('limit')) : undefined;

function tracker(a: string[]): unknown {
  const r = Bun.spawnSync(['bash', 'scripts/tracker', ...a], { cwd: REPO });
  if (r.exitCode !== 0) throw new Error(`tracker ${a.join(' ')}: ${new TextDecoder().decode(r.stderr)}`);
  const out = new TextDecoder().decode(r.stdout).trim();
  return out ? JSON.parse(out) : null;
}

function main() {
  const list = tracker(['issue', 'list', '--json', 'identifier', ...(LIMIT ? ['--limit', String(LIMIT)] : ['--limit', '100000'])]) as Array<{ identifier: string }>;
  const ids = list.map((r) => r.identifier);
  console.log(`porting ${ids.length} issues from ${REPO} → ${OUT}${has('write') ? ' (writing)' : ' (verify-only writes to --out)'}`);
  mkdirSync(OUT, { recursive: true });
  let lossless = 0; const lossy: Array<{ id: string; fields: string[] }> = [];
  for (const id of ids) {
    const raw = tracker(['issue', 'view', id, '--comments', '--json']) as Record<string, unknown>;
    const c: CanonicalIssue = canonicalize(raw);
    const diff = roundTripDiff(c);
    if (diff.length === 0) lossless += 1; else lossy.push({ id, fields: diff });
    writeFileSync(join(OUT, `${c.identifier}.md`), serializeIssue(c));
  }
  console.log(`\nlossless round-trip: ${lossless}/${ids.length}`);
  if (lossy.length) { console.log(`LOSSY (${lossy.length}):`); for (const l of lossy.slice(0, 30)) console.log(`  ${l.id}: ${l.fields.join(', ')}`); }
  else console.log('✓ every issue round-trips canonical → markdown → canonical with zero field loss');
  process.exit(lossy.length ? 1 : 0);
}
main();
