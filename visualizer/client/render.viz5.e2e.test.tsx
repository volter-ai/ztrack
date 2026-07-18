// VIZ-5: the drift guard the dead `default` key never had. VIZ-4 proved the mechanism (DOM
// render from real payload data + a registered code extension) for exactly two hand-picked
// presets (simple-sdlc, speckit). This suite makes that coverage total: it ITERATES
// `presetManifest()` (`src/presetCatalog.ts` — the same scan-based catalog `ztrack init --list`
// and every other manifest-driven test read) and, for EVERY preset it discovers, boots a REAL
// `ztrack init --preset <name>` fixture, boots the REAL server, and renders the REAL
// `visualizer/client/main.tsx` in happy-dom against that server's own `/api/board` payload — no
// hardcoded preset-name list anywhere (that is the exact banned pattern this whole build removes,
// `docs/PRESETS.md`'s dead `default` key). A renamed or newly added preset with no (or broken)
// `visualizer` block fails THIS suite the same way `boilerplates/presets/visualizerVocabulary.test.ts`
// already fails preset-side drift.
//
// Per-preset assertions are derived from the preset's OWN declared vocabulary, not hand-copied
// literals:
//   - status views: `nav.views` renders `['All issues', ...preset.visualizer.statusOrder, 'Needs
//     attention']` — read straight off the preset's own loaded module, so this fails the instant
//     a preset's rendered order stops matching what it declares (covers simple-sdlc/
//     simple-gh-sdlc's 5-state lifecycle order AND spec's 3-state order with the SAME loop body).
//   - AC unit label + AC text: gated on the preset declaring `acUnitLabel`/`acText` (a capability
//     check on the loaded preset object, not a name switch) — the rendered AC sentence is
//     extracted MECHANICALLY from the preset's own `ztrack issue scaffold` output (id-token vs.
//     sentence-start heuristic below), never hand-typed, so it can't drift from what the preset
//     actually scaffolds.
//   - code-extension panels: gated on the preset shipping a first-party
//     `client/presets/<name>.tsx` module (an `existsSync` capability check, not a name literal —
//     today only speckit has one). Proven by a BEFORE/AFTER panel-count comparison (register the
//     real module mid-test), not a hardcoded "Functional Requirements" string, so it stays valid
//     if that file's content changes.
//
// A permanent negative fixture (below the manifest loop) proves the mechanism actually detects
// absence: a hand-authored MINIMAL preset — never one of the four shipped ones, never a mutated
// copy of one — that declares no `visualizer` field at all must render the fallback notice, not
// declared columns.
//
// Same DOM harness and dep-gate as `render.e2e.test.tsx` (VIZ-4): `main.tsx` imported directly
// from SOURCE against a REAL fixture server's `/api/board`, happy-dom providing `window`/
// `document`, gated on the visualizer's own `react` install so a clean checkout (no
// `visualizer/bun install` yet) skips rather than flakes.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalWindow } from 'happy-dom';
import { presetManifest } from '../../src/presetCatalog.ts';
import type { CoreRoot, Preset, VisualizerSpec } from '../../src/core/engine.ts';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const PRESETS_DIR = join(REPO, 'boilerplates', 'presets');
const CLIENT_PRESETS_DIR = join(REPO, 'visualizer', 'client', 'presets');
const HAS_DEPS = existsSync(join(REPO, 'visualizer', 'node_modules', 'react'));
const suite = HAS_DEPS ? describe : describe.skip;

function zt(root: string, ...a: string[]) {
  return spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8' });
}

function initFixture(preset?: string, prefix = 'viz5'): string {
  const root = mkdtempSync(join(tmpdir(), `ztrk-${prefix}-`));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the installed preset imports 'ztrack/preset-kit'
  const args = preset ? ['init', '--preset', preset, '--team', 'V5'] : ['init', '--team', 'V5'];
  const r = zt(root, ...args);
  if (r.status !== 0) throw new Error(`fixture: ztrack init failed: ${r.stderr || r.stdout}`);
  return root;
}

function scaffoldBody(root: string, title: string): string {
  const r = zt(root, 'issue', 'scaffold', '--title', title);
  if (r.status !== 0) throw new Error(`fixture: issue scaffold failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function createIssue(root: string, opts: { title: string; state: string; body: string }): void {
  const bodyPath = join(root, `${opts.title.replace(/\s+/g, '-')}.body.md`);
  writeFileSync(bodyPath, opts.body);
  const r = zt(root, 'issue', 'create', '--title', opts.title, '--label', 'type:case', '--state', opts.state, '--assignee', 'me', '--body-file', bodyPath);
  if (r.status !== 0) throw new Error(`fixture: issue create failed: ${r.stderr || r.stdout}`);
}

function startServer(root: string, port: number): ChildProcess {
  return spawn('bun', ['run', join(REPO, 'visualizer', 'server.ts')], {
    cwd: join(REPO, 'visualizer'),
    env: { ...process.env, PORT: String(port), PROJECT_DIR: root },
    stdio: 'ignore',
  });
}

async function waitUp(port: number): Promise<void> {
  for (let i = 0; i < 25; i++) {
    try { if ((await fetch(`http://localhost:${port}/`)).status === 200) return; } catch { /* not up yet */ }
    await Bun.sleep(800);
  }
  throw new Error(`server on port ${port} never came up`);
}

async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor: condition not met within timeout');
}

// ── the DOM harness (identical wiring to render.e2e.test.tsx's `mountDom`/`unmountDom`) ────────
let restoreFetch: (() => void) | null = null;
let activeWindow: { happyDOM: { close(): Promise<void> } } | null = null;
let activeRoot: { unmount(): void } | null = null;

function mountDom(url: string, port: number): void {
  const win = new GlobalWindow({ url }) as unknown as typeof globalThis & { document: Document; happyDOM: { close(): Promise<void> } };
  activeWindow = win;
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = win.document;
  (globalThis as Record<string, unknown>).navigator = (win as unknown as { navigator: unknown }).navigator;
  (globalThis as Record<string, unknown>).HTMLElement = (win as unknown as { HTMLElement: unknown }).HTMLElement;
  (globalThis as Record<string, unknown>).Node = (win as unknown as { Node: unknown }).Node;
  (globalThis as Record<string, unknown>).Event = (win as unknown as { Event: unknown }).Event;
  (globalThis as Record<string, unknown>).MouseEvent = (win as unknown as { MouseEvent: unknown }).MouseEvent;
  (globalThis as Record<string, unknown>).customElements = (win as unknown as { customElements: unknown }).customElements;
  win.document.body.innerHTML = '<div id="root"></div>';

  const realFetch = globalThis.fetch.bind(globalThis);
  (globalThis as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const rewritten = raw.startsWith('/') ? `http://localhost:${port}${raw}` : raw;
    return realFetch(rewritten, init);
  }) as typeof fetch;
  restoreFetch = () => { (globalThis as { fetch: typeof fetch }).fetch = realFetch; };
}

async function unmountDom(): Promise<void> {
  activeRoot?.unmount(); activeRoot = null;
  restoreFetch?.(); restoreFetch = null;
  if (activeWindow) { await activeWindow.happyDOM.close(); activeWindow = null; }
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'customElements']) {
    delete (globalThis as Record<string, unknown>)[k];
  }
}

let scenarioId = 0;
async function bootApp(): Promise<void> {
  const module = await import(`./main.tsx?viz5Scenario=${++scenarioId}`);
  activeRoot = module.appRoot;
  await waitFor(() => !!document.querySelector('.app-shell'));
}

// Mechanically pull the AC sentence out of a REAL `ztrack issue scaffold` body: the shipped
// scaffold grammar is `- [ ] <id-token(s)> <Sentence starting with a Capitalized word>.` — id
// tokens (`dev/01`, `v1`, `AC-1`) never start with an uppercase letter followed by a lowercase
// letter, a real sentence word always does. Never hand-typed per preset — reads whatever THIS
// preset's own scaffold actually produced.
function extractAcSentence(body: string): string | null {
  const line = body.split('\n').find((l) => /^- \[ \]/.test(l));
  if (!line) return null;
  const tokens = line.replace(/^- \[ \]\s*/, '').split(/\s+/).filter(Boolean);
  const startIdx = tokens.findIndex((t) => /^[A-Z][a-z]/.test(t));
  if (startIdx < 0) return null;
  return tokens.slice(startIdx).join(' ');
}

async function fetchJson<T>(port: number, path: string): Promise<T> {
  return (await fetch(`http://localhost:${port}${path}`)).json() as Promise<T>;
}

const BASE_PORT = 8830 + (process.pid % 150) * 10;

// The manifest-driven core loop's own preset objects, loaded ONCE up front (top-level await —
// `presetManifest()` only names files; the actual `visualizer` block being asserted against has
// to come from importing the preset's REAL default export, exactly like
// `boilerplates/presets/visualizerVocabulary.test.ts` does).
const manifest = presetManifest(); // <-- the ONE place the preset set comes from; no literal name array anywhere in this file
const catalog = await Promise.all(manifest.map(async (entry) => {
  const mod = (await import(join(PRESETS_DIR, `${entry.name}.ts`))) as { default: Preset<CoreRoot> };
  const visualizer = mod.default.visualizer as VisualizerSpec | undefined;
  const extensionPath = join(CLIENT_PRESETS_DIR, `${entry.name}.tsx`);
  return { name: entry.name, visualizer, hasCodeExtension: existsSync(extensionPath), extensionPath };
}));

suite('VIZ-5 — per-preset rendered-fact drift guard (manifest-driven)', () => {
  afterEach(async () => { await unmountDom(); });

  catalog.forEach((p, idx) => {
    describe(`preset '${p.name}'`, () => {
      const port = BASE_PORT + idx * 3;
      let root = '';
      let proc: ChildProcess | undefined;
      let issueId = '';
      let scaffold = '';

      beforeAll(async () => {
        // Guards the guard: every shipped preset ships a `visualizer` block (VIZ-2) — if this
        // ever stops being true for a manifest-discovered preset, fail LOUD here rather than
        // silently skipping its rendered assertions below.
        if (!p.visualizer) throw new Error(`${p.name}.ts's default export has no \`visualizer\` block — VIZ-2 shipped one for every preset`);

        root = initFixture(p.name);
        scaffold = scaffoldBody(root, 'Vocabulary render fixture');
        createIssue(root, { title: 'Vocabulary render fixture', state: p.visualizer.statusOrder[0]!, body: scaffold });
        proc = startServer(root, port);
        await waitUp(port);
        const board = await fetchJson<{ issues: Array<{ id: string }> }>(port, '/api/board');
        issueId = board.issues[0]?.id ?? '';
      }, 30_000);

      afterAll(() => {
        try { proc?.kill(); } catch { /* */ }
        if (root) rmSync(root, { recursive: true, force: true });
      });

      test('status views render in the preset\'s OWN declared statusOrder', async () => {
        mountDom('http://localhost/', port);
        await bootApp();
        const expected = ['All issues', ...p.visualizer!.statusOrder, 'Needs attention'];
        const viewLabels = () => [...document.querySelectorAll('nav.views .view span:first-child')].map((n) => n.textContent);
        await waitFor(() => JSON.stringify(viewLabels()) === JSON.stringify(expected));
        expect(viewLabels()).toEqual(expected);
      }, 15_000);

      if (p.visualizer?.acUnitLabel) {
        test('the declared AC unit label renders on the open issue', async () => {
          expect(issueId).not.toBe('');
          mountDom(`http://localhost/?issue=${issueId}`, port);
          await bootApp();
          await waitFor(() => !!document.querySelector('.detail-drawer'));
          await waitFor(() => (document.body.textContent ?? '').includes(p.visualizer!.acUnitLabel!));

          expect(document.body.textContent ?? '').toContain(p.visualizer!.acUnitLabel);
        }, 15_000);
      }

      // Gated on the preset declaring a DATA acText mapping (a capability of the loaded preset
      // object, never a name check) — proves AC TEXT renders, not a bare id, using the sentence
      // this preset's OWN scaffold actually produced.
      if (p.visualizer?.acText) {
        test('AC text renders (not a bare id) — the preset\'s own scaffolded sentence', async () => {
          const sentence = extractAcSentence(scaffold);
          expect(sentence, `could not extract an AC sentence from ${p.name}'s own scaffold output:\n${scaffold}`).toBeTruthy();

          mountDom(`http://localhost/?issue=${issueId}`, port);
          await bootApp();
          await waitFor(() => !!document.querySelector('.detail-drawer'));
          await waitFor(() => (document.body.textContent ?? '').includes(sentence!));

          expect(document.body.textContent ?? '').toContain(sentence);
        }, 15_000);
      }

      // Gated on the preset shipping a first-party `client/presets/<name>.tsx` module — an
      // `existsSync` capability check (today true only for speckit), never a hardcoded name.
      // Proven by a BEFORE/AFTER panel-count comparison against the REAL registered module, not
      // a copy-pasted literal from its source, so it survives that file's content changing.
      if (p.hasCodeExtension) {
        test('the first-party code extension adds at least one issuePanels section', async () => {
          mountDom(`http://localhost/?issue=${issueId}`, port);
          await bootApp();
          await waitFor(() => !!document.querySelector('.detail-drawer'));
          const before = document.querySelectorAll('.detail-drawer .panel').length;
          await unmountDom();

          const [{ registerExtension }, extMod] = await Promise.all([
            import('./extensions'),
            import(p.extensionPath),
          ]) as [{ registerExtension: (name: string, ext: unknown) => void }, { default: unknown }];
          registerExtension(p.name, extMod.default);

          mountDom(`http://localhost/?issue=${issueId}`, port);
          await bootApp();
          await waitFor(() => !!document.querySelector('.detail-drawer'));
          await waitFor(() => document.querySelectorAll('.detail-drawer .panel').length > before);

          const after = document.querySelectorAll('.detail-drawer .panel').length;
          expect(after).toBeGreaterThan(before); // issuePanels genuinely added section(s) beyond the data-only render
        }, 15_000);
      }
    });
  });

  // ── the permanent negative fixture ──────────────────────────────────────────────────────────
  // A hand-authored MINIMAL preset — never one of the four shipped ones, never a real preset with
  // a field regex-stripped out (that's `src/visualizerViz3.e2e.test.ts`'s `stripVisualizer`
  // fixture) — that genuinely declares no `visualizer` field. Proves the assertion mechanism
  // above actually DETECTS absence: without a declared block, the client falls back to the
  // upgrade notice instead of rendering declared columns.
  describe('permanent negative fixture — a minimal preset with NO visualizer block', () => {
    const port = BASE_PORT + catalog.length * 3 + 10;
    let root = '';
    let proc: ChildProcess | undefined;

    beforeAll(async () => {
      root = initFixture(undefined, 'viz5-neg'); // scaffolding/config only — the preset.mts below is a full replacement, never an edit of what init installed
      const presetPath = join(root, '.volter', 'tracker', 'validation', 'preset.mts');
      writeFileSync(presetPath, `import { z, type Preset } from 'ztrack/preset-kit';

// A minimal, standalone, hand-authored fixture preset — deliberately NOT one of the shipped
// boilerplates and NOT derived from one. It declares a valid CoreRoot-shaped schema so
// ztrack visualizer boots cleanly, and NO visualizer field at all, which is exactly the case
// this negative fixture exists to prove: no declared vocabulary -> fallback notice, not
// declared columns.
const MinimalRootSchema = z.object({
  issues: z.array(z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    status: z.enum(['draft', 'done']),
    acceptanceCriteria: z.array(z.object({
      id: z.string(),
      status: z.string(),
      evidence: z.array(z.object({ id: z.string() })),
    })),
  })),
}).strict();

const MinimalFixturePreset: Preset<z.infer<typeof MinimalRootSchema>> = {
  name: 'viz5-minimal-negative-fixture',
  schema: MinimalRootSchema,
  parse: () => ({ issues: [] }),
  rules: [],
  // no visualizer: key — the whole point of this fixture.
};

export default MinimalFixturePreset;
`);
      proc = startServer(root, port);
      await waitUp(port);
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('the board ships `visualizer: null` for this fixture', async () => {
      const board = await fetchJson<{ visualizer: unknown; preset: string }>(port, '/api/board');
      expect(board.preset).toBe('viz5-minimal-negative-fixture');
      expect(board.visualizer).toBeNull();
    }, 15_000);

    test('the fallback notice renders instead of declared columns', async () => {
      mountDom('http://localhost/', port);
      await bootApp();
      await waitFor(() => !!document.querySelector('.app-shell'));
      await waitFor(() => (document.body.textContent ?? '').includes('vocabulary not declared'));

      const body = document.body.textContent ?? '';
      expect(body).toContain('vocabulary not declared'); // the fallback notice, proving absence is DETECTED
      expect(body).toContain('run ztrack preset upgrade');
      // and no declared-vocabulary column label could possibly render — this fixture's schema
      // has no rendered concept of one, so there is nothing preset-specific to assert absent
      // beyond the notice itself; the manifest-driven tests above are the positive control that
      // the SAME nav.views mechanism DOES render declared labels when a block is present.
    }, 15_000);
  });
});
