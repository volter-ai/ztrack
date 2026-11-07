import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyModelPatch, canonicalizeBody } from './modelEdit.ts';
import DefaultPreset from '../boilerplates/presets/simple-sdlc.ts';
import SpeckitPreset from '../boilerplates/presets/speckit.ts';
import type { CoreRoot, IssueRecord, Preset } from './core/engine.ts';

const def = DefaultPreset as unknown as Preset<CoreRoot>;
const speckit = SpeckitPreset as unknown as Preset<CoreRoot>;

// The structured record: metadata in fields, body is CONTENT-ONLY (no `# id: title`, no Status: line).
const PENDING: IssueRecord = {
  id: 'APP-1', title: 'A case', status: 'draft',
  body: 'Summary: do it\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 Build the thing\n  - status: pending\n',
};

describe('modelEdit: mutation is parse -> edit typed model -> serialize', () => {
  test('ac patch overlays a typed fragment and re-serializes in the preset grammar', () => {
    const patch = {
      checked: true, status: 'passed',
      evidence: [{ id: 'ev1', commit: 'abc1234', acVersion: 1 }],
      proof: { explanation: 'ev1 shows it', evidenceRefs: ['ev1'] },
    };
    const { body, changed } = applyModelPatch(def, PENDING, { acId: 'dev/01', patch });
    expect(changed).toBe(true);
    // rendered in default's OWN grammar (nested status/evidence/proof, no [En]/AC-Version)
    expect(body).toContain('- [x] dev/01 v1 Build the thing');
    expect(body).toContain('  - status: passed');
    expect(body).toContain('  - evidence ev1: commit=abc1234 acv=1');
    expect(body).toContain('  - proof: "ev1 shows it" -> ev1');
    expect(body).not.toMatch(/AC-Version|## Evidence|\[E1\]/);
    // body is CONTENT-ONLY: no synthesized metadata header (no `# APP-1`, no Status: line)
    expect(body).not.toMatch(/^# |^Status:/m);
  });

  test('a patch that violates the hard schema fails loudly (no silently-misparsing body)', () => {
    expect(() => applyModelPatch(def, PENDING, { acId: 'dev/01', patch: { status: 'shipped' } }))
      .toThrow(/invalid 'simple-sdlc' issue/);
  });

  test('patching an unknown AC id throws', () => {
    expect(() => applyModelPatch(def, PENDING, { acId: 'dev/99', patch: { status: 'passed' } }))
      .toThrow(/AC dev\/99 not found/);
  });

  test('issue-level status patch surfaces in columns.status, never in the body', () => {
    const { body, columns } = applyModelPatch(def, PENDING, { patch: { status: 'ready' } });
    expect(columns.status).toBe('ready');
    // status is a column (metadata), not body content — the body carries no Status: line
    expect(body).not.toMatch(/^Status:/m);
  });

  test('a body that triggers parse DIAGNOSTICS (warnings) is still editable — the side-channel never reaches the strict schema', () => {
    const noisy: IssueRecord = {
      id: 'APP-1', title: 'A case', status: 'draft',
      // the stray PREAMBLE checkbox emits ac_outside_section (ZTB-1) — advisory, not a grammar
      // error. (It must be in the preamble: splitNotes carves unknown `## X` sections out before
      // the walk, so a checkbox inside one never reaches the diagnostic.)
      body: 'Summary: do it\n\n- [ ] a stray checkbox outside the AC section\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 Build the thing\n  - status: pending\n',
    };
    const { body, changed } = applyModelPatch(def, noisy, { acId: 'dev/01', patch: { status: 'passed', checked: true } });
    expect(changed).toBe(true);
    expect(body).toContain('- [x] dev/01 v1 Build the thing');
  });

  test('canonicalizeBody round-trips through the preset (fmt)', () => {
    const messy: IssueRecord = {
      id: 'APP-1', title: 'A case', status: 'draft',
      body: 'Summary: do it\n\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 Build the thing   \n  - status: pending\n',
    };
    const { body, columns } = canonicalizeBody(def, messy);
    expect(body).toBe(PENDING.body);
    expect(columns.status).toBe('draft');
    expect(columns.title).toBe('A case');
  });

  test('the universal `## Waivers` section survives a patch (core markdown, not in the schema)', () => {
    const withWaiver: IssueRecord = {
      ...PENDING,
      body: `${PENDING.body}\n## Waivers\n\n- code: evidence_commit_not_found reason: known flaky by: alice\n`,
    };
    const { body } = applyModelPatch(def, withWaiver, { acId: 'dev/01', patch: { status: 'failed' } });
    expect(body).toContain('- [ ] dev/01 v1 Build the thing');
    expect(body).toContain('  - status: failed');
    expect(body).toContain('## Waivers');
    expect(body).toContain('- code: evidence_commit_not_found reason: known flaky by: alice');
  });

  test('a read-only adapter preset (no serialize) refuses patch and fmt', () => {
    expect(speckit.serialize).toBeUndefined();
    expect(() => applyModelPatch(speckit, PENDING, { patch: {} })).toThrow(/read-only/);
    expect(() => canonicalizeBody(speckit, PENDING)).toThrow(/read-only/);
  });

  // ZTB-21 dev/01: `ac patch --json` proof shape errors used to be drip-fed — passing an array
  // errored "expected object" with no hint of the real shape; only a SECOND failed attempt
  // (unwrapped fields flattened onto the AC) revealed it via "Unrecognized key". Both cases must
  // now state the full `{explanation, evidenceRefs}` contract on the FIRST error.
  test('proof patched as an array states the expected object shape on the first error', () => {
    expect(() => applyModelPatch(def, PENDING, { acId: 'dev/01', patch: { proof: ['ev1 shows it', 'ev1'] } }))
      .toThrow(/proof: .*expected object.*expected shape \{explanation: string, evidenceRefs: string\[\]\}/);
  });

  test('proof fields flattened onto the AC (missing the `proof` wrapper) get a nesting hint + shape', () => {
    expect(() => applyModelPatch(def, PENDING, { acId: 'dev/01', patch: { explanation: 'ev1 shows it' } }))
      .toThrow(/did you mean to nest these under "proof"\? expected shape \{explanation: string, evidenceRefs: string\[\]\}/);
  });

  // ZTB-16 dev/01: modelEdit.ts used a literal NUL byte as the label-list join separator for the
  // `changed` comparison. A NUL byte in source makes git/tooling treat the whole file as binary
  // (`git diff` stops rendering a text diff, `file` reports "data"). The separator itself never
  // persists to disk (it only feeds a `!==` comparison discarded after producing a boolean), so
  // the fix keeps the exact same runtime separator character via a `\x00` escape sequence instead
  // of a literal byte — source becomes plain text, behavior is unchanged.
  test('modelEdit.ts source has no literal NUL byte (git must keep treating it as text)', () => {
    const raw = readFileSync(join(import.meta.dir, 'modelEdit.ts'));
    expect(raw.includes(0)).toBe(false);
  });

  test('a labels-only patch is detected as changed, and a no-op labels patch is not', () => {
    const withLabels: IssueRecord = { ...PENDING, labels: ['area:core', 'p1'] };
    const relabeled = applyModelPatch(def, withLabels, { patch: { labels: ['area:core', 'p2'] } });
    expect(relabeled.changed).toBe(true);
    expect(relabeled.columns.labels).toEqual(['area:core', 'p2']);

    const sameLabels = applyModelPatch(def, withLabels, { patch: { labels: ['area:core', 'p1'] } });
    expect(sameLabels.changed).toBe(false);
  });
});
