// VIZ-16 dev/01: the shipped `boilerplates/visualizer/extension.tsx` — the worked example a real
// repo copies into `<stateDir>/tracker/visualizer/extension.tsx` — actually renders, in a real
// board, over real simple-sdlc issue data.
//
// Mirrors `visualizer/client/render.viz13.e2e.test.tsx`'s harness exactly: `ztrack init` a fixture
// repo (default preset, simple-sdlc), copy the SHIPPED extension.tsx file VERBATIM (readFileSync
// from its real path, not a re-typed inline copy — proving the file that ships is the file that
// works) into the fixture's `.volter/tracker/visualizer/extension.tsx`, boot the real visualizer
// server against that fixture, download the REAL served `/assets/app.js` bundle, and `import()`
// it inside a freshly-mounted happy-dom window — the same compile path (repo extension.tsx ->
// generated Bun.build entry -> served bundle, VIZ-13) and the same react/jsx-runtime ALIASING a
// real browser would exercise (see that file's header comment for why executing the real bundle,
// not importing the source directly, is required here).
//
// Gated exactly like `render.viz13.e2e.test.tsx` / `src/visualizerKitFixture.e2e.test.ts`:
// visualizer client deps installed (`visualizer/node_modules/react` present — CI's "Typecheck
// visualizer client" step runs `cd visualizer && bun install --silent` first) AND the package
// itself built (`dist/src/visualizerKit.js` present — a fixture's extension.tsx imports
// 'ztrack/visualizer-kit', which resolves via THIS repo's package.json "exports" map to that
// file; CI's "Build package" step precedes "Test"). A local `bun test` run without that
// provisioning skips here rather than failing on an environment precondition — run `bun install`
// (repo root) + `cd visualizer && bun install` + `npm run build` first to make it RUN.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalWindow } from 'happy-dom';

const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli.ts');
const EXTENSION_SOURCE_PATH = join(import.meta.dir, 'extension.tsx');
const HAS_DEPS = existsSync(join(REPO, 'visualizer', 'node_modules', 'react'));
const KIT_BUILT = existsSync(join(REPO, 'dist', 'src', 'visualizerKit.js'));
const suite = HAS_DEPS && KIT_BUILT ? describe : describe.skip;

function zt(root: string, ...a: string[]) {
  return spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8' });
}

function initFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-viz16-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(root, 'node_modules', 'ztrack')); // extension.tsx imports 'ztrack/visualizer-kit' — same install requirement as a preset.mts's 'ztrack/preset-kit'
  const r = zt(root, 'init', '--team', 'V16'); // no --preset -> default -> simple-sdlc
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

function acPatch(root: string, issueId: string, acId: string, json: Record<string, unknown>): void {
  const r = zt(root, 'ac', 'patch', issueId, acId, '--json', JSON.stringify(json));
  if (r.status !== 0) throw new Error(`fixture: ac patch failed: ${r.stderr || r.stdout}`);
}

// ── the repo extension fixture — copies the SHIPPED file verbatim ─────────────────────────────
function installShippedExtension(root: string): void {
  const dir = join(root, '.volter', 'tracker', 'visualizer');
  mkdirSync(dir, { recursive: true });
  const source = readFileSync(EXTENSION_SOURCE_PATH, 'utf8'); // the REAL shipped file, byte-for-byte
  writeFileSync(join(dir, 'extension.tsx'), source);
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

// ── the DOM harness — EXECUTES THE REAL SERVED BUNDLE (same pattern as render.viz13.e2e.test.tsx) ──
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

async function bootBundle(port: number, path = '/'): Promise<void> {
  const code = await (await fetch(`http://localhost:${port}/assets/app.js`)).text();
  const tmpFile = join(tmpdir(), `ztrk-viz16-bundle-${process.pid}-${++scenarioId}.mjs`);
  writeFileSync(tmpFile, code);
  bundleTmpFiles.push(tmpFile);
  mountWindow(`http://localhost${path}`, port);
  await import(tmpFile);
  await waitFor(() => !!document.querySelector('.app-shell'));
}

const BASE_PORT = 8420 + (process.pid % 200) * 2;

describe('VIZ-16 dev/01 — boilerplates/visualizer/extension.tsx imports ONLY ztrack/visualizer-kit', () => {
  // The literal grep the task's acceptance criterion names, run for real and asserted on.
  test('every import line resolves to ztrack/visualizer-kit, and nothing else', () => {
    const source = readFileSync(EXTENSION_SOURCE_PATH, 'utf8');
    const importLines = source.split('\n').filter((line) => /^import\b/.test(line) || /from '/.test(line));
    expect(importLines.length).toBeGreaterThan(0); // sanity: the file does import something
    for (const line of importLines) expect(line).toContain("'ztrack/visualizer-kit'");
  });
});

suite('VIZ-16 dev/01 — the shipped example extension DOM-renders in the issue detail drawer (happy-dom, real bundle)', () => {
  const port = BASE_PORT;
  let root = '';
  let proc: ChildProcess | undefined;
  let issueId = '';

  beforeAll(async () => {
    root = initFixture(); // default = simple-sdlc
    installShippedExtension(root); // copies boilerplates/visualizer/extension.tsx VERBATIM

    const body = scaffoldBody(root, 'Proof coverage fixture');
    createIssue(root, { title: 'Proof coverage fixture', state: 'in-progress', body });

    proc = startServer(root, port);
    await waitUp(port);

    // Discover the issue/AC ids via the SAME `/api/board` route render.viz13.e2e.test.tsx uses
    // (the board re-reads from disk on every request — VIZ-3 — so patching AC fields via the CLI
    // after the server is already up is reflected on the very next fetch, no restart needed).
    const board = await fetchBoard(port);
    const issue = (board.issues as Array<{ id: string; acceptanceCriteria: Array<{ id: string }> }>)[0]!;
    issueId = issue.id;
    const acId = issue.acceptanceCriteria[0]!.id;

    // Give this issue's AC a fully-backed proof (a proof whose evidenceRefs resolve to a real
    // evidence entry) — the "Proof coverage" panel's ✓ path — so the fixture is realistic for the
    // panel it's proving. `Object.assign`-style overlay (modelEdit.ts's applyModelPatch) means
    // these two separate `ac patch` calls merge onto the same AC rather than clobbering each other.
    acPatch(root, issueId, acId, { evidence: [{ id: 'ev1', commit: '0'.repeat(40), acVersion: 1 }] });
    acPatch(root, issueId, acId, { proof: { explanation: 'demonstrated by ev1', evidenceRefs: ['ev1'] } });
  }, 30_000);

  afterAll(() => {
    try { proc?.kill(); } catch { /* */ }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  afterEach(async () => { await unmountDom(); });

  test('the board is healthy — the shipped extension compiled with no extensionError', async () => {
    const board = await fetchBoard(port);
    expect(board.extensionError).toBeUndefined();
  });

  test('opening the issue detail drawer renders the "Proof coverage" panel heading and its per-AC line', async () => {
    await bootBundle(port, `/?issue=${issueId}`);
    await waitFor(() => !!document.querySelector('.detail-drawer'));
    await waitFor(() => (document.body.textContent ?? '').includes('Proof coverage'));

    const body = document.body.textContent ?? '';
    expect(body).toContain('Proof coverage'); // the example panel's own heading
    expect(body).toContain('1/1'); // one AC, fully backed by proof+evidence -> the panel's own coverage count
    expect(body).toContain('evidence entry'); // the panel's own per-AC line text
    expect(document.querySelector('.visualizer-notice.extension-error')).toBeNull(); // a valid extension ships no error notice
  }, 20_000);

  test('the custom acEvidence renderer renders the evidence commit + AC version in the detail AC list', async () => {
    await bootBundle(port, `/?issue=${issueId}`);
    await waitFor(() => !!document.querySelector('.detail-drawer'));
    await waitFor(() => !!document.querySelector('.evidence-lines'));

    const evidenceEl = document.querySelector('.evidence-lines');
    expect(evidenceEl).not.toBeNull();
    const text = evidenceEl!.textContent ?? '';
    expect(text).toContain('ev1'); // the evidence id
    expect(text).toContain('0000000'); // the commit, rendered short (first 7 chars)
    expect(text).toContain('v1'); // the AC version
  }, 20_000);
});
