// ztrack#28 — "ac check: --dry-run skips the pass-gate (false 'success' before a real-run
// refusal) and the refusal message misattributes world-derived findings to missing evidence"
// (filed against the 0.3.0-era `ac check`, whose dry-run skipped its checkTracker gate wholesale).
//
// The 1.x shape of defect 1: `ac patch --dry-run` ran the schema validation but SKIPPED the
// entire backend write path — so every write-time gate (readonly-source, the ztrack#20
// preconditions, a document source's structural/delta/staleness/integrity guards, the --state
// vocabulary check) was never evaluated, and a dry run printed an unqualified success
// immediately before the real run refused. Exactly the incident shape from the issue: the
// operator read dry-run-success + real-run-refusal as "the two code paths disagree".
//
// The fix: `--dry-run` now takes the SAME path as the real run — `issue edit --dry-run` runs
// every gate and stops only at the final filesystem mutation (IssueSource.write's dryRun option;
// for a document source that includes ALL of its write guards, which run against the real fresh
// file). A dry run that succeeds is an honest prediction; a dry run fails exactly where the real
// run would fail.
//
// (Defect 2 — the hard-coded evidence-centric refusal wording — does not exist at 1.x: the
// refusal is each gate's own precise message, e.g. the read-only source names the config line
// and the precondition-failed payload names the sha mismatch. Pinned here by asserting the
// dry-run refusal IS the real gate's message.)
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkdownBackend } from './backends/markdownBackend.ts';
import { markdownStoreDir } from './config.ts';
import { createTrackerClient } from './sdk.ts';

const J = (r: { stdout: string }) => JSON.parse(r.stdout);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

describe('ztrack#28: --dry-run runs every write gate and mutates nothing', () => {
  test('a dry run does NOT write (and the real run then does)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztrk-28-nowrite-'));
    try {
      const be = createMarkdownBackend(dir, 'PH');
      await be.command(['issue', 'create', '--title', 'A case', '--body', 'OLD body']);
      const dry = await be.command(['issue', 'edit', 'PH-1', '--body', 'NEW body', '--dry-run']);
      expect(dry.stderr).toBe('');
      expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).body).toBe('OLD body');
      await be.command(['issue', 'edit', 'PH-1', '--body', 'NEW body']);
      expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).body).toBe('NEW body');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a dry run evaluates the ztrack#20 precondition — it refuses exactly where the real run would', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztrk-28-precond-'));
    try {
      const be = createMarkdownBackend(dir, 'PH');
      await be.command(['issue', 'create', '--title', 'A case', '--body', 'current body']);
      const dry = await be.command(['issue', 'edit', 'PH-1', '--body', 'x', '--expect-body-sha', sha256('stale body'), '--dry-run']);
      expect(dry.stdout).toBe('');
      // the refusal is the REAL gate's own precise message — not a generic dry-run stand-in
      expect((JSON.parse(dry.stderr) as { error: string }).error).toBe('precondition-failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a dry run evaluates the readonly-source gate (SDK): refusal, not unqualified success', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-28-readonly-'));
    try {
      // a second, readonly issue-per-file source holding the issue under edit
      const roDir = join(root, 'ro-board');
      mkdirSync(roDir, { recursive: true });
      writeFileSync(join(roDir, 'RO-1.md'), '---\nidentifier: "RO-1"\ntitle: "Read-only case"\nstate: "draft"\nstateType: "open"\ndevProgress: null\n---\nbody\n<!--tracker:comments\n[]\n-->\n');
      mkdirSync(join(root, '.volter'), { recursive: true });
      writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({
        backend: 'markdown', local: { teamKey: 'PH' },
        sources: [{ path: 'ro-board', readonly: true, name: 'ro' }],
      }));
      const client = createTrackerClient({ projectRoot: root });
      await expect(client.issue.edit('RO-1', { body: 'nope', dryRun: true })).rejects.toThrow(/read-only/);
      expect(readFileSync(join(roDir, 'RO-1.md'), 'utf8')).toContain('body');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('document source: a dry run runs ALL write guards (delta gate refuses) yet a valid dry run leaves the file byte-identical', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ztrk-28-doc-'));
    try {
      const docPath = join(root, 'BACKLOG.md');
      const original = '## DOC-1 — Alpha item\n\nstatus: draft\n\nAlpha body.\n';
      writeFileSync(docPath, original);
      mkdirSync(join(root, '.volter'), { recursive: true });
      writeFileSync(join(root, '.volter', 'tracker-config.json'), JSON.stringify({
        backend: 'markdown', local: { teamKey: 'PH' },
        sources: [{ path: 'BACKLOG.md', format: 'document', name: 'doc' }],
      }));
      const client = createTrackerClient({ projectRoot: root });
      // the delta guard fires under dry-run exactly as it would on the real write
      await expect(client.issue.edit('DOC-1', { assignee: 'someone', dryRun: true })).rejects.toThrow(/assignee/);
      // a valid body edit dry-runs clean through splice + integrity guards, writing nothing
      await client.issue.edit('DOC-1', { body: 'Alpha body, revised.\n', dryRun: true });
      expect(readFileSync(docPath, 'utf8')).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a dry-run edit with --parent leaves the parent\'s `children` view untouched (side-writes are writes)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztrk-28-reparent-'));
    try {
      const be = createMarkdownBackend(dir, 'PH');
      await be.command(['issue', 'create', '--title', 'Parent']); // PH-1
      await be.command(['issue', 'create', '--title', 'Child']);  // PH-2
      const dry = await be.command(['issue', 'edit', 'PH-2', '--parent', 'PH-1', '--dry-run']);
      expect(dry.stderr).toBe('');
      expect(J(await be.command(['issue', 'view', 'PH-1', '--json'])).children.nodes).toEqual([]);
      expect(J(await be.command(['issue', 'view', 'PH-2', '--json'])).parent).toBe(null);
      // the store file is untouched too
      expect(readFileSync(join(markdownStoreDir(dir), 'PH-2.md'), 'utf8')).not.toContain('parent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
