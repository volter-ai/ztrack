// PROOF that the preset `ztrack init` INSTALLS into a repo (boilerplates/presets/preset.cjs,
// vendored records) is behaviorally identical to the in-package createGenericPreset factory
// it replaced. Renders the template for every init variant, loads it as a consumer would
// (require, with the 'ztrack/preset-kit' specifier pointed at source), and asserts findings
// match createGenericPreset({same flags}) over a battery. Guards drift between the shipped
// reference factory and the vendored template.
import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkRoot, type Context, type Finding, type Preset, type CoreRoot } from './core/engine.ts';
import { createGenericPreset } from './presetKit.ts';

const kitPath = fileURLToPath(new URL('./presetKit.ts', import.meta.url));
const template = readFileSync(fileURLToPath(new URL('../boilerplates/presets/preset.cjs', import.meta.url)), 'utf8');
const req = createRequire(import.meta.url);

interface Cfg { requireSourceMarker: boolean; requireSdlcGates: boolean; requireSpecSections: boolean; requireSpeckitSections: boolean }

// the four init presets and their flags (mirrors config.ts presetBooleans).
const VARIANTS: Array<{ preset: string; cfg: Cfg }> = [
  { preset: 'basic', cfg: { requireSourceMarker: false, requireSdlcGates: false, requireSpecSections: false, requireSpeckitSections: false } },
  { preset: 'simple-sdlc', cfg: { requireSourceMarker: true, requireSdlcGates: true, requireSpecSections: false, requireSpeckitSections: false } },
  { preset: 'simple-spec', cfg: { requireSourceMarker: true, requireSdlcGates: false, requireSpecSections: true, requireSpeckitSections: false } },
  { preset: 'speckit', cfg: { requireSourceMarker: true, requireSdlcGates: false, requireSpecSections: false, requireSpeckitSections: true } },
];

function loadInstalled(preset: string, cfg: Cfg): Preset<CoreRoot> {
  const tokens: Record<string, string> = {
    __ZTRACK_PRESET_NAME__: preset,
    __ZTRACK_REQUIRE_SOURCE_MARKER__: String(cfg.requireSourceMarker),
    __ZTRACK_REQUIRE_SDLC_GATES__: String(cfg.requireSdlcGates),
    __ZTRACK_REQUIRE_SPEC_SECTIONS__: String(cfg.requireSpecSections),
    __ZTRACK_REQUIRE_SPECKIT_SECTIONS__: String(cfg.requireSpeckitSections),
  };
  let text = template;
  for (const [k, v] of Object.entries(tokens)) text = text.replaceAll(k, v);
  // a consumer resolves 'ztrack/preset-kit' from node_modules; in-repo, point it at source.
  text = text.replace("require('ztrack/preset-kit')", `require(${JSON.stringify(kitPath)})`);
  const file = join(tmpdir(), `ztrack-installed-${preset}.cjs`);
  writeFileSync(file, text);
  delete (req as unknown as { cache?: Record<string, unknown> }).cache?.[file];
  return req(file) as Preset<CoreRoot>;
}

const canon = (fs: Finding[]) =>
  fs.map((f) => ({ code: f.code, severity: f.severity, message: f.message, issueId: f.issueId ?? null, acId: f.acId ?? null, evidenceId: f.evidenceId ?? null }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

// ── battery: constructed roots exercising rule families (parser/schema are shared, so
// equivalence over a parsed root isolates rules + derive + isIssueDone). ──
const ev = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'evidence', ...extra });
const ac = (id: string, o: Record<string, unknown> = {}) => ({ id, status: 'pending', evidence: [], checked: false, text: 't', type: 'ac', sourceRefs: [], commitHashes: [], evidenceRefs: [], ...o });
const issue = (id: string, o: Record<string, unknown> = {}) => ({ id, title: 't', summary: '', status: 'open', acceptanceCriteria: [], stateType: 'open', assignee: 'otto', labels: [], sourceMarkers: [], sections: [], ...o });

const HEAD = 'cafe1234beef';
const battery: Array<{ root: CoreRoot; ctx: Context }> = [
  // duplicate issue id
  { root: { issues: [issue('X-1'), issue('X-1')] }, ctx: {} },
  // checkbox/status mismatch + missing assignee + checked-AC missing commit & evidence
  { root: { issues: [issue('X-2', { assignee: '', acceptanceCriteria: [ac('AC-01', { checked: true, status: 'pending' }), ac('AC-02', { checked: true, status: 'passed' })] })] }, ctx: { git: { existingCommits: [HEAD] } } },
  // checked AC with a missing commit hash and an unknown evidence ref
  { root: { issues: [issue('X-3', { acceptanceCriteria: [ac('AC-01', { checked: true, status: 'passed', commitHashes: ['deadbeef'], evidenceRefs: ['E9'], evidence: [ev('E1')] })] })] }, ctx: { git: { existingCommits: [HEAD] } } },
  // blocking: self-block + missing blocker
  { root: { issues: [issue('X-4', { acceptanceCriteria: [ac('dev/01', { blockedBy: [{ issue: 'X-4', ac: 'dev/01' }] }), ac('dev/02', { blockedBy: [{ issue: 'X-4', ac: 'nope' }] })] })] }, ctx: {} },
  // blocking cycle
  { root: { issues: [issue('X-5', { acceptanceCriteria: [ac('dev/01', { blockedBy: [{ issue: 'X-5', ac: 'dev/02' }] }), ac('dev/02', { blockedBy: [{ issue: 'X-5', ac: 'dev/01' }] })] })] }, ctx: {} },
  // sections present vs absent (exercises requireSpec/Speckit section rules); no source markers; canceled + done states
  { root: { issues: [
    issue('X-6', { sections: ['Summary'], sourceMarkers: [], stateType: 'canceled' }),
    issue('X-7', { stateType: 'done', status: 'done', acceptanceCriteria: [ac('AC-01', { checked: false, status: 'pending' })] }),
  ] }, ctx: {} },
];

describe('installed preset template === createGenericPreset', () => {
  let anyFindings = 0;
  for (const { preset, cfg } of VARIANTS) {
    test(`variant ${preset}`, () => {
      const installed = loadInstalled(preset, cfg);
      const factory = createGenericPreset({ name: preset, ...cfg });
      // the installed file is a real core preset
      expect(typeof installed.name).toBe('string');
      expect(typeof installed.parse).toBe('function');
      expect(Array.isArray(installed.rules)).toBe(true);
      for (const { root, ctx } of battery) {
        const inst = checkRoot(installed, root, ctx);
        const fac = checkRoot(factory, root, ctx);
        anyFindings += fac.findings.length;
        expect(canon(inst.findings)).toEqual(canon(fac.findings));
        expect(inst.ok).toBe(fac.ok);
      }
    });
  }
  test('the battery actually exercised rules (non-vacuous)', () => {
    expect(anyFindings).toBeGreaterThan(0);
  });
});
