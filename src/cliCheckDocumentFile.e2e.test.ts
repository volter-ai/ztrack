// Black-box e2e for `ztrack check <file.md>` on a DOCUMENT-grammar file (id-bearing headings —
// the same grammar a registered `format: "document"` source uses). Before this, such a file was
// silently lumped into ONE loose issue keyed by its filename, so the check answered the wrong
// question in both directions: nonsense findings on the lump, and no hint that the file's real
// issues weren't being validated — the exact gap that shipped a six-issue backlog file that never
// loaded into its tracker. Now the file is checked as the multi-issue document it is, and a
// stderr note says whether the tracker can actually see it — OFFERING `ztrack import --register`
// when it cannot, never running it (mutating tracker-config.json stays the user's call).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');        // src/ -> repo root
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';

function ztrack(args: string[]): { code: number; stdout: string; stderr: string; out: string } {
  const r = spawnSync('bun', ['run', CLI, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const GREEN_ITEM = `## DOC-1 — Clean

status: draft
assignee: me

### Summary

ok
`;

// Red: the checked-passed AC cites a fabricated commit — the core guarantee catches it.
const RED_ITEM = `## DOC-2 — Bad

status: ready
assignee: me

### Acceptance Criteria

- [x] dev/01 v1 does the thing
  - status: passed
  - evidence ev1: commit=deadbeef acv=1
  - proof: "shows it" -> ev1
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ztrk-cdf-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the preset imports 'ztrack/preset-kit'
  ztrack(['init', '--team', 'ZT']);
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('check on a document-grammar file', () => {
  test('an UNREGISTERED document file checks every issue it holds, attributes findings to the real issue id, and OFFERS registration without touching the config', () => {
    writeFileSync(join(root, 'doc.md'), `${GREEN_ITEM}\n${RED_ITEM}`);
    const configBefore = readFileSync(join(root, '.volter', 'tracker-config.json'), 'utf8');
    const r = ztrack(['check', './doc.md']);
    expect(r.code).not.toBe(0);                        // DOC-2's fabricated commit is caught
    expect(r.stdout).toMatch(/DOC-2/);                 // ...attributed to the real issue id,
    expect(r.stdout).toMatch(/deadbeef/);
    expect(r.stdout).not.toMatch(/issue doc\b/);       // ...never to a filename-lump issue
    // The note: on stderr (stdout stays the report), says the tracker cannot see the file,
    // and offers — not runs — the registration command.
    expect(r.stderr).toMatch(/parses as a document source holding 2 issue\(s\) \(DOC-1, DOC-2\)/);
    expect(r.stderr).toMatch(/NOT registered in tracker-config\.json/);
    expect(r.stderr).toMatch(/To register it: ztrack import (\.\/)?doc\.md --register/);
    expect(readFileSync(join(root, '.volter', 'tracker-config.json'), 'utf8')).toBe(configBefore);
  });

  test('a green document file passes (exit 0) and still gets the unregistered note', () => {
    writeFileSync(join(root, 'green.md'), GREEN_ITEM);
    const r = ztrack(['check', './green.md']);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/NOT registered/);
    expect(r.stderr).toMatch(/ztrack import (\.\/)?green\.md --register/);
  });

  test('intra-file relations resolve: blocked-by between two issues in the same file is not "missing"', () => {
    writeFileSync(join(root, 'related.md'), [
      '## REL-1 — First',
      '',
      'status: draft',
      'assignee: me',
      '',
      'Blocks: REL-2',
      '',
      '## REL-2 — Second',
      '',
      'status: draft',
      'assignee: me',
      '',
      'Blocked by: REL-1',
      '',
    ].join('\n'));
    const r = ztrack(['check', './related.md']);
    expect(r.out).not.toMatch(/relation_target_missing/);
    expect(r.code).toBe(0);
  });

  test('--json keeps stdout pure JSON; the note stays on stderr', () => {
    writeFileSync(join(root, 'doc.md'), `${GREEN_ITEM}\n${RED_ITEM}`);
    const r = ztrack(['check', './doc.md', '--json']);
    const payload = JSON.parse(r.stdout);              // throws (fails the test) if the note leaked
    expect(payload.ok).toBe(false);
    expect(r.stderr).toMatch(/NOT registered/);
  });

  test('a loose file whose heading is merely a hyphenated word ("## Follow-up items") stays a ONE-issue loose check', () => {
    writeFileSync(join(root, 'notes.md'), 'Status: draft\nAssignee: me\n\n## Follow-up items\n\nplain notes, no tracker ids\n');
    const r = ztrack(['check', './notes.md']);
    expect(r.stderr).not.toMatch(/document source/);   // no mode flip, no note
    expect(r.code).toBe(0);
  });

  test('a REGISTERED document source file notes the source name and points at --source instead of offering registration', () => {
    writeFileSync(join(root, 'reg-doc.md'), GREEN_ITEM);
    const configPath = join(root, '.volter', 'tracker-config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.sources = [{ format: 'document', path: 'reg-doc.md' }];
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const r = ztrack(['check', './reg-doc.md']);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/is the registered document source 'reg-doc\.md'/);
    expect(r.stderr).toMatch(/ztrack check --source reg-doc\.md/);
    expect(r.stderr).not.toMatch(/--register/);
  });
});
