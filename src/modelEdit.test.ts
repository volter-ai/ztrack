import { describe, expect, test } from 'bun:test';
import { applyModelPatch, canonicalizeBody } from './modelEdit.ts';
import { frameIssueMarkdown, framedFromView } from './core/loader.ts';
import DefaultPreset, { DefaultRootSchema, parseDefault } from '../boilerplates/presets/default.ts';
import SpeckitPreset from '../boilerplates/presets/speckit.ts';
import type { CoreRoot, Preset } from './core/engine.ts';

const def = DefaultPreset as unknown as Preset<CoreRoot>;
const speckit = SpeckitPreset as unknown as Preset<CoreRoot>;

const PENDING = `# APP-1: A case

Summary: do it
Status: draft

## Acceptance Criteria

- [ ] dev/01 v1 Build the thing
  - status: pending
`;

describe('modelEdit: mutation is parse -> edit typed model -> serialize', () => {
  test('ac patch overlays a typed fragment and re-serializes in the preset grammar', () => {
    const patch = {
      checked: true, status: 'passed',
      evidence: [{ id: 'ev1', image: 's.png', commit: 'abc1234', acVersion: 1 }],
      proof: { explanation: 'ev1 shows it', evidenceRefs: ['ev1'] },
    };
    const { body, changed } = applyModelPatch(def, PENDING, { acId: 'dev/01', patch });
    expect(changed).toBe(true);
    // rendered in default's OWN grammar (nested status/evidence/proof, no [En]/AC-Version)
    expect(body).toContain('- [x] dev/01 v1 Build the thing');
    expect(body).toContain('  - status: passed');
    expect(body).toContain('  - evidence ev1: image=s.png commit=abc1234 acv=1');
    expect(body).toContain('  - proof: "ev1 shows it" -> ev1');
    expect(body).not.toMatch(/AC-Version|## Evidence|\[E1\]/);
  });

  test('a patch that violates the hard schema fails loudly (no silently-misparsing body)', () => {
    expect(() => applyModelPatch(def, PENDING, { acId: 'dev/01', patch: { status: 'shipped' } }))
      .toThrow(/invalid 'default' issue/);
  });

  test('patching an unknown AC id throws', () => {
    expect(() => applyModelPatch(def, PENDING, { acId: 'dev/99', patch: { status: 'passed' } }))
      .toThrow(/AC dev\/99 not found/);
  });

  test('issue-level patch overlays the issue', () => {
    const { body } = applyModelPatch(def, PENDING, { patch: { status: 'ready' } });
    expect(body).toContain('Status: ready');
  });

  test('canonicalizeBody round-trips through the preset (fmt)', () => {
    const messy = '#   APP-1: A case\n\n\nSummary: do it\nStatus: draft\n\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 Build the thing   \n  - status: pending\n';
    expect(canonicalizeBody(def, messy)).toBe(PENDING);
  });

  test('the universal `## Waivers` section survives a patch (core markdown, not in the schema)', () => {
    const withWaiver = `${PENDING}\n## Waivers\n\n- code: evidence_commit_not_found reason: known flaky by: alice\n`;
    const { body } = applyModelPatch(def, withWaiver, { acId: 'dev/01', patch: { status: 'failed' } });
    expect(body).toContain('- [ ] dev/01 v1 Build the thing');
    expect(body).toContain('  - status: failed');
    expect(body).toContain('## Waivers');
    expect(body).toContain('- code: evidence_commit_not_found reason: known flaky by: alice');
  });

  test('framing is idempotent: a self-contained body (already has a # heading) is not re-framed', () => {
    const selfContained = '# APP-1: Title\n\nStatus: draft\n\n## Acceptance Criteria\n\n- [ ] dev/01 v1 x\n  - status: pending\n';
    // content-only body gets framed with the metadata header
    const framed = frameIssueMarkdown({ id: 'APP-1', title: 'Title', body: '## Acceptance Criteria\n\n- [ ] dev/01 v1 x\n  - status: pending\n', state: 'draft' });
    expect(framed.startsWith('# APP-1: Title')).toBe(true);
    // a body that already carries its heading is returned as-is (no duplicate heading)
    expect(frameIssueMarkdown({ id: 'APP-1', title: 'Title', body: selfContained })).toBe(selfContained);
  });

  test('framedFromView unwraps the nested GraphQL view shape (state/assignee/labels)', () => {
    const view = {
      identifier: 'APP-1', title: 'T', body: '## Acceptance Criteria\n\n- [ ] dev/01 v1 x\n  - status: pending\n',
      state: { name: 'ready', type: 'open' }, assignee: { name: 'dev' }, labels: { nodes: [{ name: 'type:case' }] },
    };
    const framed = framedFromView(view, 'APP-1');
    expect(framed).toContain('Status: ready');     // not "[object Object]"
    expect(framed).toContain('Assignee: dev');
    expect(framed).toContain('Labels: type:case');
    // and it parses cleanly against the preset (the write path's precondition)
    expect(DefaultRootSchema.parse(parseDefault(framed)).issues[0]!.id).toBe('APP-1');
  });

  test('a read-only adapter preset (no serialize) refuses patch and fmt', () => {
    expect(speckit.serialize).toBeUndefined();
    expect(() => applyModelPatch(speckit, PENDING, { patch: {} })).toThrow(/read-only/);
    expect(() => canonicalizeBody(speckit, PENDING)).toThrow(/read-only/);
  });
});
