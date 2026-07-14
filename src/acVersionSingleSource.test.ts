// ztrack#21 — "ac check/ac set-status: mutation-phase AC-Version disagrees with
// validation-phase AC-Version for identical input, refusing the mutation" (filed against
// ztrack@0.3.0, whose mutation and validation phases each ran their OWN computed-hash
// AC-version derivation — `acv_4504f01a3b62` vs `acv_ffbcd06842d6` for one static input).
//
// At 1.x the disagreement is structurally unrepresentable: there is NO computed AC-version
// anywhere. An AC's version is the EXPLICIT `v<N>` integer on its own line (`- [ ] dev/01 v1 …`),
// evidence carries the explicit `acv=<n>` it was captured against, and the only "phase" that
// compares them is the `evidence_ac_version_stale` rule — reading both integers off the same
// parsed model. The mutation path (`ac patch`) stamps nothing; it writes the fields it is given.
// (The 0.3.0 computed-hash module, src/acVersion.ts, was removed in #19 with zero callers.)
//
// These tests PIN that single-source-of-truth design so #21's failure mode cannot regress:
// the version a mutation writes is byte-for-byte the version validation reads — same static
// input, one derivation, no second phase to disagree with. The last test is a source meta-scan
// (this repo's docsConsistency style) asserting no computed AC-version derivation reappears in
// shipping code.
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { applyModelPatch } from './modelEdit.ts';
import DefaultPreset, { checkDefault, parseDefault } from '../boilerplates/presets/simple-sdlc.ts';
import type { CoreRoot, IssueRecord, Preset } from './core/engine.ts';

const def = DefaultPreset as unknown as Preset<CoreRoot>;
const HEAD = 'abc1234';

const PENDING: IssueRecord = {
  id: 'APP-1', title: 'A case', status: 'in-progress', assignee: 'otto',
  body: 'Summary: do it\n\n## Acceptance Criteria\n\n- [ ] dev/01 v3 Build the thing\n  - status: pending\n',
};

describe('ztrack#21: AC version is one explicit value across the mutation and validation phases', () => {
  test('the version a mutation writes is exactly the version validation reads — identical input, zero disagreement', () => {
    // mutation phase: mark passed, citing evidence captured against the AC's CURRENT version (v3)
    const { body } = applyModelPatch(def, PENDING, {
      acId: 'dev/01',
      patch: {
        status: 'passed', checked: true,
        evidence: [{ id: 'ev1', commit: HEAD, acVersion: 3 }],
        proof: { explanation: 'ev1 shows it', evidenceRefs: ['ev1'] },
      },
    });
    expect(body).toContain('- [x] dev/01 v3 Build the thing');
    expect(body).toContain(`  - evidence ev1: commit=${HEAD} acv=3`);

    // validation phase: the SAME serialized bytes, parsed back — both integers land unchanged…
    const after: IssueRecord = { ...PENDING, body };
    const root = parseDefault([after]) as { issues: Array<{ acceptanceCriteria: Array<{ version: number; evidence: Array<{ acVersion: number }> }> }> };
    expect(root.issues[0]!.acceptanceCriteria[0]!.version).toBe(3);
    expect(root.issues[0]!.acceptanceCriteria[0]!.evidence[0]!.acVersion).toBe(3);

    // …and the version rule agrees with the mutation: no stale finding, no refusal, for the
    // exact input the mutation just produced. (0.3.0's two phases disagreed on THIS comparison.)
    const r = checkDefault([after], { git: { existingCommits: [HEAD] } });
    expect(r.findings.filter((f) => f.code === 'evidence_ac_version_stale')).toEqual([]);
  });

  test('a real version mismatch is two explicit integers, reported with both values — never a hash disagreement', () => {
    const stale: IssueRecord = {
      ...PENDING,
      body: PENDING.body
        .replace('- [ ] dev/01 v3', '- [x] dev/01 v3')
        .replace('  - status: pending', `  - status: passed\n  - evidence ev1: commit=${HEAD} acv=2\n  - proof: "ev1 shows it" -> ev1`),
    };
    const r = checkDefault([stale], { git: { existingCommits: [HEAD] } });
    const finding = r.findings.find((f) => f.code === 'evidence_ac_version_stale');
    expect(finding).toBeDefined();
    expect(finding!.message).toContain('v2');
    expect(finding!.message).toContain('v3');
  });

  test('no hidden recompute: editing the AC text does not silently change its version', () => {
    const { body } = applyModelPatch(def, PENDING, { acId: 'dev/01', patch: { text: 'Build the OTHER thing' } });
    // the explicit version is untouched — bumping it on a text change is the AUTHOR's decision
    // (evidence_ac_version_stale is what then makes old evidence visible as stale), not a
    // derivation the tool re-runs behind the author's back.
    expect(body).toContain('- [ ] dev/01 v3 Build the OTHER thing');
  });

  test('meta-scan: no computed AC-version derivation exists anywhere in shipping code', () => {
    // The 0.3.0 bug was a computed `acv_<hash>` derived independently in two phases. Assert the
    // removed module (src/acVersion.ts, deleted in #19) stays deleted and no shipping source
    // regrows a computed derivation — tests and this file excluded.
    const roots = ['src', 'boilerplates'];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts') || p.endsWith('.test.ts') || p.includes('.fixtures')) continue;
        const text = readFileSync(p, 'utf8');
        if (/acVersionFor|acv_[0-9a-f]/.test(text)) offenders.push(p);
      }
    };
    for (const root of roots) walk(join(import.meta.dir, '..', root));
    expect(offenders).toEqual([]);
  });
});
