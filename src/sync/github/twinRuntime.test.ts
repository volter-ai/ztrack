// Issue #13: `@volter/twin`/`@volter/twin-github` became an OPTIONAL peer dep, so
// `ztrack sync github` must fail with a clear, actionable install hint (not a raw
// MODULE_NOT_FOUND) when they aren't installed — and every OTHER command must not even attempt to
// load them. `importTwinModules` is the injectable seam: swapping it to a rejecting stub
// simulates "peers absent" without actually uninstalling them from this repo's devDependencies
// (which the repo's own tests/demos still need).
import { afterEach, describe, expect, test } from 'bun:test';
import { __setImportTwinModulesForTest, importTwinModules, loadTwinRuntime, MISSING_TWIN_MESSAGE, NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE } from './twinRuntime.ts';
import { pull, push, reconcileSync, type SyncOpts } from './sync.ts';

const realImport = importTwinModules;
afterEach(() => { __setImportTwinModulesForTest(realImport); });

function unresolvable(): never {
  const err = new Error("Cannot find package '@volter/twin' imported from sync.ts") as Error & { code?: string };
  err.code = 'ERR_MODULE_NOT_FOUND';
  throw err;
}

// The exact failure mode Node hits when the peers ARE installed but twin-github ships only
// TypeScript source (no compiled JS) — verified for real against a live install in the manual
// lean-install verification; this simulates it here so the distinct message is unit-tested too.
function nodeCannotStripTypes(): never {
  const err = new Error("Stripping types is currently unsupported for files under node_modules, for \"file:///x/node_modules/@volter/twin-github/src/index.ts\"") as Error & { code?: string };
  err.code = 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING';
  throw err;
}

describe('loadTwinRuntime — missing optional peers', () => {
  test('surfaces the install hint, not the raw module-not-found error', async () => {
    __setImportTwinModulesForTest(() => Promise.reject(new Error('simulated: peers not installed')));
    await expect(loadTwinRuntime()).rejects.toThrow(MISSING_TWIN_MESSAGE);
  });

  test('the install hint names both packages and the fix', async () => {
    __setImportTwinModulesForTest(unresolvable);
    await expect(loadTwinRuntime()).rejects.toThrow(
      /npm install -D @volter\/twin @volter\/twin-github/,
    );
  });
});

describe('loadTwinRuntime — peers installed but unloadable under Node', () => {
  test('a Node type-stripping failure gets its own actionable message, not the install hint', async () => {
    __setImportTwinModulesForTest(nodeCannotStripTypes);
    await expect(loadTwinRuntime()).rejects.toThrow(NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE);
    // re-running `npm install` would NOT fix this one — must not tell the user to do that.
    await expect(loadTwinRuntime()).rejects.not.toThrow(/npm install/);
  });
});

describe('sync github entry points — missing optional peers', () => {
  const opts = (): SyncOpts => ({
    projectRoot: '/does/not/matter',
    owner: 'o',
    repo: 'r',
    execute: { request: async () => ({ status: 200, data: [] }) },
    client: {} as SyncOpts['client'],
    occurredAt: '2026-01-01T00:00:00Z',
  });

  test('pull() rejects with the install hint before touching the network or a project root', async () => {
    __setImportTwinModulesForTest(unresolvable);
    await expect(pull(opts())).rejects.toThrow(MISSING_TWIN_MESSAGE);
  });

  test('push() rejects with the install hint', async () => {
    __setImportTwinModulesForTest(unresolvable);
    await expect(push(opts())).rejects.toThrow(MISSING_TWIN_MESSAGE);
  });

  test('reconcileSync() rejects with the install hint', async () => {
    __setImportTwinModulesForTest(unresolvable);
    await expect(reconcileSync(opts())).rejects.toThrow(MISSING_TWIN_MESSAGE);
  });
});
