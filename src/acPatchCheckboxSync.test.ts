// ztrack#22 — "ac set-status doesn't sync markdown checkbox mirror when status changes to
// non-passed" (filed against the 0.3.0-era `ac set-status`; the 1.x mutation surface is
// `ac patch`).
//
// The 1.x shape of the defect: `checked` and `status` are independent schema fields whose
// coupling (`[x]` iff `status: passed`) is enforced only AFTER the fact, by the preset's
// `ac_checkbox_status_mismatch` rule. So `ac patch <issue> <ac> --json '{"status":"failed"}'` on
// a passed AC wrote `- [x] … status: failed` — the checkbox mirror desynchronized by the very
// mutation tool, exactly as reported — and RE-running the same patch was a `changed: false`
// no-op that could never repair it. The old workaround (also reported) destroyed state:
// patching `checked` required naming both fields, and getting it wrong stripped nothing here but
// left the contradiction for the validator.
//
// The fix: the preset-owned `normalizeAcPatch` hook (Preset interface, applied in
// modelEdit.ts's applyModelPatch) keeps the coupled fields consistent when a patch names only
// one of them — status drives the checkbox; checking implies passed; unchecking a passed AC
// demotes it to pending. An explicit field in the caller's patch always wins. Evidence/
// proof/paths and Commit-equivalent fields on the row are untouched (the issue's other
// complaint: `ac uncheck` destroyed evidence citations just to fix the mirror).
import { describe, expect, test } from 'bun:test';
import { applyModelPatch } from './modelEdit.ts';
import DefaultPreset, { checkDefault } from '../boilerplates/presets/simple-sdlc.ts';
import GhPreset from '../boilerplates/presets/simple-gh-sdlc.ts';
import type { CoreRoot, IssueRecord, Preset } from './core/engine.ts';

const def = DefaultPreset as unknown as Preset<CoreRoot>;
const gh = GhPreset as unknown as Preset<CoreRoot>;

const HEAD = 'abc1234';
// A checked, passed AC with evidence + proof — the exact starting shape from the issue's repro
// ("AC row starts as `- [x] dev/02 status: passed …`").
const PASSED: IssueRecord = {
  id: 'APP-1', title: 'A case', status: 'in-progress', assignee: 'otto',
  body: [
    'Summary: do it',
    '',
    '## Acceptance Criteria',
    '',
    `- [x] dev/01 v1 Build the thing`,
    '  - status: passed',
    `  - evidence ev1: commit=${HEAD} acv=1`,
    '  - proof: "ev1 shows it" -> ev1',
    '',
  ].join('\n'),
};

describe('ztrack#22: a status-only ac patch keeps the checkbox mirror in sync', () => {
  test('passed → failed syncs [x] to [ ] without touching evidence/proof', () => {
    const { body, changed } = applyModelPatch(def, PASSED, { acId: 'dev/01', patch: { status: 'failed' } });
    expect(changed).toBe(true);
    expect(body).toContain('- [ ] dev/01 v1 Build the thing'); // the issue's step-3 row was `- [x] … status: failed`
    expect(body).toContain('  - status: failed');
    // the historical evidence citations survive — the issue's complaint about the `ac uncheck`
    // workaround was precisely that it stripped these.
    expect(body).toContain(`  - evidence ev1: commit=${HEAD} acv=1`);
    expect(body).toContain('  - proof: "ev1 shows it" -> ev1');
  });

  test('the written result is validator-clean: no ac_checkbox_status_mismatch after a status-only patch', () => {
    const { body } = applyModelPatch(def, PASSED, { acId: 'dev/01', patch: { status: 'failed' } });
    const after: IssueRecord = { ...PASSED, body };
    const r = checkDefault([after], { git: { existingCommits: [HEAD] } });
    expect(r.findings.filter((f) => f.code === 'ac_checkbox_status_mismatch')).toEqual([]);
  });

  test('pending → passed (status-only) syncs [ ] to [x]', () => {
    const pending: IssueRecord = {
      ...PASSED,
      body: PASSED.body
        .replace('- [x] dev/01', '- [ ] dev/01')
        .replace('  - status: passed', '  - status: pending'),
    };
    const { body } = applyModelPatch(def, pending, {
      acId: 'dev/01',
      patch: { status: 'passed', evidence: [{ id: 'ev1', commit: HEAD, acVersion: 1 }], proof: { explanation: 'ev1 shows it', evidenceRefs: ['ev1'] } },
    });
    expect(body).toContain('- [x] dev/01 v1 Build the thing');
    expect(body).toContain('  - status: passed');
  });

  test('a checked-only patch implies the coupled status: true → passed; false on a passed AC → pending', () => {
    const pending: IssueRecord = {
      ...PASSED,
      body: PASSED.body
        .replace('- [x] dev/01', '- [ ] dev/01')
        .replace('  - status: passed', '  - status: pending'),
    };
    const checkedUp = applyModelPatch(def, pending, { acId: 'dev/01', patch: { checked: true } });
    expect(checkedUp.body).toContain('- [x] dev/01');
    expect(checkedUp.body).toContain('  - status: passed');

    const unchecked = applyModelPatch(def, PASSED, { acId: 'dev/01', patch: { checked: false } });
    expect(unchecked.body).toContain('- [ ] dev/01');
    expect(unchecked.body).toContain('  - status: pending');
  });

  test('unchecking an already-failed AC keeps failed (already [ ]-consistent — no silent status rewrite)', () => {
    const failed: IssueRecord = {
      ...PASSED,
      body: PASSED.body
        .replace('- [x] dev/01', '- [ ] dev/01')
        .replace('  - status: passed', '  - status: failed'),
    };
    const { body, changed } = applyModelPatch(def, failed, { acId: 'dev/01', patch: { checked: false } });
    expect(changed).toBe(false); // a genuine no-op stays a no-op
    expect(body).toContain('  - status: failed');
  });

  test('an EXPLICIT checked in the patch always wins over the derived value', () => {
    const { body } = applyModelPatch(def, PASSED, { acId: 'dev/01', patch: { status: 'failed', checked: true } });
    expect(body).toContain('- [x] dev/01'); // the caller asked for the contradiction; the rule may flag it, but the patch is honored
    expect(body).toContain('  - status: failed');
  });

  test('a patch naming neither coupled field passes through untouched', () => {
    const { body } = applyModelPatch(def, PASSED, { acId: 'dev/01', patch: { evidence: [{ id: 'ev2', commit: HEAD, acVersion: 1 }] } });
    expect(body).toContain('- [x] dev/01');
    expect(body).toContain('  - status: passed');
    expect(body).toContain(`  - evidence ev2: commit=${HEAD} acv=1`);
  });

  test('simple-gh-sdlc couples the same two fields the same way', () => {
    const { body } = applyModelPatch(gh, PASSED, { acId: 'dev/01', patch: { status: 'failed' } });
    expect(body).toContain('- [ ] dev/01 v1 Build the thing');
    expect(body).toContain('  - status: failed');
  });
});
