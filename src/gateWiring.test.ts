// ZTB-29 dev/03: unit coverage for `detectGateWiring`'s best-effort heuristic — direct function
// calls against real fixture files (no CLI spawn needed; the e2e arm-time WARN behavior itself is
// covered black-box in src/cliLoopUntil.e2e.test.ts, which spawns the real CLI with an overridden
// $HOME — that works because a FRESH process reads $HOME once at startup; this file exercises the
// same function in-process, so it uses the explicit `{ home }` override instead — Bun's
// `os.homedir()` does not observe a runtime-mutated `process.env.HOME`, only the OS user record).
// Covers every documented signal plus the "never crash on absent/unreadable/malformed" contract.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectGateWiring } from './gateWiring.ts';

let fakeHome = '';
let projectRoot = '';

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ztrk-gatewiring-home-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'ztrk-gatewiring-proj-'));
});
afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});
const detect = (root: string) => detectGateWiring(root, { home: fakeHome });

describe('detectGateWiring', () => {
  test('nothing anywhere -> not wired, no crash', () => {
    expect(detect(projectRoot).wired).toBe(false);
  });

  test('~/.claude/settings.json enabledPlugins["ztrack-gate@..."]: true -> wired', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ztrack-gate@ztrack': true } }));
    expect(detect(projectRoot).wired).toBe(true);
  });

  test('enabledPlugins["ztrack-gate@..."]: false -> NOT wired (explicitly disabled)', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ztrack-gate@ztrack': false } }));
    expect(detect(projectRoot).wired).toBe(false);
  });

  test('project .claude/settings.json with the plugin enabled -> wired', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ztrack-gate@some-marketplace': true } }));
    expect(detect(projectRoot).wired).toBe(true);
  });

  test('project .claude/settings.local.json with the plugin enabled -> wired', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'ztrack-gate@ztrack': true } }));
    expect(detect(projectRoot).wired).toBe(true);
  });

  test('manual hook wiring: both Stop and SubagentStop mention stop-loop.sh in ONE file -> wired', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'bash node_modules/ztrack/plugins/ztrack-gate/hooks/stop-loop.sh' }] }],
        SubagentStop: [{ hooks: [{ type: 'command', command: 'bash node_modules/ztrack/plugins/ztrack-gate/hooks/stop-loop.sh' }] }],
      },
    }));
    expect(detect(projectRoot).wired).toBe(true);
  });

  test('manual hook wiring SPLIT across scopes (Stop in user settings, SubagentStop in project settings) -> wired', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash .../stop-loop.sh' }] }] },
    }));
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
      hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'bash .../stop-loop.sh' }] }] },
    }));
    expect(detect(projectRoot).wired).toBe(true);
  });

  test('only Stop wired, SubagentStop missing entirely -> NOT wired', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash .../stop-loop.sh' }] }] },
    }));
    expect(detect(projectRoot).wired).toBe(false);
  });

  test('a Stop hook wired to something else entirely (not stop-loop.sh) -> NOT wired', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }],
        SubagentStop: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }],
      },
    }));
    expect(detect(projectRoot).wired).toBe(false);
  });

  test('~/.claude/plugins/installed_plugins.json records ztrack-gate -> wired even with no settings.json at all', () => {
    mkdirSync(join(fakeHome, '.claude', 'plugins'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'ztrack-gate@ztrack': [{ scope: 'user', installPath: '/x', version: '1.0.0' }] },
    }));
    expect(detect(projectRoot).wired).toBe(true);
  });

  test('malformed JSON in every file -> not wired, does not throw', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'settings.json'), '{ not json ][');
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), 'also not json');
    writeFileSync(join(projectRoot, '.claude', 'settings.local.json'), '');
    expect(() => detect(projectRoot)).not.toThrow();
    expect(detect(projectRoot).wired).toBe(false);
  });

  test('settings.json is a directory (unreadable as a file) -> not wired, does not throw', () => {
    mkdirSync(join(projectRoot, '.claude', 'settings.json'), { recursive: true }); // a dir, not a file
    expect(() => detect(projectRoot)).not.toThrow();
    expect(detect(projectRoot).wired).toBe(false);
  });

  test('a plugin key that only partially matches "ztrack-gate" is not confused for it', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'not-ztrack-gate@x': true, 'ztrack-gate-clone@x': false } }));
    // 'ztrack-gate-clone@x' does not match the anchored /^ztrack-gate@/ prefix.
    expect(detect(projectRoot).wired).toBe(false);
  });
});
