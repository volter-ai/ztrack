import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TrackerConfig } from './types.ts';
import type { CoreRoot, Preset } from './core/engine.ts';
import { loadTrackerConfig } from './config.ts';

export function noTrackerValidation(value: string | undefined): never {
  throw new Error(value
    ? `Unsupported legacy organization.validationPreset '${value}'. Run 'ztrack init --preset default' to install repo-local validation.`
    : "No tracker validation entrypoint configured. Run 'ztrack init --preset default' to install .volter/tracker/validation/preset.mts.");
}

/** Can THIS runtime load a `.mts` module? Bun strips types natively; Node reports its built-in
 *  type-stripping capability via `process.features.typescript` (absent on old Node, `false` on a
 *  build compiled without it — some distro builds omit the feature even at a new-enough version). */
function nativeTypeStrippingAvailable(): boolean {
  if (process.versions.bun) return true;
  return Boolean((process.features as { typescript?: string | false }).typescript);
}

/** The right fix for a runtime that can't type-strip, diagnosed precisely: an old Node needs an
 *  upgrade, but a NEW-ENOUGH Node that still can't do it is a build compiled without the feature —
 *  telling that user "upgrade Node" (the old message) misdiagnoses and strands them. */
function typeStrippingFix(): string {
  const [major = 0, minor = 0] = process.version.slice(1).split('.').map(Number);
  const versionSupports = (major === 22 && minor >= 18) || (major === 23 && minor >= 6) || major >= 24;
  return versionSupports
    ? `this Node (${process.version}) is new enough, but this particular build was compiled without TypeScript support (process.features.typescript is off — some distro/custom builds omit it). Use an official Node build (nodejs.org or nvm), or run via Bun`
    : `this Node (${process.version}) is too old — ztrack needs Node >= 22.18.0 (or >= 23.6, or >= 24). Upgrade Node`;
}

// Everything the loader needs from the project's node_modules — the same upward ESM-style walk
// cliInit.ts warns with at init time (deliberately NOT require.resolve/createRequire: that CJS
// resolver also consults Node's legacy global folders, which would mask exactly the bare-`npx`
// case this exists to catch — the real failure is an ESM `import()` of a bare specifier, which
// never looks there).
export function ztrackResolvableFrom(root: string): boolean {
  let dir = resolve(root);
  for (;;) {
    if (existsSync(join(dir, 'node_modules', 'ztrack'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Cheap, NON-EXECUTING health probe of the validation oracle: `null` when `check`/`loop` should
 *  be able to run here (or when there is nothing to probe — no tracker, no configured
 *  entrypoint), else one sentence naming what is broken and how to fix it. Deliberately never
 *  imports the preset: read-only commands must not execute repo code (the preset runs as code —
 *  SECURITY.md), so this checks only environment facts (file exists, runtime can type-strip,
 *  ztrack resolvable as a dependency). Used to warn on commands that SUCCEED without the preset
 *  (issue list/view, import, loop status …), which otherwise leave the tracker looking healthy
 *  right up until the first `check`/`loop`/`--actionable` dies. */
export function oracleUnavailableReason(projectRoot: string): string | null {
  let config: TrackerConfig;
  try { config = loadTrackerConfig(projectRoot); } catch { return null; }
  const entrypoint = config.validation?.entrypoint?.trim();
  if (!entrypoint) return null; // legacy/validation-less configs get their own error at check time
  const absolutePath = resolve(projectRoot, entrypoint);
  if (!existsSync(absolutePath)) return `the configured validation entrypoint is missing (${entrypoint})`;
  if (/\.(mts|ts|cts)$/.test(absolutePath) && !nativeTypeStrippingAvailable()) {
    return `the ${entrypoint.split('.').pop()} validation preset can't load: ${typeStrippingFix()}`;
  }
  if (!ztrackResolvableFrom(projectRoot)) {
    return "the preset imports 'ztrack/preset-kit' but ztrack isn't installed as a project dependency — run `npm install -D ztrack`";
  }
  return null;
}

function assertCorePreset(value: unknown, source: string): Preset<CoreRoot> {
  if (!value || typeof value !== 'object') {
    throw new Error(`Validation entrypoint ${source} did not export a preset object`);
  }
  const preset = value as Partial<Preset<CoreRoot>>;
  if (typeof preset.name !== 'string' || !preset.schema || typeof preset.parse !== 'function' || !Array.isArray(preset.rules)) {
    throw new Error(`Validation entrypoint ${source} is not a core preset (need name, schema, parse, rules)`);
  }
  return value as Preset<CoreRoot>;
}

// Loaded via dynamic import so a preset can be a plain ESM `.ts`/`.js` module (no `.cjs`
// bundle, no `require`). Dynamic import also loads CommonJS, so an existing `.cjs` preset
// keeps resolving — the export is read off `default`. Shared by both load routes
// (config-named entrypoint and operator `--preset`) so the import machinery — including the
// `.mts` type-stripping and 'ztrack'-not-installed error translations — isn't duplicated.
async function importPresetModule(absolutePath: string, describeSource: string): Promise<Preset<CoreRoot>> {
  let loaded: { default?: unknown; preset?: unknown };
  try {
    loaded = await import(pathToFileURL(absolutePath).href) as { default?: unknown; preset?: unknown };
  } catch (err) {
    // The installed preset imports `ztrack/preset-kit`; that bare specifier resolves from the
    // PROJECT's node_modules. If ztrack isn't a dependency there (e.g. it was run via `npx`
    // without being installed), the import fails — turn the raw resolver error into a fix.
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | undefined)?.code;
    // The installed preset is a `.mts` loaded via Node's native type stripping (unflagged on Node
    // >= 22.18 / >= 23.6 / >= 24). On older Node the import fails with ERR_UNKNOWN_FILE_EXTENSION;
    // a new-enough Node BUILT without the feature fails with ERR_NO_TYPESCRIPT ("Node.js is not
    // compiled with TypeScript support"). Diagnose which one it actually is — the old message
    // told a user on a featureless 22.22 build to "upgrade Node", which misdiagnoses.
    if (code === 'ERR_UNKNOWN_FILE_EXTENSION' || code === 'ERR_NO_TYPESCRIPT'
      || /Unknown file extension "\.?mts"/.test(msg) || /not compiled with TypeScript support/.test(msg)) {
      throw new Error(
        `The validation preset (${describeSource}) is a .mts file, loaded via Node's native TypeScript type `
        + `stripping — which failed here: ${typeStrippingFix()}, then re-run.`,
      );
    }
    if (/Cannot find package 'ztrack'|Cannot find module 'ztrack/.test(msg)) {
      throw new Error(
        `The validation preset (${describeSource}) imports 'ztrack/preset-kit', but the 'ztrack' package isn't resolvable from this project. `
        + `Install it as a dependency so the preset can load it:\n\n    npm install -D ztrack\n\n`
        + `(ztrack works like eslint — the preset is your config and imports the mechanism from the installed package; a global or one-off 'npx' install is not enough.)`,
      );
    }
    throw err;
  }
  const candidate = loaded.preset ?? loaded.default ?? loaded;
  return assertCorePreset(candidate, absolutePath);
}

async function loadValidationEntrypoint(entrypoint: string, projectRoot: string): Promise<Preset<CoreRoot>> {
  // SECURITY: loading the entrypoint executes it as Node code. Confine it to the
  // project so a config can't point the import at an arbitrary file on the host;
  // running `ztrack` on a repo still executes that repo's preset (see SECURITY.md).
  const root = resolve(projectRoot);
  const absolutePath = resolve(projectRoot, entrypoint);
  if (absolutePath !== root && !absolutePath.startsWith(root + sep)) {
    throw new Error(`Tracker validation entrypoint must live inside the project — '${entrypoint}' escapes ${root}.`);
  }
  if (!existsSync(absolutePath)) {
    throw new Error(`Configured tracker validation entrypoint does not exist: ${absolutePath}`);
  }
  return importPresetModule(absolutePath, entrypoint);
}

/** Load an operator-supplied validation preset (`ztrack check --preset <path>`) in place of
 *  the repo's configured entrypoint. Deliberately SKIPS the inside-project confinement above:
 *  that confinement guards against the REPO's config (untrusted input — e.g. a fork PR's
 *  tracker-config.json) naming an arbitrary host path to escape into. This function is reached
 *  only via an explicit CLI flag, which is the OPERATOR's own trust decision — the same origin
 *  as the `ztrack` invocation itself, exactly like `eslint -c <path>` naming a config outside
 *  the linted project. Still shape-asserted via `assertCorePreset` like every other route. */
async function loadOperatorPreset(presetPath: string): Promise<Preset<CoreRoot>> {
  const absolutePath = resolve(process.cwd(), presetPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`--preset path does not exist: ${absolutePath}`);
  }
  return importPresetModule(absolutePath, presetPath);
}

/** Resolve the active preset — a standalone core `Preset` exported by the repo-local
 *  `validation.entrypoint` (its own schema/parser/rules; see ARCHITECTURE.md §3), OR, when
 *  `presetPath` is given (operator `--preset <path>`, `check` only — see cliCheck.ts), that
 *  module instead. One pipeline; there is no separate snapshot runtime. This is the SINGLE
 *  resolution point shared by checkTracker/checkTrackerRoot/checkFile (check.ts) and
 *  exportTrackerRoot (export.ts) — no per-caller duplication. */
export async function resolveTrackerValidation(config: TrackerConfig, projectRoot = process.cwd(), presetPath?: string): Promise<Preset<CoreRoot>> {
  if (presetPath) return loadOperatorPreset(presetPath);
  const entrypoint = config.validation?.entrypoint?.trim();
  if (entrypoint) return loadValidationEntrypoint(entrypoint, projectRoot);
  return noTrackerValidation(config.organization?.validationPreset);
}

// ── ZTB-23 dev/01: write-time status validation ──────────────────────────────────────────────
// The active preset's issue `status` field is, in every shipped preset, a bare `z.enum([...])` —
// a closed, small vocabulary the SAME `check` pipeline enforces AFTER the fact (wellformed_shape).
// This reads that enum BEFORE a write, so `issue edit --state <typo>` fails at the point of the
// typo instead of silently succeeding and surfacing as an unrelated `wellformed_shape` finding
// later (real 0.38.0 bug this closes). Duck-typed zod introspection (`schema.shape.issues.element
// .shape.status.options`) rather than a new preset-authoring contract — no preset changes
// required, and a preset that shapes `status` as something other than a plain `z.enum` (e.g. a
// bare `z.string()`) simply has no enum to check here, which is intentionally indistinguishable
// from "no validation entrypoint configured": both mean "this write path stays permissive".
function issueStatusEnumOf(preset: Preset<CoreRoot>): string[] | null {
  try {
    const shape = (preset.schema as unknown as { shape?: Record<string, unknown> }).shape;
    const issuesField = shape?.issues as { element?: { shape?: Record<string, unknown> } } | undefined;
    const statusField = issuesField?.element?.shape?.status as { options?: unknown } | undefined;
    const options = statusField?.options;
    return Array.isArray(options) && options.length > 0 && options.every((o) => typeof o === 'string')
      ? (options as string[])
      : null;
  } catch {
    return null;
  }
}

/** The active preset's issue status vocabulary, for write-time validation — `null` means "no
 *  write-time check should engage" (config unreadable, no validation entrypoint configured, the
 *  entrypoint fails to load, or its schema exposes no plain-enum `status` field). Always resolves
 *  the REPO's configured entrypoint (never an operator `--preset` override — that flag is a
 *  `check`-only escape hatch, see loadOperatorPreset above); this never throws. */
export async function activeStatusEnum(projectRoot: string): Promise<string[] | null> {
  try {
    const config = loadTrackerConfig(projectRoot);
    const preset = await resolveTrackerValidation(config, projectRoot);
    return issueStatusEnumOf(preset);
  } catch {
    return null;
  }
}
