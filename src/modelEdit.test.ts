import { describe, expect, test } from 'bun:test';
import { applyModelPatch, canonicalizeBody } from './modelEdit.ts';
import DefaultPreset from '../boilerplates/presets/default.ts';
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
      .toThrow(/invalid 'default' issue/);
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
});
