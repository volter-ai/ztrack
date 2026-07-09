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

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
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
  cacheRoot,
  stateDirName,
  resolveTrackerValidation,
  loadValidationInput,
  VisualizerSpecSchema,
  bustPresetCacheIfChanged,
} = core;

const PORT = Number(process.env.PORT ?? 3300);
const PROJECT_DIR = (process.env.PROJECT_DIR ?? process.cwd()).replace(/\/$/, '');
const PRESET = process.env.PRESET ?? 'default';
const TRACKER_DIR = join(PROJECT_DIR, 'tracker');
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
let clientBundle: Promise<{ text: string; extensionError?: string }> | null = null;

// Optional repo-local theme override (VIZ-6) — fixed conventional path beside the preset
// (`<stateDir>/tracker/visualizer/theme.css`), derived via stateDirName() (never hardcode
// `.volter/`) so a non-default VOLTER_STATE_DIR still resolves correctly. No config key:
// file-presence is the opt-in, exactly like preset.mts. This is a CONSTANT, not built from
// any request field, so the /assets/theme.css route below has no request-path input to abuse.
const THEME_CSS_PATH = join(PROJECT_DIR, stateDirName(), 'tracker', 'visualizer', 'theme.css');

// Orphan guard. This server is a child of the `ztrack visualizer` wrapper, which
// awaits it and is meant to bound its lifetime; the wrapper kills us on its own
// SIGINT/SIGTERM/exit. But if the wrapper is SIGKILLed no signal reaches us and we
// would be orphaned to PID 1 and leak forever (this is exactly how 55 of these
// accumulated). The wrapper hands us its pid in ZTRACK_VIZ_PARENT_PID; poll whether
// it is still alive (`kill(pid, 0)` throws once it's gone) and self-exit when it
// dies. We poll the SPECIFIC pid, not ppid===1, because bun's cold start can finish
// reparenting before this code runs — a ppid check would then never arm. If the env
// is absent (run directly, e.g. as a deliberate daemon) we install no guard.
const parentPid = Number(process.env.ZTRACK_VIZ_PARENT_PID || 0);
if (parentPid > 0) {
  setInterval(() => {
    try { process.kill(parentPid, 0); } catch { process.exit(0); }
  }, 5000).unref();
}

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
  const resolved = await resolveActivePreset();
  if (!resolved) return null;
  const { preset, presetName } = resolved;
  const { records, context } = await loadValidationInput(preset, { projectRoot: PROJECT_DIR });
  const r = check(preset, records, context);
  return {
    preset,
    presetName,
    issues: r.export ? [...r.export.issues] : [],
    findings: [...r.findings],
  };
}

// Preset resolution ONLY (no check/loadValidationInput) — shared by `configuredBoard` (which
// goes on to check()) and the VIZ-13 bundle build (which only needs the RUNNING preset's name, to
// register the repo extension under it, VIZ-4's per-member merge). Returns null exactly when
// `configuredBoard` would: no tracker-config, so the caller falls back to the legacy per-document
// preset/name (`resolvePreset(PRESET)`).
async function resolveActivePreset(): Promise<{ preset: unknown; presetName: string } | null> {
  let config: { validation?: { entrypoint?: string } };
  try {
    config = loadTrackerConfig(PROJECT_DIR);
  } catch {
    return null; // no tracker-config — not a configured repo; use the doc-glob path
  }
  // Honor validation.entrypoint exactly as check does; fall back to the core
  // registry by the requested preset name only when no entrypoint is configured.
  const entrypoint = config.validation?.entrypoint?.trim();
  // VIZ-3 live loop: bust the ESM import cache for the REPO's own preset.mts when its mtime has
  // moved since the last resolution (resolveTrackerValidation/presetRegistry.ts:117 imports this
  // exact `resolve(projectRoot, entrypoint)` path — recomputed here since the resolver keeps its
  // absolute path private). Without this, board() re-resolves the preset every request but Bun's
  // import cache silently serves the stale module (verified) — see bustPresetCacheIfChanged.
  if (entrypoint) bustPresetCacheIfChanged(resolve(PROJECT_DIR, entrypoint));
  const preset = entrypoint
    ? await resolveTrackerValidation(config, PROJECT_DIR) // async (dynamic-imports preset.mts) — MUST await, or `preset` is a Promise and check sees no parse()
    : await resolvePreset(PRESET);
  return { preset, presetName: preset.name ?? PRESET };
}

// The RUNNING preset's canonical name, whichever load path produced it (configured entrypoint or
// the legacy `--preset`/env fallback) — mirrors board()'s own preset-name derivation exactly, so
// the repo extension (VIZ-13) always registers under the SAME name `buildEffectiveExtension`
// (client/extensions.tsx) looks up per render.
async function activePresetName(): Promise<string> {
  const resolved = await resolveActivePreset();
  if (resolved) return resolved.presetName;
  const preset = await resolvePreset(PRESET);
  return (preset as { name?: string }).name ?? PRESET;
}

// VIZ-3: the preset's optional `visualizer` block (VIZ-1's data vocabulary) rides the board
// payload, but ONLY validated — `assertCorePreset` (presetRegistry.ts) checks just
// name/schema/parse/rules, so a typo'd user block would otherwise reach the renderer unchecked.
// Pass-through ONLY: no synthesis, no fallback lookup, no list. Absent block -> `null`, no error.
// A block that fails `VisualizerSpecSchema` -> `null` plus a `visualizerError` naming the zod
// issue path; the raw invalid data never ships.
function resolveVisualizerBlock(preset: unknown): { visualizer: unknown; visualizerError?: string } {
  const raw = (preset as { visualizer?: unknown } | null)?.visualizer;
  if (raw === undefined) return { visualizer: null };
  const parsed = VisualizerSpecSchema.safeParse(raw);
  if (parsed.success) return { visualizer: parsed.data };
  const issue = parsed.error.issues[0];
  const path = issue && issue.path.length ? issue.path.join('.') : '(root)';
  return { visualizer: null, visualizerError: `visualizer.${path}: ${issue?.message ?? 'invalid visualizer block'}` };
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
  // affordances, e.g. an SDLC edited by its own tooling) and append audit entries.
  // The log lives in the tracker state dir (`.volter/tracker/.audit.jsonl`) — the SAME
  // path the CLI's post-mutation observe writes, so the two share one log + baseline.
  const auditRepo = cacheRoot(PROJECT_DIR);
  observeChanges(auditRepo, issues as Array<{ id: string; status: string; acceptanceCriteria: Array<{ id: string; status: string; evidence: unknown[] }> }>);
  // audit (the separate log) + derived timestamps, per issue
  const auditAll = readAudit(auditRepo);
  const audit: Record<string, unknown> = {};
  const timestamps: Record<string, unknown> = {};
  for (const i of issues as Array<{ id: string }>) {
    const es = auditAll.filter((e) => e.issueId === i.id);
    if (es.length) audit[i.id] = es;
    timestamps[i.id] = timestampsFor(auditAll, i.id);
  }
  // VIZ-3: validated pass-through of the preset's dashboard vocabulary (VIZ-1) — see
  // resolveVisualizerBlock above for the validate-or-null-plus-error contract.
  const { visualizer, visualizerError } = resolveVisualizerBlock(preset);
  // VIZ-13: surface a repo extension.tsx build failure (failure-isolation retry, see
  // getClientBundle) as a payload field the client renders as a notice — independent of whether
  // /assets/app.js has actually been fetched yet (board() drives its own bundle-status check so
  // `/api/board` reflects the current extension state even when hit before the SPA shell loads).
  // A confinement refusal (resolveExtensionPath below) is NOT surfaced here — it is a hard 500 on
  // /assets/app.js itself (dev/05), not a degrade-and-notify case.
  let extensionError: string | undefined;
  try { extensionError = (await getClientBundle()).extensionError; } catch { /* confinement or a build failure even without the extension — /assets/app.js itself reports it */ }
  return {
    title: 'tracker',
    preset: presetName,
    primitives: (preset as { primitives?: Record<string, unknown> }).primitives ?? {}, // which primitives this SDLC implements
    visualizer,
    visualizerError, // JSON.stringify drops this key entirely when undefined (the no-error case)
    extensionError, // ditto — VIZ-13's repo-extension compile-error notice
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

// VIZ-4: `Bun.build` has NO glob/virtual-module facility, and multiple entrypoints produce
// INDEPENDENT bundles (only outputs[0] is served below) — so first-party code extensions
// (`client/presets/*.tsx`, filename = canonical preset name, mirroring the boilerplates
// two-file convention) are wired into ONE generated synthetic entry module that registers each
// found extension and then imports main.tsx, passed as the SINGLE Bun.build entrypoint.
// VIZ-13 extends this same generated entry with the repo-local `extension.tsx`, registered under
// the RUNNING preset's own name so it layers OVER (not replaces) a first-party entry — see
// registerExtension's per-member merge, client/extensions.tsx.
const CLIENT_DIR = new URL('./client/', import.meta.url).pathname;
const PRESETS_DIR = join(CLIENT_DIR, 'presets');

// VIZ-13: the repo-owned extension — fixed conventional path beside preset.mts/theme.css (no
// config key; file-presence is the opt-in, exactly like theme.css/VIZ-6). Derived via
// stateDirName() (src/config.ts) — never hardcode `.volter/`, mirroring THEME_CSS_PATH above.
const EXTENSION_TSX_PATH = join(PROJECT_DIR, stateDirName(), 'tracker', 'visualizer', 'extension.tsx');

// A confinement refusal (resolveExtensionPath, below) is a distinct error class from a build
// failure — it must NOT be caught by the failure-isolation retry (a malformed extension rebuilds
// WITHOUT it; an extension resolved from OUTSIDE the project is refused outright, same trust
// posture as presetRegistry.ts's loadValidationEntrypoint confinement check).
class ExtensionConfinementError extends Error {}

// Realpath the resolved conventional path and require containment inside the project root,
// mirroring presetRegistry.ts:127-130 (which guards a symlinked state dir the same way). Unlike
// that check (guarding a user-configured `validation.entrypoint` string), this path is a fixed
// constant — the only way it can escape is a symlink somewhere along `<stateDir>/tracker/
// visualizer/` itself pointing outside the project, so a plain `resolve()`+`startsWith()` on the
// UNRESOLVED path (which a symlink would sail through unchanged) isn't enough; realpath resolves
// the symlink first. Returns null when the file is simply absent (the normal, opt-out case — not
// an error).
function resolveExtensionPath(): string | null {
  if (!existsSync(EXTENSION_TSX_PATH)) return null;
  let real: string;
  try { real = realpathSync(EXTENSION_TSX_PATH); } catch { return null; } // vanished between the existsSync check and here
  const root = realpathSync(PROJECT_DIR);
  if (real !== root && !real.startsWith(root + sep)) {
    throw new ExtensionConfinementError(
      `ztrack visualizer: the repo extension must live inside the project — '${EXTENSION_TSX_PATH}' resolves to '${real}', outside '${root}'.`,
    );
  }
  return real;
}

function extensionMtimeMs(): number | null {
  try { return statSync(EXTENSION_TSX_PATH).mtimeMs; } catch { return null; } // absent, or a dangling symlink — treated as "no extension" here (resolveExtensionPath is the source of truth for confinement)
}

function scanFirstPartyExtensions(): Array<{ name: string; file: string }> {
  if (!existsSync(PRESETS_DIR)) return [];
  return readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ name: f.replace(/\.tsx$/, ''), file: join(PRESETS_DIR, f) }))
    .sort((a, b) => a.name.localeCompare(b.name)); // stable generated-file ordering
}

// react/jsx aliasing (VIZ-13): the repo extension lives OUTSIDE this visualizer's own directory
// tree (under the REPO's state dir), so Bun's node-resolution walk-up would never reach
// `visualizer/node_modules/react` for it the way it does for first-party `client/**` modules —
// a repo extension author should not need to install react (src/cli.ts:231-236 already installed
// it here, once, for the visualizer itself). Applied to EVERY build, not just when a repo
// extension is present, so first-party presets/main.tsx resolve to the exact SAME react instance
// (never two copies in one bundle).
const VIZ_NODE_MODULES = join(here, 'node_modules');
const REACT_ALIAS_TARGETS: Record<string, string> = {
  react: join(VIZ_NODE_MODULES, 'react', 'index.js'),
  'react-dom': join(VIZ_NODE_MODULES, 'react-dom', 'index.js'),
  'react-dom/client': join(VIZ_NODE_MODULES, 'react-dom', 'client.js'),
  'react/jsx-runtime': join(VIZ_NODE_MODULES, 'react', 'jsx-runtime.js'),
  'react/jsx-dev-runtime': join(VIZ_NODE_MODULES, 'react', 'jsx-dev-runtime.js'),
};
const reactAliasPlugin = {
  name: 'ztrack-react-alias',
  setup(build) {
    build.onResolve({ filter: /^react(-dom)?(\/(jsx-runtime|jsx-dev-runtime|client))?$/ }, (args) => {
      const target = REACT_ALIAS_TARGETS[args.path];
      return target ? { path: target } : undefined;
    });
  },
};

// Written to a WRITABLE scratch location (cacheRoot — for a linked tracker this resolves to
// `<git-common-dir>/ztrack`, possibly outside this worktree, src/config.ts:76-82) rather than
// anywhere under the client tree itself, since imports inside it must be absolute paths anyway
// (the file may not live near what it imports). Regenerated on every fresh bundle build (i.e.
// whenever the `clientBundle` memo is empty) — cheap, and keeps the registered set in sync with
// whatever is on disk right now. `repoExt` is omitted entirely for the FAILURE-ISOLATION retry
// build (getClientBundle) — the generated module is then byte-identical to the no-extension case
// modulo the first-party set, which is exactly VIZ-13 dev/02's assertion.
function writeGeneratedEntry(repoExt: { path: string; presetName: string } | null): string {
  const extensions = scanFirstPartyExtensions();
  const dir = join(cacheRoot(PROJECT_DIR), 'visualizer');
  mkdirSync(dir, { recursive: true });
  const entryPath = join(dir, 'generated-entry.ts');
  const lines: string[] = [
    '// AUTO-GENERATED by visualizer/server.ts (VIZ-4/VIZ-13) — regenerated on every client bundle build. Do not edit.',
    `import { registerExtension } from ${JSON.stringify(join(CLIENT_DIR, 'extensions.tsx'))};`,
  ];
  extensions.forEach((e, i) => lines.push(`import ext${i} from ${JSON.stringify(e.file)};`));
  extensions.forEach((e, i) => lines.push(`registerExtension(${JSON.stringify(e.name)}, ext${i});`));
  if (repoExt) {
    // Registered under the RUNNING preset's own canonical name — layers OVER a first-party entry
    // of the same name via registerExtension's per-member merge (client/extensions.tsx): a repo
    // member wins per member, precedence data < first-party < repo (spec §2 layer 2).
    lines.push(`import repoExt from ${JSON.stringify(repoExt.path)};`);
    lines.push(`registerExtension(${JSON.stringify(repoExt.presetName)}, repoExt);`);
  }
  lines.push(`import ${JSON.stringify(join(CLIENT_DIR, 'main.tsx'))};`);
  writeFileSync(entryPath, lines.join('\n') + '\n');
  return entryPath;
}

async function runBuild(repoExt: { path: string; presetName: string } | null): Promise<string> {
  const result = await Bun.build({
    entrypoints: [writeGeneratedEntry(repoExt)],
    target: 'browser',
    sourcemap: 'inline',
    plugins: [reactAliasPlugin],
  });
  // On Bun 1.3 a failing build normally THROWS (an AggregateError of BuildMessage/ResolveMessage)
  // rather than resolving `{ success: false }` — reviewer-reproduced, verified again here (see
  // the `.catch` in getClientBundle, which is what actually observes that thrown form). This
  // `{ success: false }` branch stays as a defensive fallback for whichever Bun releases DO
  // resolve it that way, so both forms are handled by ONE translation path either way.
  if (!result.success) throw new Error(result.logs.map((l) => l.message).join('\n') || 'client build failed');
  return result.outputs[0]!.text();
}

// Turn a raw Bun.build failure (thrown AggregateError, or the defensive `{success:false}` Error
// above) into the SAME `npm install -D ztrack` translation the preset loader gives
// (presetRegistry.ts:110-115) when the failure is specifically an unresolvable
// 'ztrack/visualizer-kit' — Bun's own resolver message is
// `Could not resolve: "ztrack/visualizer-kit". Maybe you need to "bun install"?` (verified
// empirically). Any other build failure (a syntax error, a bad JSX tag, …) is reported as-is,
// prefixed with which file it came from.
function translateExtensionBuildError(err: unknown, extPath: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const messages = (err && typeof err === 'object' && Array.isArray((err as { errors?: unknown }).errors))
    ? (err as { errors: Array<{ message?: string }> }).errors.map((e) => e.message ?? '').join('\n')
    : raw;
  if (/Could not resolve:\s*"ztrack\/visualizer-kit"|Cannot find package ['"]ztrack['"]|Cannot find module ['"]ztrack/.test(messages)) {
    return (
      `The visualizer extension (${extPath}) imports 'ztrack/visualizer-kit', but the 'ztrack' package isn't resolvable from this project. `
      + `Install it as a dependency so the extension can load it:\n\n    npm install -D ztrack\n\n`
      + `(ztrack works like eslint — the extension is your dashboard mod and imports the mechanism from the installed package; a global or one-off 'npx' install is not enough.)`
    );
  }
  return `The visualizer extension (${extPath}) failed to compile:\n\n${messages}`;
}

// mtime-keyed memo invalidation (VIZ-13): `Bun.build` re-reads source files fresh from disk on
// every call, so a plain mtime check on the ONE file that can silently change between builds
// (the repo extension — first-party `client/presets/*.tsx` changes only in dev-on-this-repo,
// which restarts the process anyway) is sufficient to keep the memo honest; no restart needed.
let lastExtensionMtime: number | null | undefined; // undefined = not checked yet (forces the first build)

async function getClientBundle(): Promise<{ text: string; extensionError?: string }> {
  const mtime = extensionMtimeMs();
  if (mtime !== lastExtensionMtime) { clientBundle = null; lastExtensionMtime = mtime; }
  if (!clientBundle) {
    clientBundle = (async () => {
      const extPath = resolveExtensionPath(); // throws ExtensionConfinementError — NOT isolated, propagates as-is
      if (!extPath) return { text: await runBuild(null) };
      const presetName = await activePresetName();
      try {
        return { text: await runBuild({ path: extPath, presetName }) };
      } catch (err) {
        // FAILURE ISOLATION (VIZ-13): a malformed extension, or one whose own
        // 'ztrack/visualizer-kit' import doesn't resolve, must not take the board down — rebuild
        // WITHOUT it and surface the (translated) error as a payload/notice field instead.
        const extensionError = translateExtensionBuildError(err, extPath);
        const text = await runBuild(null); // truly broken even without the extension -> propagates, no further isolation
        return { text, extensionError };
      }
    })().catch((error) => { clientBundle = null; throw error; });
  }
  return clientBundle;
}

const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tracker · core</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2324262d'/%3E%3Ctext x='16' y='21' text-anchor='middle' font-family='Arial' font-size='11' font-weight='700' fill='white'%3E◆%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/assets/styles.css">
<link rel="stylesheet" href="/assets/theme.css"></head>
<body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`;

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1', // local dev tool: never bind to all interfaces (it serves repo files)
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/assets/app.js') {
      try { return new Response((await getClientBundle()).text, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', ...NO_STORE } }); }
      catch (e) { return new Response(String(e), { status: 500 }); }
    }
    if (url.pathname === '/assets/styles.css') {
      return new Response(Bun.file(new URL('./client/styles.css', import.meta.url)), { headers: { 'Content-Type': 'text/css; charset=utf-8', ...NO_STORE } });
    }
    if (url.pathname === '/assets/theme.css') {
      // Read PER REQUEST (no memo) so an edit to the repo-local file shows on the next reload —
      // unlike /assets/app.js this file is cheap to stat+read and has no build step. The
      // /project/ route (below) can't serve this: it blocks dot-segments (see projectFile) and
      // theme.css lives under the dotdir state root, so this dedicated route exists instead.
      // THEME_CSS_PATH is a fixed constant, not derived from the request, so there is no
      // request-path input for a traversal to act on.
      if (!existsSync(THEME_CSS_PATH)) return new Response('', { status: 404 });
      return new Response(Bun.file(THEME_CSS_PATH), { headers: { 'Content-Type': 'text/css; charset=utf-8', ...NO_STORE } });
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
