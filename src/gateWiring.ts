// ZTB-29 dev/03 — best-effort detection of whether the ztrack plugin's Stop/SubagentStop hooks can
// actually fire for a loop this process is about to arm. `ztrack loop start` cannot see every
// harness that might wire the hooks itself (a different agent runtime, hand-rolled tooling), so
// this is a HEADS-UP, never a refusal: a negative result WARNS at arm time (README install
// pointer) and the loop still arms. False negatives (an unseen harness) are expected and fine;
// false positives are avoided by only matching the concrete shapes Claude Code itself writes.
//
// Signals checked (any one is enough to call it "wired"), each read defensively — absent,
// unreadable, or malformed JSON is silently treated as "no signal here", never a crash:
//   1. ~/.claude/settings.json                  — user-scope settings
//   2. <project>/.claude/settings.json          — project-scope settings (checked in)
//   3. <project>/.claude/settings.local.json    — project-scope settings (gitignored)
//   4. ~/.claude/plugins/installed_plugins.json — the plugin install manifest Claude Code writes
//
// From (1)-(3): either `enabledPlugins["ztrack@<marketplace>"]` is present and not explicitly
// `false`, or the `hooks.Stop`/`hooks.SubagentStop` arrays mention `stop-loop.sh` in a command —
// covering both the plugin install route and the manual-wiring route the Guide documents. Stop
// and SubagentStop can be split across scopes (Claude Code merges settings across files), so
// "wired" only requires EACH event to appear in at least one of the readable files, not both in
// the same one.
// From (4): a `ztrack@...` key recorded as installed, regardless of enabledPlugins — belt
// and suspenders for a plugin installed but whose enabledPlugins entry is missing or stale.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOOK_NEEDLE = 'stop-loop.sh';
// `ztrack-gate` is the plugin's pre-rename name (≤ plugin 0.2.0): an install made from the old
// marketplace entry keeps that key in settings/manifests and its hooks keep firing, so it must
// keep counting as wired — dropping it would false-warn every existing install after an upgrade.
const PLUGIN_KEY = /^(ztrack|ztrack-gate)@/;

function readJsonSafe(path: string): unknown {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pluginEnabled(settings: unknown): boolean {
  const enabled = asRecord(asRecord(settings)?.enabledPlugins);
  if (!enabled) return false;
  return Object.entries(enabled).some(([key, val]) => PLUGIN_KEY.test(key) && val !== false);
}

function hookMentionsScript(settings: unknown, event: 'Stop' | 'SubagentStop'): boolean {
  const hooks = asRecord(asRecord(settings)?.hooks);
  const groups = hooks?.[event];
  if (!Array.isArray(groups)) return false;
  for (const group of groups) {
    const inner = asRecord(group)?.hooks;
    if (!Array.isArray(inner)) continue;
    for (const h of inner) {
      const cmd = asRecord(h)?.command;
      if (typeof cmd === 'string' && cmd.includes(HOOK_NEEDLE)) return true;
    }
  }
  return false;
}

function manifestHasPlugin(manifest: unknown): boolean {
  const plugins = asRecord(asRecord(manifest)?.plugins);
  if (!plugins) return false;
  return Object.keys(plugins).some((k) => PLUGIN_KEY.test(k));
}

export interface GateWiringResult {
  wired: boolean;
  signals: string[]; // human-readable trail of what matched, for debugging; not shown by default
}

/** Best-effort: can the ztrack plugin's Stop/SubagentStop hooks actually fire for a loop armed in
 *  `projectRoot` right now? Never throws — every read is defensive (see file header). A `false`
 *  result is NOT proof the gate is absent (another harness may wire it invisibly to this check),
 *  so callers must WARN, never refuse, on a negative result (ZTB-29 dev/03).
 *
 *  Reads real `~/.claude` paths via `os.homedir()` by default. `opts.home` overrides that root —
 *  used by tests to point at a fixture home directory; Bun's `os.homedir()` reads the OS user
 *  record directly and does not observe a runtime-mutated `process.env.HOME` (unlike Node), so an
 *  explicit override is the only deterministic way to unit-test this without spawning a
 *  subprocess. Production call sites never pass it. */
export function detectGateWiring(projectRoot: string, opts: { home?: string } = {}): GateWiringResult {
  try {
    const home = opts.home ?? homedir();
    const settingsPaths = [
      join(home, '.claude', 'settings.json'),
      join(projectRoot, '.claude', 'settings.json'),
      join(projectRoot, '.claude', 'settings.local.json'),
    ];
    const signals: string[] = [];
    let stopWired = false;
    let subagentStopWired = false;
    let pluginSeen = false;
    for (const path of settingsPaths) {
      const data = readJsonSafe(path);
      if (data === null) continue;
      if (pluginEnabled(data)) { pluginSeen = true; signals.push(`ztrack plugin enabled in ${path}`); }
      if (hookMentionsScript(data, 'Stop')) { stopWired = true; signals.push(`Stop hook wired in ${path}`); }
      if (hookMentionsScript(data, 'SubagentStop')) { subagentStopWired = true; signals.push(`SubagentStop hook wired in ${path}`); }
    }
    const manifestPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
    const manifest = readJsonSafe(manifestPath);
    if (manifest !== null && manifestHasPlugin(manifest)) {
      pluginSeen = true;
      signals.push(`ztrack plugin recorded installed in ${manifestPath}`);
    }
    return { wired: pluginSeen || (stopWired && subagentStopWired), signals };
  } catch {
    return { wired: false, signals: [] };
  }
}
