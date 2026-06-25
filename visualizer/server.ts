// @ts-nocheck — standalone Bun app; not part of the tsc build (tsconfig only includes src/**).
// ztrack visualizer — a preset-agnostic web view over the CORE export (not a
// legacy snapshot contract). For a configured repo it routes through the SAME
// pipeline as `ztrack check`/`export`: the active preset is resolved from the
// repo's tracker-config `validation.entrypoint` (repo-local presets load) and
// issues are read via the configured backend (sqlite-backed repos work), then
// validated and returned with findings. With no tracker-config it falls back to
// the legacy per-document path (bare tracker/*.md, or speckit specs/). The client
// renders the generic core model and defers preset-specific fields to a per-preset
// extension.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the ztrack core. In a repo checkout (src/*.ts present) import the
// source entry directly; in the published package import the self-contained
// bundle produced at build time (visualizer/core.js). The published package
// does not ship the engine as loose modules, only this bundle.
const here = dirname(fileURLToPath(import.meta.url));
const useSource = existsSync(join(here, '..', 'src', 'core', 'engine.ts'));
const core = useSource ? await import('./serverCore.ts') : await import('./core.js');
const {
  check,
  resolvePreset,
  observeChanges,
  readAudit,
  timestampsFor,
  buildSpeckitBundle,
  loadTrackerConfig,
  resolveTrackerValidation,
  loadValidationInput,
} = core;

const PORT = Number(process.env.PORT ?? 3300);
const PROJECT_DIR = (process.env.PROJECT_DIR ?? process.cwd()).replace(/\/$/, '');
const PRESET = process.env.PRESET ?? 'default';
const TRACKER_DIR = join(PROJECT_DIR, 'tracker');
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
let clientBundle: Promise<string> | null = null;

// Per-preset document discovery. default/spec: each tracker/*.md is one doc.
// speckit: each specs/<slug>/ feature dir is bundled into one doc.
function documents(preset: string): string[] {
  if (preset === 'speckit') {
    const specsDir = join(PROJECT_DIR, 'specs');
    if (!existsSync(specsDir)) return [];
    const out: string[] = [];
    // recursively collect every file under a feature dir (spec/plan/tasks/
    // research/data-model/quickstart + contracts/*)
    const walk = (abs: string, rel: string, acc: Array<{ path: string; content: string }>) => {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        const a = join(abs, e.name); const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(a, r, acc);
        else acc.push({ path: r, content: readFileSync(a, 'utf8') });
      }
    };
    for (const slug of readdirSync(specsDir).sort()) {
      const dir = join(specsDir, slug);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      const files: Array<{ path: string; content: string }> = [];
      walk(dir, `specs/${slug}`, files);
      const constitution = join(PROJECT_DIR, '.specify', 'memory', 'constitution.md');
      if (existsSync(constitution)) files.push({ path: '.specify/memory/constitution.md', content: readFileSync(constitution, 'utf8') });
      if (files.some((f) => /spec\.md$/.test(f.path))) out.push(buildSpeckitBundle(files));
    }
    return out;
  }
  return existsSync(TRACKER_DIR) ? readdirSync(TRACKER_DIR).filter((f) => f.endsWith('.md')).sort().map((f) => readFileSync(join(TRACKER_DIR, f), 'utf8')) : [];
}

// Load issues + findings the way `ztrack check`/`export` do: resolve the active
// preset from the repo's tracker-config `validation.entrypoint` (so a repo-local
// preset like peak's `peakcore` loads — not "Unknown preset"), and read issues
// through the configured backend (so a sqlite-backed repo yields its real issues —
// not an empty board from globbing tracker/*.md). One bundle, one check — the same
// pipeline the CLI runs. Returns null when there is no tracker-config to honor
// (e.g. a bare markdown/speckit dir), so the caller falls back to per-document.
async function configuredBoard(): Promise<{ preset: unknown; presetName: string; issues: unknown[]; findings: unknown[] } | null> {
  let config: { validation?: { entrypoint?: string } };
  try {
    config = loadTrackerConfig(PROJECT_DIR);
  } catch {
    return null; // no tracker-config — not a configured repo; use the doc-glob path
  }
  // Honor validation.entrypoint exactly as check does; fall back to the core
  // registry by the requested preset name only when no entrypoint is configured.
  const preset = config.validation?.entrypoint?.trim()
    ? await resolveTrackerValidation(config, PROJECT_DIR) // async (dynamic-imports preset.mts) — MUST await, or `preset` is a Promise and check sees no parse()
    : await resolvePreset(PRESET);
  const { records, context } = await loadValidationInput(preset, { projectRoot: PROJECT_DIR });
  const r = check(preset, records, context);
  return {
    preset,
    presetName: preset.name ?? PRESET,
    issues: r.export ? [...r.export.issues] : [],
    findings: [...r.findings],
  };
}

async function board() {
  const configured = await configuredBoard();
  let preset: unknown;
  let presetName: string;
  const issues: unknown[] = [];
  const findings: unknown[] = [];
  if (configured) {
    preset = configured.preset;
    presetName = configured.presetName;
    issues.push(...configured.issues);
    findings.push(...configured.findings);
  } else {
    // No tracker-config: legacy per-document path (bare tracker/*.md or speckit specs/).
    preset = await resolvePreset(PRESET);
    presetName = (preset as { name?: string }).name ?? PRESET;
    for (const doc of documents(PRESET)) {
      // Context is preset-owned: each preset's loadContext gathers exactly the facts
      // its rules read (git/world/services). The visualizer assumes nothing.
      const ctx = (await (preset as { loadContext?: (i: unknown) => unknown }).loadContext?.({ projectRoot: PROJECT_DIR, bundle: doc })) ?? {};
      const r = check(preset, doc, ctx);
      if (r.export) issues.push(...r.export.issues);
      findings.push(...r.findings);
    }
  }
  let mtime: string | null = null;
  try { mtime = existsSync(TRACKER_DIR) ? statSync(TRACKER_DIR).mtime.toISOString() : null; } catch { mtime = null; }
  // observe any change to the tracker data (incl. edits made outside our mutation
  // affordances, e.g. an SDLC edited by its own tooling) and append audit entries
  observeChanges(PROJECT_DIR, issues as Array<{ id: string; status: string; acceptanceCriteria: Array<{ id: string; status: string; evidence: unknown[] }> }>);
  // audit (the separate log) + derived timestamps, per issue
  const auditAll = readAudit(PROJECT_DIR);
  const audit: Record<string, unknown> = {};
  const timestamps: Record<string, unknown> = {};
  for (const i of issues as Array<{ id: string }>) {
    const es = auditAll.filter((e) => e.issueId === i.id);
    if (es.length) audit[i.id] = es;
    timestamps[i.id] = timestampsFor(auditAll, i.id);
  }
  return {
    title: 'tracker',
    preset: presetName,
    primitives: (preset as { primitives?: Record<string, unknown> }).primitives ?? {}, // which primitives this SDLC implements
    projectDir: PROJECT_DIR,
    fetchedAt: new Date().toISOString(),
    trackerChangedAt: mtime,
    ok: !findings.some((f) => (f as { severity: string }).severity === 'error'),
    issues,
    findings,
    audit,
    timestamps,
  };
}

function projectFile(pathname: string): string | null {
  const rel = normalize(decodeURIComponent(pathname.replace(/^\/project\//, ''))).replace(/^\/+/, '');
  if (rel.startsWith('..') || rel.includes('/../')) return null;
  // Never serve dotfiles or sensitive stores (.git, .env, .volter signing keys,
  // the tracker DB). The visualizer only needs tracker markdown + evidence images.
  if (rel.split('/').some((seg) => seg.startsWith('.')) || /\.(sqlite|pem|key)$/i.test(rel)) return null;
  const abs = join(PROJECT_DIR, rel);
  // resolve symlinks and re-check containment
  try { if (!realpathSync(abs).startsWith(realpathSync(PROJECT_DIR) + sep)) return null; } catch { /* not yet existing — join check below */ }
  return abs;
}

function contentType(p: string): string {
  const l = p.toLowerCase();
  if (l.endsWith('.png')) return 'image/png';
  if (l.endsWith('.jpg') || l.endsWith('.jpeg')) return 'image/jpeg';
  if (l.endsWith('.webp')) return 'image/webp';
  if (l.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

async function getClientBundle(): Promise<string> {
  if (!clientBundle) {
    clientBundle = Bun.build({
      entrypoints: [new URL('./client/main.tsx', import.meta.url).pathname],
      target: 'browser',
      sourcemap: 'inline',
    }).then((result) => {
      if (!result.success) throw new Error(result.logs.map((l) => l.message).join('\n') || 'client build failed');
      return result.outputs[0]!.text();
    }).catch((error) => { clientBundle = null; throw error; });
  }
  return clientBundle;
}

const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tracker · core</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2324262d'/%3E%3Ctext x='16' y='21' text-anchor='middle' font-family='Arial' font-size='11' font-weight='700' fill='white'%3E◆%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/assets/styles.css"></head>
<body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`;

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1', // local dev tool: never bind to all interfaces (it serves repo files)
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/assets/app.js') {
      try { return new Response(await getClientBundle(), { headers: { 'Content-Type': 'text/javascript; charset=utf-8', ...NO_STORE } }); }
      catch (e) { return new Response(String(e), { status: 500 }); }
    }
    if (url.pathname === '/assets/styles.css') {
      return new Response(Bun.file(new URL('./client/styles.css', import.meta.url)), { headers: { 'Content-Type': 'text/css; charset=utf-8', ...NO_STORE } });
    }
    if (url.pathname.startsWith('/project/')) {
      const p = projectFile(url.pathname);
      if (!p || !existsSync(p)) return new Response('Not Found', { status: 404 });
      return new Response(Bun.file(p), { headers: { 'Content-Type': contentType(p) } });
    }
    if (url.pathname === '/api/board') {
      try { return Response.json(await board()); }
      catch (e) { return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
    }
    if (!url.pathname.includes('.')) return new Response(SHELL, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`ztrack visualizer on http://localhost:${server.port}  (preset: ${PRESET}, repo: ${PROJECT_DIR})`);
