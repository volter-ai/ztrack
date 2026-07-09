import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreRoot, IssueRecord, Preset } from 'ztrack/preset-kit';
import { VisualizerSpecSchema } from 'ztrack/preset-kit';
import { applyModelPatch, canonicalizeBody } from '../modelEdit.ts';
import { createMarkdownBackend } from '../backends/markdownBackend.ts';
import { viewToRecord } from '../core/loader.ts';
// NOT re-exported via `ztrack/preset-kit` (it's a write-time-validation internal, not preset-authoring
// mechanism) — this file lives IN the repo (src/testkit/), so it rents it the same way every other
// src/* module does, via a relative import (see the VIZ-2 export note on issueStatusEnumOf itself).
import { issueStatusEnumOf } from '../presetRegistry.ts';

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

// ── round-trip fidelity (ZTB-5 / dev/11 + dev/12) ────────────────────────────────────────────
// `parse -> serialize` is the sanctioned write path (`applyModelPatch`, src/modelEdit.ts). The
// contract (spelled out in docs/PRESETS.md "Round-Trip Fidelity"):
//   1. An UNMODIFIED parse -> serialize round trip is byte-identical for a body already in the
//      preset's OWN canonical (serialize()) shape — proven here two ways: a body written through
//      the real markdown backend, and (for presets that carry unknown `## X` sections) one with a
//      section sitting between two known sections.
//   2. A round trip after editing ONE model element changes only the bytes that element OWNS (an
//      AC owns its lines within the AC section; issue-level fields own their header lines) —
//      proven by patching one AC via `applyModelPatch` and diffing outside its line range.
//   3. A preset with no `serialize` is EXEMPT: `requireWritable` (src/modelEdit.ts) already
//      throws for it, so the contract is satisfied vacuously — nothing new to build.
// Grammar-agnostic and parameterized per preset, like `assertSdlcGrammarConformance` above, so
// each boilerplate preset's own test file wires it in and a position-losing regression in ANY
// writable preset is caught from one place.

const J = (r: { stdout: string }) => JSON.parse(r.stdout);

/**
 * Cases 1 (real-store fixture) + 2 (edit-locality). `canonical` must already be rendered in the
 * preset's OWN `serialize()` shape (byte-identity is proven for canonical store files — see the
 * narrowing note in docs/PRESETS.md — not for arbitrary hand-formatting). `edit` names one AC in
 * `edit.record.body` and a patch that changes it; the fixture must contain at least one OTHER
 * top-level AC line (`- [ ] <id> …` / `- [x] <id> …`) so "outside the owned region" is provable.
 */
export function assertRoundTripFidelity(p: {
  preset: Preset<CoreRoot>;
  canonical: { title: string; status: string; body: string };
  edit: { record: IssueRecord; acId: string; patch: Record<string, unknown> };
}): void {
  const { preset, canonical, edit } = p;

  test('a body written through the real markdown backend round-trips byte-identically', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ztb5-rt-'));
    const be = createMarkdownBackend(dir, 'RT');
    const created = J(await be.command(['issue', 'create', '--title', canonical.title, '--state', canonical.status, '--body', canonical.body]));
    const view = J(await be.command(['issue', 'view', created.identifier, '--json']));
    const record = viewToRecord(view, created.identifier);
    expect(record.body).toBe(canonical.body); // sanity: the backend's own round trip is invisible here

    const root = preset.schema.parse(preset.parse([record]));
    const { body } = preset.serialize!(root.issues[0]!);
    expect(body).toBe(record.body);
  });

  test('applyModelPatch on one AC changes only the bytes that AC owns', () => {
    const before = edit.record.body;
    const { body: after } = applyModelPatch(preset, edit.record, { acId: edit.acId, patch: edit.patch });
    expect(after).not.toBe(before); // sanity: the patch actually changed something

    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const acLineRe = new RegExp(`^- \\[.\\] ${edit.acId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const startIdx = beforeLines.findIndex((l) => acLineRe.test(l));
    expect(startIdx).toBeGreaterThanOrEqual(0); // the fixture must actually contain this AC
    let endIdx = beforeLines.length;
    for (let i = startIdx + 1; i < beforeLines.length; i++) {
      if (/^- \[.\] /.test(beforeLines[i]!)) { endIdx = i; break; }
    }
    // everything BEFORE the AC's block (by line index from the start) is untouched
    expect(afterLines.slice(0, startIdx)).toEqual(beforeLines.slice(0, startIdx));
    // everything AFTER the AC's block (by line index from the END — the block's OWN length can
    // change, e.g. gaining an evidence line) is untouched
    const suffix = beforeLines.slice(endIdx);
    expect(afterLines.slice(afterLines.length - suffix.length)).toEqual(suffix);
  });
}

/**
 * Case 1's position-specific edge: an unknown `## X` section BETWEEN two known sections (the
 * header fields and "## Acceptance Criteria") keeps its ORIGINAL position on an unmodified round
 * trip instead of being re-emitted at the end. Only meaningful for presets that carry unknown
 * sections (the default-family SDLC presets) — `spec`/`speckit` have no such concept and don't
 * call this.
 */
export function assertNotePositionFidelity(p: { preset: Preset<CoreRoot>; record: IssueRecord }): void {
  test('an unknown section between two known sections keeps its position on an unmodified round trip', () => {
    const root = p.preset.schema.parse(p.preset.parse([p.record]));
    const { body } = p.preset.serialize!(root.issues[0]!);
    expect(body).toBe(p.record.body);
  });
}

/**
 * Case 3: a preset with no `serialize` (a read-only adapter, e.g. `speckit`) is EXEMPT from the
 * round-trip contract by construction — demonstrates the exemption path rather than asserting
 * round-trip fidelity (there is no `serialize` to round-trip through).
 */
export function assertReadOnlyRoundTripExemption(p: { preset: Preset<CoreRoot>; record: IssueRecord }): void {
  test('a read-only preset (no serialize) is exempt from the round-trip contract via requireWritable', () => {
    expect(p.preset.serialize).toBeUndefined();
    expect(() => applyModelPatch(p.preset, p.record, { patch: {} })).toThrow(/read-only/);
    expect(() => canonicalizeBody(p.preset, p.record)).toThrow(/read-only/);
  });
}

// ── VIZ-7: visualizer-vocabulary conformance (the testkit's OWN assertion — never a shared
// runtime model, per this file's own header) ────────────────────────────────────────────────
// A user's edited `preset.mts` gets the same "your preset is testable" story the four shipped
// presets already have (docs/PRESETS.md's Round-Trip Fidelity section is the round-trip analogue).
// Three checks, all duck-typed off the preset's OWN schema/visualizer block — never a second,
// drift-prone copy of the vocabulary:
//   1. `preset.visualizer` validates against `VisualizerSpecSchema` (VIZ-1's hard boundary,
//      `src/core/engine.ts`) — a function-/markup-valued member, or a stray field, fails
//      structurally, not by convention.
//   2. `visualizer.statusOrder` equals the schema's OWN issue-status enum, via `issueStatusEnumOf`
//      (src/presetRegistry.ts, exported by VIZ-2 for exactly this) — NEVER forked/reimplemented.
//   3. Every field name a mapping carries (assignee, pr.field/urlField, acText.id/text/version,
//      acProof.field/explanation/evidenceRefs, acEvidence.field/image/commit/acVersion) actually
//      exists on the preset's own issue/AC zod schema — WHERE introspectable: a shape this
//      duck-typing can't read is skipped, not failed, matching `issueStatusEnumOf`'s own
//      "null means uninspectable" convention (it never fails a preset it can't read).
//
// `visualizerSpecConformanceProblems` is the pure, non-throwing computation (a list of
// human-readable problems; empty = conformant). `assertVisualizerSpecConformance` is the
// bun:test-registering wrapper every shipped preset's own test file calls (dev/01). Kept separate
// so a NEGATIVE fixture (dev/02) can call the pure function directly and inspect what it reports,
// rather than needing an actually-red test sitting in this suite to prove the mechanism catches drift.

// zod v4: `ZodOptional`/`ZodNullable`/`ZodDefault` (etc.) all expose the SAME public `.unwrap()`
// method that `ZodArray` does (`.unwrap()` there returns the ELEMENT type, not "itself, one layer
// down") — so unwrapping must be gated on `.def.type` (zod v4's public schema-kind tag) naming an
// actual modifier, or an array's `.unwrap()` would be mistaken for a modifier's and skip straight
// past the array to its element, losing the array itself.
const ZOD_MODIFIER_TYPES = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'nonoptional']);
function unwrapZod(schema: unknown): unknown {
  let s = schema;
  while (s && ZOD_MODIFIER_TYPES.has((s as { def?: { type?: string } }).def?.type ?? '') && typeof (s as { unwrap?: unknown }).unwrap === 'function') {
    s = (s as { unwrap: () => unknown }).unwrap();
  }
  return s;
}
function zodShape(schema: unknown): Record<string, unknown> | null {
  try {
    const s = unwrapZod(schema) as { shape?: Record<string, unknown> } | null;
    return s?.shape ?? null;
  } catch { return null; }
}
function zodElement(schema: unknown): unknown | null {
  try {
    const s = unwrapZod(schema) as { element?: unknown } | null;
    return s?.element ?? null;
  } catch { return null; }
}
// The preset's own AC array element shape — every shipped preset (and every preset this targets)
// names its AC-unit array `acceptanceCriteria` on the issue shape (see e.g. simple-sdlc.ts,
// spec.ts, speckit.ts); `null` when unreadable, exactly like `issueStatusEnumOf`.
function issueShapeOf(preset: Preset<CoreRoot>): Record<string, unknown> | null {
  const rootShape = zodShape(preset.schema);
  return rootShape ? zodShape(zodElement(rootShape.issues)) : null;
}
function acShapeOf(preset: Preset<CoreRoot>): Record<string, unknown> | null {
  const issueShape = issueShapeOf(preset);
  return issueShape ? zodShape(zodElement(issueShape.acceptanceCriteria)) : null;
}

/** Pure: the list of VIZ-7 conformance problems for `preset` (empty = conformant). Never throws —
 *  an uninspectable schema shape is silently skipped (see the module note above), not reported. */
export function visualizerSpecConformanceProblems(preset: Preset<CoreRoot>): string[] {
  const problems: string[] = [];
  const v = preset.visualizer;
  if (!v) return [`${preset.name} declares no \`visualizer\` block (VIZ-1/VIZ-2).`];

  const parsed = VisualizerSpecSchema.safeParse(v);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
    problems.push(`${preset.name}'s visualizer block fails VisualizerSpecSchema: ${detail}`);
  }

  const schemaEnum = issueStatusEnumOf(preset);
  // `Array.isArray` guard: a `visualizer.statusOrder` that already failed VisualizerSpecSchema
  // above (e.g. not an array at all) has nothing sensible to diff against the enum — the schema
  // violation reported above already covers it.
  if (schemaEnum && Array.isArray(v.statusOrder)) {
    // Name the SPECIFIC offending status(es) when there is one — a status the block declares that
    // the schema's enum simply does not have (dev/02's exact failure shape: a renamed/typo'd
    // status). Any OTHER kind of drift (a real status missing from the block, a reorder, a
    // duplicate) is still reported, just without a bogus status to name.
    const unknown = v.statusOrder.filter((s) => !schemaEnum.includes(s));
    if (unknown.length) {
      problems.push(`${preset.name}'s visualizer.statusOrder lists status(es) ${unknown.map((s) => `"${s}"`).join(', ')} absent from its issue-status enum (${schemaEnum.join(', ')}).`);
    } else if (schemaEnum.length !== v.statusOrder.length || schemaEnum.some((s, i) => s !== v.statusOrder[i])) {
      problems.push(`${preset.name}'s visualizer.statusOrder (${v.statusOrder.join(', ')}) does not equal its issue-status enum (${schemaEnum.join(', ')}).`);
    }
  }

  const issueShape = issueShapeOf(preset);
  const acShape = acShapeOf(preset);
  const checkField = (shape: Record<string, unknown> | null, key: string | undefined, mapping: string, schemaName: string) => {
    if (!key || !shape) return; // not mapped, or this schema shape isn't introspectable — skip
    if (!(key in shape)) problems.push(`${preset.name}'s visualizer.${mapping} names field "${key}", which does not exist on its ${schemaName} schema.`);
  };

  checkField(issueShape, v.assignee, 'assignee', 'issue');
  if (v.pr) {
    checkField(issueShape, v.pr.field, 'pr.field', 'issue');
    checkField(issueShape ? zodShape(issueShape[v.pr.field]) : null, v.pr.urlField, 'pr.urlField', 'pr');
  }
  if (v.acText) {
    checkField(acShape, v.acText.id, 'acText.id', 'AC');
    checkField(acShape, v.acText.text, 'acText.text', 'AC');
    checkField(acShape, v.acText.version, 'acText.version', 'AC');
  }
  if (v.acProof) {
    checkField(acShape, v.acProof.field, 'acProof.field', 'AC');
    const proofShape = acShape ? zodShape(acShape[v.acProof.field]) : null;
    checkField(proofShape, v.acProof.explanation, 'acProof.explanation', 'proof');
    checkField(proofShape, v.acProof.evidenceRefs, 'acProof.evidenceRefs', 'proof');
  }
  if (v.acEvidence) {
    checkField(acShape, v.acEvidence.field, 'acEvidence.field', 'AC');
    const evidenceElementShape = acShape ? zodShape(zodElement(acShape[v.acEvidence.field])) : null;
    checkField(evidenceElementShape, v.acEvidence.image, 'acEvidence.image', 'evidence');
    checkField(evidenceElementShape, v.acEvidence.commit, 'acEvidence.commit', 'evidence');
    checkField(evidenceElementShape, v.acEvidence.acVersion, 'acEvidence.acVersion', 'evidence');
  }

  return problems;
}

/** bun:test-registering wrapper (dev/01): every shipped preset's own test file calls this with
 *  ITS preset, exactly like `assertSdlcGrammarConformance`/`assertRoundTripFidelity` above — the
 *  no-shared-model invariant holds (only the TEST is shared; each preset owns its own visualizer
 *  block and schema). A preset with a real conformance problem shows it here, named. */
export function assertVisualizerSpecConformance(preset: Preset<CoreRoot>): void {
  test(`${preset.name}: visualizer block conforms (VisualizerSpecSchema + issueStatusEnumOf + its own field mappings — VIZ-7)`, () => {
    expect(visualizerSpecConformanceProblems(preset)).toEqual([]);
  });
}
