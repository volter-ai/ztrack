// VIZ-13: the repo-local code seam. A repo-owned `<stateDir>/tracker/visualizer/extension.tsx`
// compiled into the SAME generated bundle VIZ-4 introduced (server.ts's `writeGeneratedEntry`),
// registered under the RUNNING preset's own name so it layers OVER a first-party entry
// (precedence: data < first-party < repo).
//
// Unlike `render.e2e.test.tsx` (VIZ-4), which imports `main.tsx` directly from SOURCE and
// manually `registerExtension`s the first-party module under test, these tests EXECUTE THE REAL
// SERVED `/assets/app.js` BUNDLE in happy-dom — the only way to genuinely exercise the react/jsx
// ALIASING plugin (dev/06): a repo extension.tsx lives OUTSIDE this visualizer's own directory
// tree (under the fixture repo's state dir, which deliberately has no `node_modules/react`), so
// importing it directly from a test process (the VIZ-4 trick) would fail to resolve
// `react/jsx-runtime` — only the real server's `Bun.build`, with the alias plugin, can compile it.
// The downloaded bundle text is written to a temp file and `import()`ed inside the mounted
// happy-dom window (same globals-wiring pattern as VIZ-4's `mountDom`), so the SAME code path a
// real browser would execute — including the repo extension bundled in — actually runs.
//
// Gated on: visualizer client deps installed (react.e2e convention) AND the package itself
// having been BUILT (`dist/src/visualizerKit.js` present — a fixture's own `extension.tsx`
// imports 'ztrack/visualizer-kit', which resolves via THIS repo's `package.json` "exports" map
// to `dist/src/visualizerKit.js`; CI builds before testing, ci.yml "Build package" precedes
// "Test" — a local `bun test` run without a prior `npm run build` skips here, matching
// `visualizerKitFixture.e2e.test.ts`'s own gate).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalWindow } from 'happy-dom';
import { cacheRoot } from '../../src/config.ts';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const HAS_DEPS = existsSync(join(REPO, 'visualizer', 'node_modules', 'react'));
const KIT_BUILT = existsSync(join(REPO, 'dist', 'src', 'visualizerKit.js'));
const suite = HAS_DEPS && KIT_BUILT ? describe : describe.skip;

function zt(root: string, ...a: string[]) {
  return spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8' });
}

function initFixture(preset?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-viz13-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // preset.mts imports 'ztrack/preset-kit'; extension.tsx imports 'ztrack/visualizer-kit' — same install requirement, VIZ-13's summary
  const args = preset ? ['init', '--preset', preset, '--team', 'V13'] : ['init', '--team', 'V13'];
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

async function fetchBoard(port: number): Promise<Record<string, unknown>> {
  return (await fetch(`http://localhost:${port}/api/board`)).json() as Promise<Record<string, unknown>>;
}

// ── the repo extension fixture helpers ──────────────────────────────────────────────────────
function extensionDir(root: string): string { return join(root, '.volter', 'tracker', 'visualizer'); }
function extensionPath(root: string): string { return join(extensionDir(root), 'extension.tsx'); }
function writeExtension(root: string, source: string): void {
  mkdirSync(extensionDir(root), { recursive: true });
  writeFileSync(extensionPath(root), source);
}

// Surgically break ONLY 'ztrack/visualizer-kit' resolution (dev/03's second case), while leaving
// 'ztrack/preset-kit' (which the INSTALLED preset.mts needs to keep working — the board must stay
// genuinely healthy, not fail for an unrelated reason) resolvable. Models a realistic case: an
// older installed `ztrack` predating this subpath. Real `dist/` is symlinked in (so transitive
// deps like zod still resolve via the real package's own node_modules), and the stub
// package.json is a copy of the real one with just the one export key removed.
function breakVisualizerKitResolution(root: string): void {
  const link = join(root, 'node_modules', 'ztrack');
  rmSync(link, { recursive: true, force: true });
  mkdirSync(link, { recursive: true });
  symlinkSync(join(REPO, 'dist'), join(link, 'dist'));
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
  delete pkg.exports['./visualizer-kit'];
  writeFileSync(join(link, 'package.json'), JSON.stringify(pkg, null, 2));
}

// ── the DOM harness — EXECUTES THE REAL SERVED BUNDLE (see file header for why) ────────────────
let restoreFetch: (() => void) | null = null;
let activeWindow: { happyDOM: { close(): Promise<void> } } | null = null;
const bundleTmpFiles: string[] = [];
let scenarioId = 0;

function mountWindow(url: string, port: number): void {
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
  if (activeWindow) { await activeWindow.happyDOM.close(); activeWindow = null; }
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'customElements']) {
    delete (globalThis as Record<string, unknown>)[k];
  }
  for (const f of bundleTmpFiles.splice(0)) { try { rmSync(f, { force: true }); } catch { /* already gone */ } }
}

/** Fetch the REAL `/assets/app.js` bundle from the running server, write it to a temp file, and
 *  `import()` it inside a freshly-mounted happy-dom window — the app's own top-level
 *  `createRoot(...).render(<App/>)` mount runs exactly as it would in a real browser tab. */
async function bootBundle(port: number, path = '/'): Promise<void> {
  const code = await (await fetch(`http://localhost:${port}/assets/app.js`)).text();
  const tmpFile = join(tmpdir(), `ztrk-viz13-bundle-${process.pid}-${++scenarioId}.mjs`);
  writeFileSync(tmpFile, code);
  bundleTmpFiles.push(tmpFile);
  mountWindow(`http://localhost${path}`, port);
  await import(tmpFile);
  await waitFor(() => !!document.querySelector('.app-shell'));
}

const BASE_PORT = 8620 + (process.pid % 200) * 2;

suite('VIZ-13 — repo-owned extension.tsx compiled into the served board (happy-dom, real bundle)', () => {
  afterEach(async () => { await unmountDom(); });

  describe('dev/01a — a custom issuePanels section renders in the OPEN issue detail drawer', () => {
    const port = BASE_PORT;
    let root = '';
    let proc: ChildProcess | undefined;
    let issueId = '';

    beforeAll(async () => {
      root = initFixture(); // default = simple-sdlc
      writeExtension(root, `
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';

export default defineVisualizerExtension({
  issuePanels: (issue) => (
    <section className="panel">
      <div className="panel-title"><h3>Repo Custom Panel</h3></div>
      <div>custom panel content for {issue.id}</div>
    </section>
  ),
});
`);
      createIssue(root, { title: 'Panel fixture', state: 'draft', body: scaffoldBody(root, 'Panel fixture') });
      proc = startServer(root, port);
      await waitUp(port);
      issueId = ((await fetchBoard(port)).issues as Array<{ id: string }>)[0]!.id;
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('the panel heading and content render inside the detail drawer', async () => {
      await bootBundle(port, `/?issue=${issueId}`);
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      await waitFor(() => (document.body.textContent ?? '').includes('Repo Custom Panel'));

      const body = document.body.textContent ?? '';
      expect(body).toContain('Repo Custom Panel'); // the panel's own heading
      expect(body).toContain(`custom panel content for ${issueId}`); // the panel's own content
      expect(document.querySelector('.visualizer-notice.extension-error')).toBeNull(); // a valid extension ships no error notice
    }, 20_000);
  });

  describe('dev/01b — precedence: a repo member overrides a shipped speckit member (data < first-party < repo)', () => {
    const port = BASE_PORT + 1;
    let root = '';
    let proc: ChildProcess | undefined;
    let issueId = '';

    beforeAll(async () => {
      root = initFixture('speckit');
      // speckit's OWN first-party client/presets/speckit.tsx ships an `acText` member
      // (`<strong>{a.id}</strong> {a.text}`) — override it with a distinguishable marker.
      writeExtension(root, `
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';

export default defineVisualizerExtension({
  acText: (ac) => 'REPO-OVERRIDE:' + ac.id,
});
`);
      const scaffold = zt(root, 'issue', 'scaffold', '--title', 'Override fixture').stdout;
      createIssue(root, { title: 'Override fixture', state: 'specifying', body: scaffold });
      proc = startServer(root, port);
      await waitUp(port);
      issueId = ((await fetchBoard(port)).issues as Array<{ id: string }>)[0]!.id;
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('the REPO acText wins over the shipped speckit acText', async () => {
      await bootBundle(port, `/?issue=${issueId}`);
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      await waitFor(() => (document.body.textContent ?? '').includes('REPO-OVERRIDE:'));

      const body = document.body.textContent ?? '';
      expect(body).toContain('REPO-OVERRIDE:'); // the repo member's own output, not speckit's <strong>id</strong> text form
    }, 20_000);
  });

  describe('dev/02 — absence: no extension.tsx anywhere', () => {
    const portA = BASE_PORT + 2;
    const portB = BASE_PORT + 3;
    let rootA = '', rootB = '';
    let procA: ChildProcess | undefined, procB: ChildProcess | undefined;
    let issueId = '';

    beforeAll(async () => {
      rootA = initFixture();
      // VIZ-15: a fresh init now scaffolds a starter extension.tsx + .extension.base.tsx by
      // default (see the "VIZ-15 dev/01" suite below for THAT case) — this suite tests the
      // genuine absence case, so delete the scaffolded seam entirely.
      rmSync(extensionDir(rootA), { recursive: true, force: true });
      createIssue(rootA, { title: 'No extension A', state: 'draft', body: scaffoldBody(rootA, 'No extension A') });
      procA = startServer(rootA, portA);

      rootB = initFixture(); // a second, independent fixture — also with no extension.tsx
      rmSync(extensionDir(rootB), { recursive: true, force: true });
      procB = startServer(rootB, portB);

      await Promise.all([waitUp(portA), waitUp(portB)]);
      issueId = ((await fetchBoard(portA)).issues as Array<{ id: string }>)[0]!.id;
    }, 30_000);

    afterAll(() => {
      try { procA?.kill(); } catch { /* */ }
      try { procB?.kill(); } catch { /* */ }
      if (rootA) rmSync(rootA, { recursive: true, force: true });
      if (rootB) rmSync(rootB, { recursive: true, force: true });
    });

    test('the board renders stock — no notice, no error', async () => {
      const res = await fetch(`http://localhost:${portA}/assets/app.js`);
      expect(res.status).toBe(200);
      const board = await fetchBoard(portA);
      expect(board.extensionError).toBeUndefined();

      await bootBundle(portA, `/?issue=${issueId}`);
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      expect(document.querySelector('.visualizer-notice.extension-error')).toBeNull();
    }, 20_000);

    test('the generated entry is byte-identical to the no-extension case (two independent fixtures)', async () => {
      // force a build on both (so generated-entry.ts has actually been written) — /assets/app.js
      // triggers writeGeneratedEntry as a side effect of getClientBundle (server.ts).
      await fetch(`http://localhost:${portA}/assets/app.js`);
      await fetch(`http://localhost:${portB}/assets/app.js`);
      const entryA = readFileSync(join(cacheRoot(rootA), 'visualizer', 'generated-entry.ts'), 'utf8');
      const entryB = readFileSync(join(cacheRoot(rootB), 'visualizer', 'generated-entry.ts'), 'utf8');
      expect(entryA).toBe(entryB); // deterministic, sorted scan (VIZ-4) — no repo-extension lines in either
      expect(entryA).not.toContain('repoExt'); // the repo-extension import/register lines are absent entirely
    }, 20_000);
  });

  describe('VIZ-15 dev/01 — the starter extension.tsx (installed by a fresh init) is a genuine no-op', () => {
    const portStarter = BASE_PORT + 9;
    const portAbsent = BASE_PORT + 10;
    let rootStarter = '', rootAbsent = '';
    let procStarter: ChildProcess | undefined, procAbsent: ChildProcess | undefined;
    let issueIdStarter = '', issueIdAbsent = '';

    beforeAll(async () => {
      rootStarter = initFixture(); // the scaffolded starter is left AS-IS — the point of this suite
      createIssue(rootStarter, { title: 'Starter fixture', state: 'draft', body: scaffoldBody(rootStarter, 'Starter fixture') });
      procStarter = startServer(rootStarter, portStarter);

      rootAbsent = initFixture();
      rmSync(extensionDir(rootAbsent), { recursive: true, force: true }); // the true-absence control
      createIssue(rootAbsent, { title: 'Absent fixture', state: 'draft', body: scaffoldBody(rootAbsent, 'Absent fixture') });
      procAbsent = startServer(rootAbsent, portAbsent);

      await Promise.all([waitUp(portStarter), waitUp(portAbsent)]);
      issueIdStarter = ((await fetchBoard(portStarter)).issues as Array<{ id: string }>)[0]!.id;
      issueIdAbsent = ((await fetchBoard(portAbsent)).issues as Array<{ id: string }>)[0]!.id;
    }, 30_000);

    afterAll(() => {
      try { procStarter?.kill(); } catch { /* */ }
      try { procAbsent?.kill(); } catch { /* */ }
      if (rootStarter) rmSync(rootStarter, { recursive: true, force: true });
      if (rootAbsent) rmSync(rootAbsent, { recursive: true, force: true });
    });

    test('a fresh init genuinely scaffolds extension.tsx + .extension.base.tsx', () => {
      expect(existsSync(extensionPath(rootStarter))).toBe(true);
      expect(existsSync(join(extensionDir(rootStarter), '.extension.base.tsx'))).toBe(true);
    });

    test('the board carries no extensionError — the starter compiles cleanly, same as true absence', async () => {
      const boardStarter = await fetchBoard(portStarter);
      const boardAbsent = await fetchBoard(portAbsent);
      expect(boardStarter.extensionError).toBeUndefined();
      expect(boardAbsent.extensionError).toBeUndefined();
    }, 20_000);

    test('the generated entry for the starter DOES register it (genuinely exercises the compile path, not skipped)', async () => {
      await fetch(`http://localhost:${portStarter}/assets/app.js`);
      const entry = readFileSync(join(cacheRoot(rootStarter), 'visualizer', 'generated-entry.ts'), 'utf8');
      expect(entry).toContain('repoExt'); // unlike the true-absence case above, the starter IS compiled in
    }, 20_000);

    test('the DOM renders IDENTICALLY to the no-extension board — no notice, no custom panel/override text', async () => {
      await bootBundle(portStarter, `/?issue=${issueIdStarter}`);
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      expect(document.querySelector('.visualizer-notice.extension-error')).toBeNull();
      const starterDrawerText = document.body.textContent ?? '';
      await unmountDom();

      await bootBundle(portAbsent, `/?issue=${issueIdAbsent}`);
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      expect(document.querySelector('.visualizer-notice.extension-error')).toBeNull();
      const absentDrawerText = document.body.textContent ?? '';

      // Neither drawer carries any sign of a custom member (dev/01a/dev/01b's own fixtures prove
      // those DO show up when an extension declares them) — the no-op starter contributes NOTHING
      // observable, exactly like true absence.
      expect(starterDrawerText).not.toContain('Repo Custom Panel');
      expect(starterDrawerText).not.toContain('REPO-OVERRIDE');
      expect(absentDrawerText).not.toContain('Repo Custom Panel');
      expect(absentDrawerText).not.toContain('REPO-OVERRIDE');
    }, 20_000);
  });

  describe('dev/03a — failure isolation: a syntactically broken extension.tsx', () => {
    const port = BASE_PORT + 4;
    let root = '';
    let proc: ChildProcess | undefined;
    let issueId = '';

    beforeAll(async () => {
      root = initFixture();
      writeExtension(root, `
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';

export default defineVisualizerExtension({
  issuePanels: (issue) => (
    <section className="panel">
`); // deliberately unterminated JSX — a real Syntax Error
      createIssue(root, { title: 'Broken extension', state: 'draft', body: scaffoldBody(root, 'Broken extension') });
      proc = startServer(root, port);
      await waitUp(port);
      issueId = ((await fetchBoard(port)).issues as Array<{ id: string }>)[0]!.id;
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('/assets/app.js never 500s, the board keeps working, and a notice carries the compile error', async () => {
      const res = await fetch(`http://localhost:${port}/assets/app.js`);
      expect(res.status).toBe(200); // NOT 500 — failure isolation, rebuilt without the repo extension

      const board = await fetchBoard(port);
      expect(board.extensionError).toBeTruthy();
      expect(String(board.extensionError)).toContain('Syntax Error');

      await bootBundle(port, `/?issue=${issueId}`);
      await waitFor(() => !!document.querySelector('.detail-drawer')); // the board still renders — working
      await waitFor(() => (document.body.textContent ?? '').includes('Syntax Error'));
      const body = document.body.textContent ?? '';
      expect(body).toContain(String(board.extensionError)); // the SAME shipped error text, rendered
    }, 20_000);
  });

  describe('dev/03b — failure isolation: an unresolvable \'ztrack/visualizer-kit\' import', () => {
    const port = BASE_PORT + 5;
    let root = '';
    let proc: ChildProcess | undefined;

    beforeAll(async () => {
      root = initFixture();
      writeExtension(root, `
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';
export default defineVisualizerExtension({ acText: (ac) => ac.id });
`);
      breakVisualizerKitResolution(root); // 'ztrack/preset-kit' keeps resolving; ONLY visualizer-kit breaks
      createIssue(root, { title: 'Unresolvable kit', state: 'draft', body: scaffoldBody(root, 'Unresolvable kit') });
      proc = startServer(root, port);
      await waitUp(port);
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('the board keeps working (preset.mts still resolves ztrack/preset-kit) and the notice carries the npm-install translation', async () => {
      const res = await fetch(`http://localhost:${port}/assets/app.js`);
      expect(res.status).toBe(200);

      const board = await fetchBoard(port);
      expect(Array.isArray(board.issues)).toBe(true);
      expect((board.issues as unknown[]).length).toBeGreaterThan(0); // preset.mts resolution is UNAFFECTED — a real board, not a 500
      expect(board.extensionError).toBeTruthy();
      expect(String(board.extensionError)).toContain('npm install -D ztrack'); // presetRegistry.ts:110-115's translation, reused

      await bootBundle(port);
      await waitFor(() => (document.body.textContent ?? '').includes('npm install -D ztrack'));
      expect(document.body.textContent ?? '').toContain('npm install -D ztrack');
    }, 20_000);
  });

  describe('dev/04 — live edit: no server restart', () => {
    const port = BASE_PORT + 6;
    let root = '';
    let proc: ChildProcess | undefined;
    let issueId = '';

    beforeAll(async () => {
      root = initFixture();
      writeExtension(root, `
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';
export default defineVisualizerExtension({
  issuePanels: (issue) => <section className="panel"><div className="panel-title"><h3>Version One</h3></div></section>,
});
`);
      createIssue(root, { title: 'Live edit fixture', state: 'draft', body: scaffoldBody(root, 'Live edit fixture') });
      proc = startServer(root, port);
      await waitUp(port);
      issueId = ((await fetchBoard(port)).issues as Array<{ id: string }>)[0]!.id;
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('editing extension.tsx live is reflected in the NEXT /assets/app.js fetch — no restart', async () => {
      await bootBundle(port, `/?issue=${issueId}`);
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      await waitFor(() => (document.body.textContent ?? '').includes('Version One'));
      expect(document.body.textContent ?? '').toContain('Version One');
      await unmountDom();

      writeExtension(root, `
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';
export default defineVisualizerExtension({
  issuePanels: (issue) => <section className="panel"><div className="panel-title"><h3>Version Two</h3></div></section>,
});
`);
      const future = new Date(Date.now() + 2000);
      utimesSync(extensionPath(root), future, future); // some filesystems coalesce sub-second mtimes; force a distinct one, mirroring VIZ-4 dev/05's own live-edit test

      await bootBundle(port, `/?issue=${issueId}`); // a fresh /assets/app.js fetch — same server PROCESS, no restart
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      await waitFor(() => (document.body.textContent ?? '').includes('Version Two'));
      const body = document.body.textContent ?? '';
      expect(body).toContain('Version Two');
      expect(body).not.toContain('Version One'); // the OLD bundle content is genuinely gone, not just appended
    }, 25_000);
  });

  describe('dev/05 — confinement: a symlinked state dir pointing outside the project is refused', () => {
    const port = BASE_PORT + 7;
    let root = '';
    let external = '';
    let proc: ChildProcess | undefined;

    beforeAll(async () => {
      root = initFixture();
      createIssue(root, { title: 'Confinement fixture', state: 'draft', body: scaffoldBody(root, 'Confinement fixture') });

      external = mkdtempSync(join(tmpdir(), 'ztrk-viz13-external-'));
      writeFileSync(join(external, 'extension.tsx'), `
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';
export default defineVisualizerExtension({ acText: (ac) => ac.id });
`);
      // Symlink the `visualizer` DIRECTORY (not the file) to somewhere entirely outside the
      // project root — mirrors presetRegistry.ts:127-130's own guarded case (a symlinked state
      // dir), applied to the conventional `<stateDir>/tracker/visualizer/` path.
      rmSync(extensionDir(root), { recursive: true, force: true });
      symlinkSync(external, extensionDir(root));

      proc = startServer(root, port);
      await waitUp(port);
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
      if (external) rmSync(external, { recursive: true, force: true });
    });

    test('/assets/app.js is refused, naming the escaping path', async () => {
      const res = await fetch(`http://localhost:${port}/assets/app.js`);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toContain(external); // the error names the path it actually resolved to (outside the project)
      expect(text.toLowerCase()).toContain('outside');
    }, 20_000);
  });

  describe('dev/06 — react aliasing: the fixture has NO node_modules/react', () => {
    const port = BASE_PORT + 8;
    let root = '';
    let proc: ChildProcess | undefined;
    let issueId = '';

    beforeAll(async () => {
      root = initFixture();
      writeExtension(root, `
import { defineVisualizerExtension } from 'ztrack/visualizer-kit';

export default defineVisualizerExtension({
  issuePanels: (issue) => (
    <section className="panel">
      <div className="panel-title"><h3>No React Installed Panel</h3></div>
    </section>
  ),
});
`);
      createIssue(root, { title: 'React alias fixture', state: 'draft', body: scaffoldBody(root, 'React alias fixture') });
      proc = startServer(root, port);
      await waitUp(port);
      issueId = ((await fetchBoard(port)).issues as Array<{ id: string }>)[0]!.id;
    }, 30_000);

    afterAll(() => {
      try { proc?.kill(); } catch { /* */ }
      if (root) rmSync(root, { recursive: true, force: true });
    });

    test('the fixture genuinely has no node_modules/react', () => {
      expect(existsSync(join(root, 'node_modules', 'react'))).toBe(false);
      expect(existsSync(join(root, 'node_modules', '.bin', 'react'))).toBe(false);
    });

    test('the extension (JSX) still compiles and renders — the alias plugin resolved react/jsx-runtime to the visualizer\'s own copy', async () => {
      const board = await fetchBoard(port);
      expect(board.extensionError).toBeUndefined(); // no "could not resolve react" failure

      await bootBundle(port, `/?issue=${issueId}`);
      await waitFor(() => !!document.querySelector('.detail-drawer'));
      await waitFor(() => (document.body.textContent ?? '').includes('No React Installed Panel'));
      expect(document.body.textContent ?? '').toContain('No React Installed Panel');
    }, 20_000);
  });
});
