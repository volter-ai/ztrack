import { describe, expect, test } from 'bun:test';
import type { IssueRecord } from 'ztrack/preset-kit';

// Shared "SDLC-grammar" conformance: the parse / evidence-integrity / relevance / anti-tamper
// properties that `simple-sdlc` and `simple-gh-sdlc` share BY CONSTRUCTION (same default-family
// grammar). Each preset's own `<name>.test.ts` calls this with ITS `checkDefault`/`parseDefault` —
// so the runtime presets stay standalone (the no-shared-model invariant; only the TEST is shared),
// and a parser/evidence regression is caught for every default-family preset from one place.
// Lifecycle/PR behaviors differ per preset and stay inline in each file.
export function assertSdlcGrammarConformance(p: {
  checkDefault: (records: IssueRecord[], ctx?: object) => { findings: { code: string }[] };
  parseDefault: (records: IssueRecord[]) => unknown;
  HEAD: string;
  REC: IssueRecord;
}): void {
  const { checkDefault, parseDefault, HEAD, REC } = p;

  describe('rule: evidence_commit_unrelated (relevance gap)', () => {
    // A passed AC may declare `paths:`; its cited commit must TOUCH at least one. ctx.git.commitFiles
    // maps commit→files-it-changed (resolved offline by loadContext via `git show --name-only`).
    const recWith = (pathsLine: string) => ({
      ...REC,
      body: `## Acceptance Criteria\n\n- [x] AC-1 v2 do it\n  - status: passed\n${pathsLine}  - evidence ev1: commit=${HEAD} acv=2\n  - proof: "ev1 shows it" -> ev1\n`,
    } as IssueRecord);
    const ctxFiles = (files: string[]) => ({ git: { existingCommits: [HEAD], prs: {}, commitFiles: { [HEAD]: files } } });
    const fired = (pathsLine: string, files: string[]) =>
      checkDefault([recWith(pathsLine)], ctxFiles(files)).findings.some((f) => f.code === 'evidence_commit_unrelated');

    test('relevant commit (src/** ⊇ src/health.ts) → passes', () => {
      expect(fired('  - paths: src/**\n', ['src/health.ts'])).toBe(false);
    });
    test('unrelated commit (src/** vs docs/x.md) → fires', () => {
      expect(fired('  - paths: src/**\n', ['docs/x.md'])).toBe(true);
    });
    test('opt-in: no paths declared → never fires', () => {
      expect(fired('', ['docs/x.md'])).toBe(false);
    });
    test('single-star stays within a segment: src/*.ts matches src/a.ts but not src/sub/a.ts', () => {
      expect(fired('  - paths: src/*.ts\n', ['src/a.ts'])).toBe(false);
      expect(fired('  - paths: src/*.ts\n', ['src/sub/a.ts'])).toBe(true);
    });
    test('no commitFiles in context (offline, unresolved) → never false-flags', () => {
      const r = checkDefault([recWith('  - paths: src/**\n')], { git: { existingCommits: [HEAD], prs: {} } });
      expect(r.findings.some((f) => f.code === 'evidence_commit_unrelated')).toBe(false);
    });

    // ── adversarial matcher battery: glob/literal edge cases through the real rule path ──
    test('exact file path: matches itself, fires on a sibling', () => {
      expect(fired('  - paths: src/health.ts\n', ['src/health.ts'])).toBe(false);
      expect(fired('  - paths: src/health.ts\n', ['src/other.ts'])).toBe(true);
    });
    test('directory prefix respects the / boundary (src ⊉ srcfoo)', () => {
      expect(fired('  - paths: src\n', ['src/a.ts'])).toBe(false);   // dir prefix
      expect(fired('  - paths: src\n', ['srcfoo/a.ts'])).toBe(true); // not a prefix at a boundary
    });
    test('trailing slash on a dir path is normalized', () => {
      expect(fired('  - paths: src/\n', ['src/a.ts'])).toBe(false);
    });
    test('dots in a non-glob path are literal, not wildcards', () => {
      expect(fired('  - paths: src/a.b.ts\n', ['src/aXbYts'])).toBe(true);   // dots must not match arbitrary chars
      expect(fired('  - paths: src/a.b.ts\n', ['src/a.b.ts'])).toBe(false);
    });
    test('dots inside a glob are escaped (v*.ts is literal-dot then ts)', () => {
      expect(fired('  - paths: src/v*.ts\n', ['src/v1.ts'])).toBe(false);
      expect(fired('  - paths: src/v*.ts\n', ['src/v1.2.ts'])).toBe(false); // [^/]* spans the inner dot
      expect(fired('  - paths: src/v*.ts\n', ['src/v1Xts'])).toBe(true);    // the escaped dot must bite
    });
    test('? matches exactly one non-separator char', () => {
      expect(fired('  - paths: src/a?.ts\n', ['src/ab.ts'])).toBe(false);
      expect(fired('  - paths: src/a?.ts\n', ['src/abc.ts'])).toBe(true);   // ? is one char
      expect(fired('  - paths: src/a?.ts\n', ['src/a/.ts'])).toBe(true);    // ? must not cross /
    });
    test('** spans segments; bare ** matches everything', () => {
      expect(fired('  - paths: **\n', ['any/deep/nested/file.x'])).toBe(false);
      expect(fired('  - paths: src/**/util.ts\n', ['src/a/b/util.ts'])).toBe(false);
      expect(fired('  - paths: src/**/util.ts\n', ['src/util.ts'])).toBe(true); // ** between slashes needs a segment
    });
    test('multiple declared paths: touching ANY one passes', () => {
      expect(fired('  - paths: src/**, docs/**\n', ['docs/x.md'])).toBe(false);
      expect(fired('  - paths: src/**, docs/**\n', ['test/x.ts'])).toBe(true);
    });
    test('multiple cited commits: ANY commit touching a path passes', () => {
      const SHA2 = 'beadfacebeadfacebeadfacebeadfacebeadface';
      const rec = {
        ...REC,
        body: `## Acceptance Criteria\n\n- [x] AC-1 v2 do it\n  - status: passed\n  - paths: src/**\n  - evidence ev1: commit=${HEAD} acv=2\n  - evidence ev2: commit=${SHA2} acv=2\n  - proof: "ev1, ev2 show it" -> ev1, ev2\n`,
      } as IssueRecord;
      const ctx = { git: { existingCommits: [HEAD, SHA2], prs: {}, commitFiles: { [HEAD]: ['docs/x.md'], [SHA2]: ['src/a.ts'] } } };
      expect(checkDefault([rec], ctx).findings.some((f) => f.code === 'evidence_commit_unrelated')).toBe(false);
    });
    test('empty commit (touched nothing) → does not false-flag', () => {
      expect(fired('  - paths: src/**\n', [])).toBe(false);
    });
  });

  describe('rule: passed_ac_missing_paths (relevance enforcement, config.relevance: required)', () => {
    // A passed AC with no `paths`. ctx.relevance is the dial loadContext reads from config.
    const rec = (pathsLine: string) => ({
      ...REC,
      body: `## Acceptance Criteria\n\n- [x] AC-1 v2 do it\n  - status: passed\n${pathsLine}  - evidence ev1: commit=${HEAD} acv=2\n  - proof: "ev1 shows it" -> ev1\n`,
    } as IssueRecord);
    const base = { git: { existingCommits: [HEAD], prs: {}, commitFiles: { [HEAD]: ['src/a.ts'] } } };
    const fired = (ctx: object) =>
      checkDefault([rec('')], ctx).findings.some((f) => f.code === 'passed_ac_missing_paths');

    test('required + passed AC missing paths → fires', () => {
      expect(fired({ ...base, relevance: 'required' })).toBe(true);
    });
    test('default (no relevance dial) → never fires (opt-in, non-breaking)', () => {
      expect(fired(base)).toBe(false);
    });
    test("explicit 'optional' → never fires", () => {
      expect(fired({ ...base, relevance: 'optional' })).toBe(false);
    });
    test('required but paths ARE declared → does not fire', () => {
      const r = checkDefault([rec('  - paths: src/**\n')], { ...base, relevance: 'required' });
      expect(r.findings.some((f) => f.code === 'passed_ac_missing_paths')).toBe(false);
    });
    test('required + pending AC (not passed) → does not fire', () => {
      const pending = { ...REC, body: `## Acceptance Criteria\n\n- [ ] AC-1 v2 do it\n  - status: pending\n` } as IssueRecord;
      const r = checkDefault([pending], { ...base, relevance: 'required' });
      expect(r.findings.some((f) => f.code === 'passed_ac_missing_paths')).toBe(false);
    });
  });

  test('rule: evidence captured against a stale AC version fails', () => {
    const rec: IssueRecord = { ...REC, body: REC.body.replace('AC-1 v2', 'AC-1 v3') }; // AC now v3, evidence still acv=2
    const r = checkDefault([rec], { git: { existingCommits: [HEAD] } });
    expect(r.findings.some((f) => f.code === 'evidence_ac_version_stale')).toBe(true);
  });

  describe('evidence field order-independence (anti-tamper)', () => {
    // SECURITY regression: a fabricated `image=` written AFTER `commit=` (the order the docs show)
    // must NOT be silently dropped — or the gate would pass an unverified screenshot. See parseEvidenceLine.
    const imageLast = (img: string) => ({
      ...REC,
      body: `## Acceptance Criteria\n\n- [x] AC-1 v2 do it\n  - status: passed\n  - evidence ev1: commit=${HEAD} acv=2 image=${img}\n  - proof: "ev1 shows it" -> ev1\n`,
    } as IssueRecord);

    test('image after commit is still captured by the parser', () => {
      const root = parseDefault([imageLast('shots/late.png')]) as { issues: { acceptanceCriteria: { evidence: { image?: string }[] }[] }[] };
      expect(root.issues[0]!.acceptanceCriteria[0]!.evidence[0]!.image).toBe('shots/late.png');
    });
    test('a fabricated image written AFTER commit is caught (evidence_file_not_found)', () => {
      const blobCtx = { git: { existingCommits: [HEAD], prs: {}, evidenceBlobs: { [`${HEAD}:shots/FAKE.png`]: false } } };
      const r = checkDefault([imageLast('shots/FAKE.png')], blobCtx);
      expect(r.findings.some((f) => f.code === 'evidence_file_not_found')).toBe(true);
    });
    test('a real image (present in tree) passes in image-after-commit order', () => {
      const blobCtx = { git: { existingCommits: [HEAD], prs: {}, evidenceBlobs: { [`${HEAD}:shots/real.png`]: true } } };
      const r = checkDefault([imageLast('shots/real.png')], blobCtx);
      expect(r.findings.some((f) => f.code === 'evidence_file_not_found')).toBe(false);
    });
  });
}
