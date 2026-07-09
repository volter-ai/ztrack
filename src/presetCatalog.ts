// The preset catalog: discover presets (boilerplates/presets/<name>.ts + <name>.json sidecars),
// resolve --preset input, install the editable preset.mts, and 3-way upgrade an edited one. Split
// out of config.ts so the config module stays focused on path resolution + config load/policy.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureTrackerGitignore, loadTrackerConfig, projectRootFrom, stateDirName, trackerConfigPath } from "./config.ts";
import type { TrackerConfig } from "./types.ts";

// ── Preset catalog ───────────────────────────────────────────────────────────────────
// Presets are discovered by SCANNING the shipped boilerplates dir — nothing here enumerates
// the set, so it scales to many presets. Each preset is two co-located files:
//   boilerplates/presets/<name>.ts    the editable standalone preset (schema/parser/rules)
//   boilerplates/presets/<name>.json  its manifest: { description, aliases?, recommended? }
// Adding a preset = drop those two files. `presetManifest.test.ts` guards them in sync.
export interface PresetManifestEntry {
  /** Canonical `--preset` name = the boilerplate filename. */
  name: string;
  /** One-line summary shown by `ztrack init --list`. */
  description: string;
  /** Alternate `--preset` inputs that resolve to this preset (e.g. `default`). */
  aliases?: string[];
  /** The recommended baseline — what `ztrack init` (no `--preset`) installs. Exactly one. */
  recommended?: boolean;
}

const PRESETS_DIR = fileURLToPath(new URL('../boilerplates/presets', import.meta.url));

let manifestCache: PresetManifestEntry[] | undefined;
/** The full preset catalog, read from the per-preset `<name>.json` sidecars. */
export function presetManifest(): PresetManifestEntry[] {
  if (manifestCache) return manifestCache;
  const names = readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => f.slice(0, -'.ts'.length))
    .sort();
  manifestCache = names.map((name) => {
    const sidecar = join(PRESETS_DIR, `${name}.json`);
    const meta = existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, 'utf8')) as Partial<PresetManifestEntry> : {};
    return {
      name,
      description: meta.description ?? '',
      ...(meta.aliases?.length ? { aliases: meta.aliases } : {}),
      ...(meta.recommended ? { recommended: true } : {}),
    };
  });
  return manifestCache;
}

/** The baseline preset `ztrack init` installs with no `--preset`. */
export function recommendedPreset(): string {
  const m = presetManifest();
  return (m.find((p) => p.recommended) ?? m[0]!).name;
}

/** Every accepted `--preset` input: canonical names plus their aliases. */
export function initTrackerPresets(): readonly string[] {
  const m = presetManifest();
  return [...m.map((p) => p.name), ...m.flatMap((p) => p.aliases ?? [])];
}

// Resolve an accepted preset input (name or alias) to its boilerplate file name.
export function resolvePresetName(preset: string): string {
  const m = presetManifest();
  if (m.some((p) => p.name === preset)) return preset;
  const aliased = m.find((p) => p.aliases?.includes(preset));
  if (aliased) return aliased.name;
  throw new Error(`Unknown preset '${preset}'. Run \`ztrack init --list\` to see available presets.`);
}

export type InitTrackerProjectOptions = {
  preset?: string;
  /** Permanently link an external tracker (e.g. { provider: 'github', repo: 'o/n' }). */
  sync?: { provider: 'github'; repo: string; policy?: 'hub-wins' | 'twin-wins' | 'merge' };
  /** `shared`: a central, cross-worktree board (for multi-worktree/agent fleets). Default `branch`
   *  (committed, branch-scoped). See TrackerConfig.board. */
  board?: 'branch' | 'shared';
};

// The standalone preset's editable source, shipped at `boilerplates/presets/<preset>.ts`.
// `ztrack init` copies it verbatim — it is REAL code (its OWN schema/parser/rules),
// importing only `ztrack/preset-kit`. No template substitution, no flags.
function presetTemplate(preset: string): string {
  return readFileSync(join(PRESETS_DIR, `${resolvePresetName(preset)}.ts`), 'utf8');
}

export function trackerValidationEntrypointPath(projectRoot: string): string {
  // `.mts` (not `.ts`): unambiguously ESM, so Node type-strips + loads it as a module even
  // when the consuming project's package.json has no `"type": "module"`.
  return join(projectRoot, stateDirName(), 'tracker', 'validation', 'preset.mts');
}

// The pristine copy of the installed preset, recorded at init so `ztrack preset upgrade`
// can 3-way merge new upstream rules into an edited preset without clobbering edits.
// Committed (not gitignored) so the merge base is reproducible.
export function trackerValidationBasePath(projectRoot: string): string {
  return join(projectRoot, stateDirName(), 'tracker', 'validation', '.preset.base.mts');
}

function installPreset(projectRoot: string, preset: string): string {
  const entrypoint = trackerValidationEntrypointPath(projectRoot);
  mkdirSync(dirname(entrypoint), { recursive: true });
  const source = presetTemplate(preset);
  if (!existsSync(entrypoint)) writeFileSync(entrypoint, source);
  // record the pristine base for `ztrack preset upgrade`'s 3-way merge.
  const basePath = trackerValidationBasePath(projectRoot);
  if (!existsSync(basePath)) writeFileSync(basePath, source);
  return entrypoint;
}

// ── VIZ-15: the repo-owned dashboard extension (VIZ-13's `<stateDir>/tracker/visualizer/
// extension.tsx`), installed by default exactly like the preset above — presets are
// installed-by-default, so this code seam is too, rather than an opt-in scaffold command.
export function trackerVisualizerExtensionPath(projectRoot: string): string {
  return join(projectRoot, stateDirName(), 'tracker', 'visualizer', 'extension.tsx');
}

// The pristine copy, recorded at install time so `ztrack preset upgrade` can 3-way merge new
// starter revisions into an edited extension without clobbering edits — same convention as
// `trackerValidationBasePath` above. Committed (not gitignored) so the merge base is reproducible.
export function trackerVisualizerExtensionBasePath(projectRoot: string): string {
  return join(projectRoot, stateDirName(), 'tracker', 'visualizer', '.extension.base.tsx');
}

// The starter extension: a genuine no-op. `defineVisualizerExtension({})` has no members for
// `registerExtension` to merge in (visualizerKit.ts's `VisualizerExtension` — every member
// optional), so a fresh board renders IDENTICALLY to having no extension.tsx at all. It exists
// purely so every repo has the seam ready to edit — REAL code (no template substitution),
// importing only `ztrack/visualizer-kit`, mirroring `presetTemplate`'s own convention.
const STARTER_EXTENSION_TEMPLATE = `// Your repo-owned dashboard extension (see docs/VISUALIZER.md). It compiles into the served
// board automatically — no config, no restart. Every member below is optional; this file ships
// as a no-op, so the stock board is what you get until you fill one in.
//
// import { defineVisualizerExtension } from 'ztrack/visualizer-kit';
//
// export default defineVisualizerExtension({
//   issuePanels: (issue) => <section className="panel">...</section>,
//   acText: (ac) => ac.id,
// });

import { defineVisualizerExtension } from 'ztrack/visualizer-kit';

export default defineVisualizerExtension({});
`;

// Mirrors `installPreset`'s existsSync guard: never clobber a present file. Called both by a
// fresh `initTrackerProject` and by `ztrack preset upgrade` seeding a pre-existing repo that
// predates this feature (both files absent).
function installExtension(projectRoot: string): string {
  const path = trackerVisualizerExtensionPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, STARTER_EXTENSION_TEMPLATE);
  const basePath = trackerVisualizerExtensionBasePath(projectRoot);
  if (!existsSync(basePath)) writeFileSync(basePath, STARTER_EXTENSION_TEMPLATE);
  return path;
}

export interface UpgradePresetResult {
  status: 'updated' | 'up-to-date' | 'conflicts' | 'no-base';
  entrypoint: string;
  installedFrom: string;
  conflicts: number;
  /** VIZ-15: the repo-owned dashboard extension upgrades in lockstep, as its own artifact. */
  extension: ExtensionUpgradeResult;
}

// 3-way merge: apply the diff `base` -> `theirs` (new upstream) onto `ours` (the edited
// file), via `git merge-file`. Returns the merged text and conflict count (0 = clean).
function threeWayMerge(ours: string, base: string, theirs: string): { text: string; conflicts: number } {
  const dir = mkdtempSync(join(tmpdir(), 'ztrack-preset-merge-'));
  try {
    const o = join(dir, 'ours'); const b = join(dir, 'base'); const t = join(dir, 'theirs');
    writeFileSync(o, ours); writeFileSync(b, base); writeFileSync(t, theirs);
    const r = spawnSync('git', ['merge-file', '-p', '-L', 'your edits', '-L', 'installed base', '-L', 'new upstream', o, b, t], { encoding: 'utf8' });
    if (r.error) throw new Error(`git merge-file unavailable: ${r.error.message}`);
    const status = r.status ?? 0;
    if (status < 0) throw new Error(`git merge-file failed: ${r.stderr || 'unknown error'}`);
    return { text: r.stdout, conflicts: status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface ExtensionUpgradeResult {
  status: 'seeded' | 'up-to-date' | 'conflicts' | 'updated' | 'no-base' | 'skipped';
  path: string;
  basePath: string;
  conflicts: number;
}

// Upgrades the extension artifact in lockstep with the preset (called from
// `upgradeTrackerPreset` below), REUSING `threeWayMerge` above — ONE merge implementation
// serving both artifacts, never forked. One-of-file cases are never silent:
//   - neither file exists: a pre-existing repo obtaining the seam by command (mirrors the
//     preset's own no-base re-seed convention, below) — seed both, report 'seeded'.
//   - extension present, base missing: never silently adopt the current file as pristine —
//     report 'no-base' (mirroring the preset's own no-base status) naming the re-seed path.
//   - extension absent, base present: the user deleted it on purpose — report 'skipped', never
//     silently reinstall over an intentional deletion.
function upgradeExtension(projectRoot: string): ExtensionUpgradeResult {
  const path = trackerVisualizerExtensionPath(projectRoot);
  const basePath = trackerVisualizerExtensionBasePath(projectRoot);
  const extensionExists = existsSync(path);
  const baseExists = existsSync(basePath);
  if (!extensionExists && !baseExists) {
    installExtension(projectRoot);
    return { status: 'seeded', path, basePath, conflicts: 0 };
  }
  if (extensionExists && !baseExists) return { status: 'no-base', path, basePath, conflicts: 0 };
  if (!extensionExists && baseExists) return { status: 'skipped', path, basePath, conflicts: 0 };
  const base = readFileSync(basePath, 'utf8');
  if (base === STARTER_EXTENSION_TEMPLATE) return { status: 'up-to-date', path, basePath, conflicts: 0 };
  const ours = readFileSync(path, 'utf8');
  const merged = threeWayMerge(ours, base, STARTER_EXTENSION_TEMPLATE);
  writeFileSync(path, merged.text);
  writeFileSync(basePath, STARTER_EXTENSION_TEMPLATE);
  return { status: merged.conflicts > 0 ? 'conflicts' : 'updated', path, basePath, conflicts: merged.conflicts };
}

/**
 * Upgrade the repo-local preset: 3-way merge the current bundled template (for the
 * variant this repo installed) into the edited preset.ts, preserving local edits.
 * Conflicts are written as `<<<<<<<` markers for a human/agent to resolve. The pristine
 * base advances to the new upstream on a clean OR conflicted merge.
 *
 * VIZ-15: also upgrades the repo-owned dashboard extension.tsx (installed alongside the preset)
 * the same way — an independent artifact with its own status, reported under `.extension`.
 */
export function upgradeTrackerPreset(projectRoot: string): UpgradePresetResult {
  const config = loadTrackerConfig(projectRoot);
  const installedFrom = config.validation?.installedFrom;
  const entrypoint = trackerValidationEntrypointPath(projectRoot);
  if (!installedFrom || !initTrackerPresets().includes(installedFrom) || !existsSync(entrypoint)) {
    throw new Error("No bundled preset to upgrade from. `ztrack preset upgrade` only applies to a repo init'd with `ztrack init --preset <name>`.");
  }
  // Legacy compat: a repo recorded as `default` predates the alias and meant the old PR-based preset,
  // which is now simple-gh-sdlc — upgrade it against that, not the new lean simple-sdlc baseline.
  const variant: string = installedFrom === 'default' ? 'simple-gh-sdlc' : installedFrom;
  const extension = upgradeExtension(projectRoot); // independent of the preset's own status below
  const basePath = trackerValidationBasePath(projectRoot);
  if (!existsSync(basePath)) return { status: 'no-base', entrypoint, installedFrom: variant, conflicts: 0, extension };
  const base = readFileSync(basePath, 'utf8');
  const upstream = presetTemplate(variant);
  if (base === upstream) return { status: 'up-to-date', entrypoint, installedFrom: variant, conflicts: 0, extension };
  const ours = readFileSync(entrypoint, 'utf8');
  const merged = threeWayMerge(ours, base, upstream);
  writeFileSync(entrypoint, merged.text);
  writeFileSync(basePath, upstream);
  return { status: merged.conflicts > 0 ? 'conflicts' : 'updated', entrypoint, installedFrom: variant, conflicts: merged.conflicts, extension };
}

/**
 * Initialize a tracker project: write the local backend config, install a
 * repo-local validation preset, and add a managed .gitignore block. Idempotent and
 * shared by `ztrack init` and the tracker_init MCP tool so an MCP-only agent
 * can bootstrap a fresh repo without the CLI.
 */
export function initTrackerProject(
  root: string,
  teamKey = 'LOCAL',
  options: InitTrackerProjectOptions = {},
): { configPath: string; alreadyInitialized: boolean; teamKey: string; preset: string; validationEntrypoint?: string; visualizerExtensionPath?: string } {
  const configPath = trackerConfigPath(root);
  // Resolve an alias (e.g. `default`) up front so the canonical name is what we install + record.
  const preset = resolvePresetName(options.preset ?? recommendedPreset());
  if (existsSync(configPath)) return { configPath, alreadyInitialized: true, teamKey, preset };
  const key = teamKey.toUpperCase();
  mkdirSync(dirname(configPath), { recursive: true });
  const validationEntrypoint = installPreset(root, preset);
  // VIZ-15: install the starter dashboard extension alongside the preset — presets are
  // installed-by-default, so this code seam is too, rather than an opt-in scaffold command.
  const visualizerExtensionPath = installExtension(root);
  const config: TrackerConfig = {
    backend: 'markdown',
    local: { teamKey: key },
    validation: {
      entrypoint: `${stateDirName()}/tracker/validation/preset.mts`,
      installedFrom: preset,
    },
    // ZTB-19 (ZL-E4): this used to write `organization.check.categories`, but nothing reads that
    // config path — `ztrack check --categories` only ever reads its own CLI flag (cliCheck.ts),
    // never this block, and no shipped preset assigns any rule a category (all three declare
    // `category: false`) for it to select among anyway. Writing it at init made every fresh
    // project carry config that looked load-bearing but did nothing. The engine's per-rule
    // category/depth machinery (Context.categories, core/engine.ts) is untouched — a preset
    // author who DOES declare categories still gets `--categories` filtering; init just stops
    // writing this particular dead block.
    ...(options.sync ? { sync: options.sync } : {}),
    // Record the board scope explicitly (default 'shared' — a central, cross-worktree board); linked
    // trackers ignore it (they already have one central store), so only record it for an unlinked tracker.
    ...(options.sync ? {} : { board: options.board ?? 'shared' }),
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  ensureTrackerGitignore(root);
  return {
    configPath, alreadyInitialized: false, teamKey: key, preset,
    ...(validationEntrypoint ? { validationEntrypoint } : {}),
    ...(visualizerExtensionPath ? { visualizerExtensionPath } : {}),
  };
}

/** Idempotently ensure ztrack's managed `.gitignore` patterns are present. On a fresh repo
 *  it writes the whole block; on a repo whose block predates a new pattern (e.g. the loop
 *  runtime files added later) it appends only the missing lines — so the loop's session
 *  state never leaks into a commit on a repo that was `init`'d before the loop existed.
 *  Called by `init` and by `ztrack loop start` (the point where loop-state files appear). */
