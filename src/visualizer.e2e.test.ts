// Boot the real `ztrack visualizer` (a Bun web app) and confirm it serves. Gated on its client
// deps (react) already being installed, so a clean CI checkout — where the first run would do a
// one-time `bun install` — skips rather than flaking; dev runs (deps present) exercise it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
const HAS_DEPS = existsSync(join(REPO, 'visualizer', 'node_modules', 'react'));
const suite = HAS_DEPS ? describe : describe.skip;

suite('visualizer — boots and serves', () => {
  let root = '';
  let proc: ChildProcess | undefined;
  const port = 7000 + (process.pid % 1500);

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-viz-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    const zt = (...a: string[]) => spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8' });
    zt('init');
    writeFileSync(join(root, 'b.md'), zt('issue', 'scaffold', '--title', 'V').stdout);
    zt('issue', 'create', '--title', 'V', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', 'b.md');
    proc = spawn('bun', ['run', CLI, 'visualizer', '--port', String(port), '--project', root], { cwd: root, stdio: 'ignore' });
  }, 30_000);

  afterAll(() => {
    try { proc?.kill(); } catch { /* */ }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('serves the SPA and the REAL issue data over /api/board', async () => {
    // wait for it to come up
    let status = 0;
    for (let i = 0; i < 25 && status !== 200; i++) {
      try { status = (await fetch(`http://localhost:${port}/`)).status; } catch { /* not up yet */ }
      if (status !== 200) await Bun.sleep(800);
    }
    expect(status).toBe(200);                                    // the SPA shell serves

    // the data API returns the ACTUAL tracker contents, not just a live socket
    const board = await (await fetch(`http://localhost:${port}/api/board`)).json() as { issues?: Array<{ id?: string; identifier?: string }> };
    expect(Array.isArray(board.issues)).toBe(true);
    const ids = (board.issues ?? []).map((i) => i.id ?? i.identifier);
    expect(ids).toContain('LOCAL-1');                            // the seeded issue is actually served
  }, 30_000);

  // VIZ-6 — repo-local theme.css seam (`/assets/theme.css`). `root` is only assigned inside
  // beforeAll, so this path must be computed lazily (a function), not captured as a `const` at
  // describe-body eval time (which would freeze on the pre-beforeAll empty string).
  const themeCssPath = () => join(root, '.volter', 'tracker', 'visualizer', 'theme.css');

  test('dev/01: /assets/theme.css is absent → empty 200 or 404, and the SHELL still renders', async () => {
    expect(existsSync(themeCssPath())).toBe(false); // nothing installed yet in this fixture repo
    const res = await fetch(`http://localhost:${port}/assets/theme.css`);
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) expect(await res.text()).toBe('');
    const shell = await (await fetch(`http://localhost:${port}/`)).text();
    expect(shell).toContain('<div id="root">'); // the SPA shell still renders with no theme file
  });

  test('dev/01: with theme.css present, it is served with Content-Type text/css — read PER REQUEST (no memo), so it appears without a restart', async () => {
    mkdirSync(join(root, '.volter', 'tracker', 'visualizer'), { recursive: true });
    writeFileSync(themeCssPath(), ':root { --accent: #123456; }');
    const res = await fetch(`http://localhost:${port}/assets/theme.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(await res.text()).toBe(':root { --accent: #123456; }'); // same server process, no restart — proves per-request read
  });

  test('dev/02 FLOOR: the SHELL links /assets/theme.css AFTER /assets/styles.css', async () => {
    const shell = await (await fetch(`http://localhost:${port}/`)).text();
    const iStyles = shell.indexOf('/assets/styles.css');
    const iTheme = shell.indexOf('/assets/theme.css');
    expect(iStyles).toBeGreaterThan(-1);
    expect(iTheme).toBeGreaterThan(iStyles);
    // PREFERRED assertion (per the spec: an overridden --accent is the computed value) is not
    // implemented here. This repo has no DOM test runtime at all yet (no happy-dom or similar
    // dependency anywhere in package.json/bun.lock), and link-fetched stylesheets are exactly the
    // fragile case such runtimes struggle with — adding one just for this would be a heavy new
    // dependency for a single assertion. The floor stands; revisit this test once the project's
    // DOM runtime (introduced for VIZ-4/VIZ-5's rendered assertions) supports link stylesheets.
  });

  test('dev/03: /assets/theme.css takes no request-path input — path traversal is impossible', async () => {
    // The route is a fixed-path const (THEME_CSS_PATH in visualizer/server.ts), computed once at
    // startup from stateDirName()+PROJECT_DIR — never from the incoming request. Prove it at
    // runtime: decorate the URL with a traversal-shaped query string and confirm the response is
    // still exactly the one conventional file's content, unaffected.
    const res = await fetch(`http://localhost:${port}/assets/theme.css?x=../../../../../../etc/passwd`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(':root { --accent: #123456; }'); // unchanged by the query string

    // And confirm by source inspection that the handler never builds its path from the request
    // (no url.pathname/decodeURIComponent/req.url reference inside the theme.css branch) — unlike
    // /project/ (projectFile()), which legitimately does take request-path input and defends it
    // with its own traversal checks.
    const serverSrc = readFileSync(join(REPO, 'visualizer', 'server.ts'), 'utf8');
    const routeStart = serverSrc.indexOf("url.pathname === '/assets/theme.css'");
    expect(routeStart).toBeGreaterThan(-1);
    const routeEnd = serverSrc.indexOf('\n    }', routeStart);
    const handlerBody = serverSrc.slice(routeStart, routeEnd);
    expect(handlerBody).not.toMatch(/url\.pathname\.replace|decodeURIComponent|req\.url/);
  });
});
