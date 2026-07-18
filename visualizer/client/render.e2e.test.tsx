// VIZ-4 dev/01,03,04,05: DOM-rendered assertions. The SPA is client-rendered (server.ts serves a
// static SHELL, `server.ts:209-214`-ish), so a plain `curl /` cannot see what actually renders —
// this suite adds the DOM runtime (happy-dom, root devDependency) `bun test` was missing and
// boots the REAL `ztrack visualizer` server against REAL `ztrack init` fixtures (same pattern as
// `src/visualizer.e2e.test.ts` / `src/visualizerViz3.e2e.test.ts`: symlink node_modules/ztrack ->
// this checkout, run the real CLI, spawn the real server). `main.tsx` is imported directly from
// SOURCE (Bun transpiles TSX on the fly) rather than by executing the built `/assets/app.js`
// bundle — it is "the React tree directly ... against a fetched ... payload" (the task's second
// allowed design), and the payload is genuinely the booted server's own `/api/board` output:
// `fetch('/api/board')` inside `main.tsx` is untouched (a relative URL); the test only rewrites
// the ORIGIN so the same app code talks to the real fixture server.
//
// dev/03 (speckit) additionally asserts the served `/assets/app.js` BUNDLE contains the code
// extension's own text ("Functional Requirements") — that is the genuine generated-entry SCAN +
// build proof (server.ts's `writeGeneratedEntry`/`scanFirstPartyExtensions`) — and separately
// registers that same `client/presets/speckit.tsx` module (the identical file, not a mock) into
// the extensions registry the source-imported `main.tsx` also uses, to get a DOM-rendered
// assertion without re-implementing a headless-browser <script type=module> executor.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalWindow } from 'happy-dom';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const HAS_DEPS = existsSync(join(REPO, 'visualizer', 'node_modules', 'react'));
const suite = HAS_DEPS ? describe : describe.skip;

function zt(root: string, ...a: string[]) {
  return spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8' });
}

function initFixture(preset?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-viz4-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // the installed preset imports 'ztrack/preset-kit'
  const args = preset ? ['init', '--preset', preset, '--team', 'V4'] : ['init', '--team', 'V4'];
  const r = zt(root, ...args);
  if (r.status !== 0) throw new Error(`fixture: ztrack init failed: ${r.stderr || r.stdout}`);
  return root;
}

// Body text ALWAYS comes from the active preset's OWN `issue scaffold` (never hand-authored) —
// its AC line grammar (id/status/version markers, `docs/PRESETS.md:182-235`) is preset-owned and
// easy to get subtly wrong by hand (verified: a hand-written AC line missing the `[<version>]`
// marker fails schema validation and `board()`'s `export` comes back empty — see the fixture
// helper's own header note in the sibling e2e suites). The scaffold's stock AC sentence
// ("Describe one observable, testable outcome.") is non-bare, which is all dev/01 needs.
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

// ── the DOM harness ──────────────────────────────────────────────────────────────────────────
// happy-dom's `GlobalWindow` populates a real (sandboxed) window/document; the app's own code
// (main.tsx, unmodified) references bare `window`/`document`, so those go on `globalThis`.
// `fetch` is wrapped (not replaced) so a relative `/api/board` request the app makes reaches the
// REAL fixture server, not a mock payload.
let restoreFetch: (() => void) | null = null;
let activeWindow: { happyDOM: { close(): Promise<void> } } | null = null;

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
  restoreFetch?.(); restoreFetch = null;
  // Abort happy-dom's own pending async tasks (the app's `setInterval(refresh, 4000)` poll loop
  // among them) BEFORE tearing down the globals they close over — otherwise a timer fires later,
  // after `window`/`document` are gone, and crashes as an unhandled rejection in a later test.
  if (activeWindow) { await activeWindow.happyDOM.close(); activeWindow = null; }
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'customElements']) {
    delete (globalThis as Record<string, unknown>)[k];
  }
}

let scenarioId = 0;
/** Import `main.tsx` fresh (cache-busted so its top-level `createRoot(...).render(<App/>)` mount
 *  re-runs for every scenario) and wait for the shell to appear. */
async function bootApp(): Promise<void> {
  await import(`./main.tsx?viz4Scenario=${++scenarioId}`);
  await waitFor(() => !!document.querySelector('.app-shell'));
}

function clickButtonWithText(text: string): void {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no <button> with text ${JSON.stringify(text)} found`);
  (btn as unknown as { click(): void }).click();
}

const BASE_PORT = 8700 + (process.pid % 250) * 2;

suite('VIZ-4 — DOM-rendered vocabulary (happy-dom)', () => {
  afterEach(async () => { await unmountDom(); });

  describe('dev/01 — simple-sdlc: AC text (not bare ids) + lifecycle-ordered status views', () => {
    const port = BASE_PORT;
    let root = '';
    let proc: ChildProcess | undefined;

    beforeAll(async () => {
      root = initFixture(); // default = simple-sdlc
      createIssue(root, { title: 'Render from data', state: 'in-progress', body: scaffoldBody(root, 'Render from data') });
      proc = startServer(root, port);
      await waitUp(port);
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('AC text renders (not a bare id) and status views are in lifecycle order', async () => {
      // AC text renders in the issue DETAIL drawer's AC list (main.tsx's Detail component), not
      // the list/board row — open it via the route (`?issue=<id>`), same as the app's own
      // deep-link support.
      const board = await (await fetch(`http://localhost:${port}/api/board`)).json() as { issues: Array<{ id: string }> };
      const issueId = board.issues[0]!.id;

      mountDom(`http://localhost/?issue=${issueId}`, port);
      await bootApp();
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      await waitFor(() => (document.body.textContent ?? '').includes('Describe one observable, testable outcome.'));

      const body = document.body.textContent ?? '';
      expect(body).toContain('Describe one observable, testable outcome.'); // AC TEXT (the scaffold's own sentence), not just a bare AC id

      // sidebar nav views: 'all', <statusOrder...>, 'findings' — assert lifecycle order.
      const viewLabels = [...document.querySelectorAll('nav.views .view span:first-child')].map((n) => n.textContent);
      const order = ['draft', 'ready', 'in-progress', 'in-review', 'done'];
      const positions = order.map((s) => viewLabels.indexOf(s));
      expect(positions.every((p) => p >= 0)).toBe(true); // every lifecycle status is present
      expect(positions).toEqual([...positions].sort((a, b) => a - b)); // and in that exact order
    }, 15_000);
  });

  describe('dev/03 — speckit: code extension discovered by the generated-entry scan, merged over data', () => {
    const port = BASE_PORT + 1;
    let root = '';
    let proc: ChildProcess | undefined;
    let issueId = '';

    beforeAll(async () => {
      root = initFixture('speckit');
      const scaffold = zt(root, 'issue', 'scaffold', '--title', 'Appointment Search').stdout; // the speckit preset's OWN scaffold shape (has an FR-001 line)
      createIssue(root, { title: 'Appointment Search', state: 'specifying', body: scaffold });
      const board = await new Promise<{ issues: Array<{ id: string }> }>((resolvePromise) => {
        proc = startServer(root, port);
        waitUp(port).then(() => fetch(`http://localhost:${port}/api/board`)).then((r) => r.json()).then(resolvePromise as (v: unknown) => void);
      });
      issueId = board.issues[0]!.id;

      // The generated-entry mechanism itself is exercised by the REAL running server (proven by
      // the bundle-content assertion below); to get a DOM-rendered assertion without executing
      // the built bundle in happy-dom, register the SAME first-party module the generated entry
      // discovers by filename — not a mock, the actual `client/presets/speckit.tsx`.
      const [{ registerExtension }, { default: speckitExtension }] = await Promise.all([
        import('./extensions'),
        import('./presets/speckit.tsx'),
      ]);
      registerExtension('speckit', speckitExtension);
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('the generated entry actually DISCOVERED and bundled the code extension (bundle-content proof)', async () => {
      const appJs = await (await fetch(`http://localhost:${port}/assets/app.js`)).text();
      expect(appJs).toContain('Functional Requirements'); // speckit.tsx's issuePanels literal, only present if the scan found + bundled it
    }, 15_000);

    test('renders the "User Stories" AC-unit label (data) and a Functional Requirements panel (code, merged over data)', async () => {
      mountDom(`http://localhost/?issue=${issueId}`, port); // open the detail drawer so issuePanels renders (main.tsx:342-ish)
      await bootApp();
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      await waitFor(() => (document.body.textContent ?? '').includes('FR-001'));

      const body = document.body.textContent ?? '';
      expect(body).toContain('User Stories'); // DATA: speckit's visualizer block acUnitLabel
      expect(body).toContain('Functional Requirements'); // CODE: speckit.tsx's issuePanels section heading
      expect(body).toContain('FR-001'); // the actual requirement text rendered inside that panel
    }, 15_000);
  });

  describe('dev/04 — fallback: observed statuses + a notice, when the vocabulary is missing or invalid', () => {
    const portMissing = BASE_PORT + 2;
    const portInvalid = BASE_PORT + 3;
    let rootMissing = '', rootInvalid = '';
    let procMissing: ChildProcess | undefined, procInvalid: ChildProcess | undefined;

    function presetPath(root: string): string { return join(root, '.volter', 'tracker', 'validation', 'preset.mts'); }

    beforeAll(async () => {
      rootMissing = initFixture();
      // VIZ-2 shipped a `visualizer` block in every boilerplate — strip it so this case genuinely
      // has none (mirrors src/visualizerViz3.e2e.test.ts's `stripVisualizer`).
      {
        const p = presetPath(rootMissing);
        const src = readFileSync(p, 'utf8');
        const marker = /\n\s*visualizer: DEFAULT_VISUALIZER,/;
        if (!marker.test(src)) throw new Error('fixture: shipped `visualizer: DEFAULT_VISUALIZER,` field not found');
        writeFileSync(p, src.replace(marker, ''));
      }
      createIssue(rootMissing, { title: 'No vocab yet', state: 'draft', body: scaffoldBody(rootMissing, 'No vocab yet') });
      procMissing = startServer(rootMissing, portMissing);

      rootInvalid = initFixture();
      {
        const p = presetPath(rootInvalid);
        const src = readFileSync(p, 'utf8');
        const marker = 'visualizer: DEFAULT_VISUALIZER,';
        if (!src.includes(marker)) throw new Error('fixture: shipped `visualizer: DEFAULT_VISUALIZER,` field not found');
        // statusOrder must be an array per VisualizerSpecSchema — a bare string fails validation.
        writeFileSync(p, src.replace(marker, "visualizer: { statusOrder: 'draft', acUnitLabel: 'Dev ACs' },"));
      }
      createIssue(rootInvalid, { title: 'Bad vocab', state: 'draft', body: scaffoldBody(rootInvalid, 'Bad vocab') });
      procInvalid = startServer(rootInvalid, portInvalid);

      await Promise.all([waitUp(portMissing), waitUp(portInvalid)]);
    }, 30_000);

    afterAll(() => {
      try { procMissing?.kill(); } catch { /* */ }
      try { procInvalid?.kill(); } catch { /* */ }
      if (rootMissing) rmSync(rootMissing, { recursive: true, force: true });
      if (rootInvalid) rmSync(rootInvalid, { recursive: true, force: true });
    });

    test('(a) no `visualizer` block: observed statuses render as groups, plus the upgrade notice', async () => {
      mountDom('http://localhost/', portMissing);
      await bootApp();
      await waitFor(() => (document.body.textContent ?? '').includes('run ztrack preset upgrade'));

      const body = document.body.textContent ?? '';
      expect(body).toContain('draft'); // the observed status still renders as a group/view
      expect(body).toContain('vocabulary not declared'); // the notice text
      expect(body).toContain('run ztrack preset upgrade');
    }, 15_000);

    test('(b) an invalid `visualizer` block: groups still render, plus a notice containing the shipped error text', async () => {
      mountDom('http://localhost/', portInvalid);
      await bootApp();
      await waitFor(() => (document.body.textContent ?? '').includes('statusOrder'));

      const board = await (await fetch(`http://localhost:${portInvalid}/api/board`)).json() as { visualizerError?: string };
      expect(board.visualizerError).toBeTruthy();

      const body = document.body.textContent ?? '';
      expect(body).toContain('draft'); // the observed status still renders
      expect(body).toContain(board.visualizerError!); // the notice carries the SHIPPED error text verbatim
    }, 15_000);
  });

  describe('dev/05 — rendered live-mod loop: no server restart', () => {
    const port = BASE_PORT + 4;
    let root = '';
    let proc: ChildProcess | undefined;
    let presetFile = '';

    function presetPath(r: string): string { return join(r, '.volter', 'tracker', 'validation', 'preset.mts'); }

    beforeAll(async () => {
      root = initFixture();
      presetFile = presetPath(root);
      createIssue(root, { title: 'Steady state', state: 'draft', body: scaffoldBody(root, 'Steady state') });
      proc = startServer(root, port);
      await waitUp(port);
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('editing preset.mts live shows the new status column on the next poll — no restart', async () => {
      mountDom('http://localhost/', port);
      await bootApp();
      await waitFor(() => !!document.querySelector('nav.views'));

      const viewsBefore = [...document.querySelectorAll('nav.views .view span:first-child')].map((n) => n.textContent);
      expect(viewsBefore).not.toContain('archived');

      // Live edit: add a new status to the installed preset's visualizer block (rides VIZ-3's
      // verified mtime-keyed `delete require.cache[...]` re-resolution — no server restart).
      const src = readFileSync(presetFile, 'utf8');
      const marker = "statusOrder: ['draft', 'ready', 'in-progress', 'in-review', 'done']";
      if (!src.includes(marker)) throw new Error('fixture: shipped statusOrder literal not found — installed boilerplate shape changed');
      writeFileSync(presetFile, src.replace(marker, "statusOrder: ['draft', 'ready', 'in-progress', 'in-review', 'done', 'archived']"));
      const future = new Date(Date.now() + 2000);
      utimesSync(presetFile, future, future);

      // Same mechanism the app itself uses to re-poll — click the real "Refresh" button rather
      // than waiting out the 4s interval.
      clickButtonWithText('Refresh');

      await waitFor(() => [...document.querySelectorAll('nav.views .view span:first-child')].some((n) => n.textContent === 'archived'));
      const viewsAfter = [...document.querySelectorAll('nav.views .view span:first-child')].map((n) => n.textContent);
      expect(viewsAfter).toContain('archived');
    }, 20_000);
  });

  describe('operational-block policy — rendered core view and badges', () => {
    test('combines issue relations, AC blocks, and a repo hook in one labeled view', async () => {
      mountDom('http://localhost/', 1);
      const [{ registerExtension }] = await Promise.all([import('./extensions')]);
      registerExtension('operational-block-e2e', {
        isOperationallyBlocked: (candidate) => candidate.status === 'human-required',
        operationalBlockLabel: (candidate) => candidate.status === 'human-required' ? 'awaiting owner action' : undefined,
        blockedViewLabel: 'Owner action',
      });
      const coreIssue = (id: string, overrides: Record<string, unknown> = {}) => ({
        id, title: id, summary: '', status: 'draft', acceptanceCriteria: [], ...overrides,
      });
      const payload = {
        title: 'tracker', preset: 'operational-block-e2e', projectDir: '/fixture', fetchedAt: 'now', trackerChangedAt: null, ok: true,
        primitives: { relations: true },
        visualizer: { statusOrder: ['draft', 'human-required'], acUnitLabel: 'ACs' },
        issues: [
          coreIssue('REL-1', { relations: [{ type: 'blocked-by', issueId: 'ROOT-1' }] }),
          coreIssue('AC-1', { acceptanceCriteria: [{ id: 'dev/01', status: 'pending', evidence: [], blockedBy: [{ issue: 'ROOT-1' }] }] }),
          coreIssue('HUMAN-1', { status: 'human-required' }),
          coreIssue('FREE-1'),
        ],
        findings: [], audit: {}, timestamps: {},
      };
      (globalThis as { fetch: typeof fetch }).fetch = (async () => Response.json(payload)) as typeof fetch;

      await bootApp();
      await waitFor(() => !!document.querySelector('.view-operationally-blocked'));
      const view = document.querySelector('.view-operationally-blocked') as HTMLButtonElement;
      expect(view.querySelector('span')?.textContent).toBe('Owner action');
      expect(view.querySelector('strong')?.textContent).toBe('3');
      expect(document.body.textContent).toContain('awaiting owner action');
      expect(document.body.textContent).toContain('blocked by acceptance criterion');

      view.click();
      await waitFor(() => document.querySelectorAll('.issue-row').length === 3);
      const ids = [...document.querySelectorAll('.issue-row .issue-id')].map((node) => node.textContent).sort();
      expect(ids).toEqual(['AC-1', 'HUMAN-1', 'REL-1']);
      expect(ids).not.toContain('FREE-1');
    }, 15_000);
  });
});
