// demos/visualizer-mod/dom-check.mjs — VIZ-10's single assertion harness for
// `demos/visualizer-mod.sh`, run against the REAL running `ztrack visualizer` server.
//
// A plain `curl /` (or `fetch('/')`) only ever sees the static SPA shell — main.tsx's board
// columns, the AC-unit label, and the custom code panel are all rendered BY REACT, client side,
// and simply do not exist in that HTML. The only honest way to assert on them is to actually run
// the client bundle. So the DOM-RUNTIME section below reuses the EXACT mechanism
// `visualizer/client/render.viz13.e2e.test.tsx` (VIZ-13) proved out and
// `visualizer/client/render.e2e.test.tsx` (VIZ-4)'s `clickButtonWithText` helper: fetch the REAL
// served `/assets/app.js` from the running server, write it to a temp file, and `import()` it
// inside a happy-dom window — the app's own top-level `createRoot(...).render(<App/>)` mount runs
// exactly as a real browser tab would, repo extension bundled in and all.
//
// The PAYLOAD/BUNDLE sections below it are the spec's named fallback, not a substitute — they'd
// pass even if React rendered nothing, so the DOM section is what actually carries dev/01.
//
// This file lives under `demos/` (not a bare tmp file) so `import 'happy-dom'` resolves from THIS
// repo's own node_modules (happy-dom is a repo devDependency, not something a demo's fresh temp
// consumer project would ever have installed) — same resolution reasoning VIZ-13's own test file
// relies on; it's just invoked from `demos/visualizer-mod.sh` via `bun run`, not `bun test`.
//
// Usage: bun run demos/visualizer-mod/dom-check.mjs <port> <newStatus> <acUnitLabel> <panelHeading> <panelContent> <issueId> <themeCssPath>
import { GlobalWindow } from 'happy-dom';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , portArg, newStatus, acUnitLabel, panelHeading, panelContent, issueId, themeCssPath] = process.argv;
const port = Number(portArg);
if (!port || !newStatus || !acUnitLabel || !panelHeading || !panelContent || !issueId || !themeCssPath) {
  console.error('usage: dom-check.mjs <port> <newStatus> <acUnitLabel> <panelHeading> <panelContent> <issueId> <themeCssPath>');
  process.exit(2);
}
const base = `http://127.0.0.1:${port}`;

let fails = 0;
function ok(cond, label) {
  if (cond) console.log(`  ok: ${label}`);
  else { console.log(`  FAIL: ${label}`); fails += 1; }
}

async function waitFor(check, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

// ── THEME (VIZ-6): the FLOOR assertion — served at /assets/theme.css with our override content,
// linked AFTER /assets/styles.css in the shell. NOT a computed-style check: happy-dom (this
// repo's only DOM runtime, introduced for VIZ-4/VIZ-13) does not evaluate link-fetched
// stylesheets, so asserting a computed `--accent` here would be FAKE, not preferred — same
// rationale `src/visualizer.e2e.test.ts`'s own VIZ-6 dev/02 test states verbatim for this exact
// seam. Revisit once the DOM runtime supports link stylesheets; VIZ-11's screenshots backstop the
// visual claim meanwhile. ───────────────────────────────────────────────────────────────────────
console.log('## theme.css (VIZ-6) — FLOOR: served override + link order (computed-style not available in happy-dom, see comment)');
{
  const expected = readFileSync(themeCssPath, 'utf8');
  const served = await (await fetch(`${base}/assets/theme.css`)).text();
  ok(served === expected, 'served /assets/theme.css matches our repo-local override byte-for-byte');
  const shell = await (await fetch(`${base}/`)).text();
  const iStyles = shell.indexOf('/assets/styles.css');
  const iTheme = shell.indexOf('/assets/theme.css');
  ok(iStyles > -1 && iTheme > iStyles, 'shell links /assets/theme.css AFTER /assets/styles.css');
}

// ── PAYLOAD fallback: the wire payload (/api/board) already carries the modded vocabulary and the
// new-status issue, independent of any DOM/bundle concern. ───────────────────────────────────────
console.log('## payload fallback (/api/board)');
{
  const board = await (await fetch(`${base}/api/board`)).json();
  ok(board.visualizer?.acUnitLabel === acUnitLabel, `payload: visualizer.acUnitLabel is "${acUnitLabel}"`);
  ok(Array.isArray(board.visualizer?.statusOrder) && board.visualizer.statusOrder.includes(newStatus), `payload: visualizer.statusOrder includes "${newStatus}"`);
  const statuses = (board.issues ?? []).map((i) => i.status);
  ok(statuses.includes(newStatus), `payload: an issue is actually recorded in status "${newStatus}" (statuses seen: ${statuses.join(', ')})`);
  ok(board.extensionError === undefined, 'payload: no extensionError — the copied VIZ-16 boilerplate compiled cleanly');
}

// ── BUNDLE fallback: the served /assets/app.js literally contains the boilerplate's own panel
// heading — proof the repo extension.tsx was actually compiled INTO the served client, not just
// present on disk. ─────────────────────────────────────────────────────────────────────────────
console.log('## bundle fallback (/assets/app.js)');
let bundleCode = '';
{
  bundleCode = await (await fetch(`${base}/assets/app.js`)).text();
  ok(bundleCode.includes(panelHeading), `bundle: "${panelHeading}" is compiled into /assets/app.js`);
}

// ── the DOM harness (same globals-wiring pattern as VIZ-13/VIZ-4's mountDom) ──────────────────
let activeWindow = null;
let restoreFetch = null;
const bundleTmpFiles = [];

function mountWindow(url) {
  const win = new GlobalWindow({ url });
  activeWindow = win;
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.navigator = win.navigator;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Node = win.Node;
  globalThis.Event = win.Event;
  globalThis.MouseEvent = win.MouseEvent;
  globalThis.customElements = win.customElements;
  win.document.body.innerHTML = '<div id="root"></div>';

  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const rewritten = raw.startsWith('/') ? `${base}${raw}` : raw;
    return realFetch(rewritten, init);
  };
  restoreFetch = () => { globalThis.fetch = realFetch; };
}

async function unmountDom() {
  restoreFetch?.(); restoreFetch = null;
  if (activeWindow) { await activeWindow.happyDOM.close(); activeWindow = null; }
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'customElements']) {
    delete globalThis[k];
  }
  for (const f of bundleTmpFiles.splice(0)) { try { rmSync(f, { force: true }); } catch { /* already gone */ } }
}

let scenarioId = 0;
/** Write the ALREADY-FETCHED bundle text to a temp file and `import()` it inside a freshly-
 *  mounted happy-dom window — same trick as VIZ-13's `bootBundle`. */
async function bootBundle(path = '/') {
  const tmpFile = join(tmpdir(), `ztrk-vizmod-bundle-${process.pid}-${++scenarioId}.mjs`);
  writeFileSync(tmpFile, bundleCode);
  bundleTmpFiles.push(tmpFile);
  mountWindow(`${base}${path}`);
  await import(tmpFile);
  await waitFor(() => !!document.querySelector('.app-shell'));
}

function clickButtonWithText(text) {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no <button> with text ${JSON.stringify(text)} found`);
  btn.click();
}

// ── dev/01 (part 1): the new status COLUMN renders — switch to Board layout (default groupBy is
// already 'status') and read every column's own `.group-title` text. ─────────────────────────
console.log('## dev/01 — the new status column renders (Board layout, happy-dom real bundle)');
await bootBundle('/');
clickButtonWithText('Board');
await waitFor(() => !!document.querySelector('.board-column'));
const columnTitles = [...document.querySelectorAll('.board-column .group-title')].map((e) => e.textContent?.trim());
ok(columnTitles.includes(newStatus), `board column "${newStatus}" renders (columns seen: ${columnTitles.join(', ')})`);
ok(document.querySelector('.visualizer-notice.extension-error') === null, 'no extension-error notice on the board view');
await unmountDom();

// ── dev/01 (part 2 + 3): with the issue's detail view OPEN (panels only render in the drawer,
// main.tsx's Detail component ~:342/346) — the modded AC-unit LABEL and the custom code PANEL. ──
console.log('## dev/01 — the AC-unit label and the custom panel render (detail drawer OPEN, happy-dom real bundle)');
await bootBundle(`/?issue=${issueId}`);
await waitFor(() => !!document.querySelector('.detail-drawer'));
await waitFor(() => (document.body.textContent ?? '').includes(panelHeading));
const body = document.body.textContent ?? '';
ok(body.includes(acUnitLabel), `AC-unit label "${acUnitLabel}" renders inside the open detail drawer`);
ok(body.includes(panelHeading), `custom panel heading "${panelHeading}" renders inside the open detail drawer`);
ok(body.includes(panelContent), `custom panel content "${panelContent}" renders inside the open detail drawer`);
ok(document.querySelector('.visualizer-notice.extension-error') === null, 'no extension-error notice — the copied VIZ-16 boilerplate compiles cleanly, unedited');
await unmountDom();

console.log('');
console.log(fails === 0 ? 'dom-check: ALL PASS' : `dom-check: ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
