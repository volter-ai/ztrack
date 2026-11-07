// The twin packages (`@volter/world-core` + `@volter/twin-github`) are an OPTIONAL peer
// dependency (see package.json `peerDependenciesMeta`) — a plain `npm i -D @volter/ztrack` must not pull
// in their transitive tree. So sync.ts (the only runtime user of the twin outside this file) must
// never statically import them: a static `import … from '@volter/world-core'` at the top of any
// module reachable from cli.ts would fail to RESOLVE — and crash the whole CLI, not just `sync
// github` — the moment the peers are absent, because ESM resolves the entire static import graph
// before any code runs.
//
// This module is the one seam: dynamic `import()`, done lazily (only when a sync command actually
// runs), with a clear install hint if the peers aren't there. `dist/cli.js` is built with
// `--external` for both packages (scripts/build-node-cli.mjs) so this import() stays a real,
// unresolved-until-runtime module load in the published bundle instead of being inlined.
export type TwinRuntime = {
  twinResources: typeof import('@volter/world-core').twinResources;
  pendingActions: typeof import('@volter/world-core').pendingActions;
  readRoot: typeof import('@volter/world-core').readRoot;
  writeRoot: typeof import('@volter/world-core').writeRoot;
  performEntries: typeof import('@volter/world-core').performEntries;
  applyGithubWrite: typeof import('@volter/twin-github').applyGithubWrite;
  syncGithubFromRemote: typeof import('@volter/twin-github').syncGithubFromRemote;
};

export const MISSING_TWIN_MESSAGE = 'ztrack sync github requires the optional sync packages. Install them with: npm install -D @volter/world-core @volter/twin-github';

/** Injectable for tests that simulate the peers being unresolvable without actually uninstalling
 *  them (see twinRuntime.test.ts). Production code never overrides this. */
export let importTwinModules = () => Promise.all([
  import('@volter/world-core'),
  import('@volter/twin-github'),
] as const);

export function __setImportTwinModulesForTest(fn: typeof importTwinModules): void {
  importTwinModules = fn;
}

let cached: TwinRuntime | null = null;

/** Load the twin runtime, memoized after the first successful call. Throws MISSING_TWIN_MESSAGE
 *  (never a raw MODULE_NOT_FOUND) when the optional peers aren't installed. */
export async function loadTwinRuntime(): Promise<TwinRuntime> {
  if (cached) return cached;
  let core: typeof import('@volter/world-core');
  let github: typeof import('@volter/twin-github');
  try {
    [core, github] = await importTwinModules();
  } catch {
    throw new Error(MISSING_TWIN_MESSAGE);
  }
  cached = {
    twinResources: core.twinResources,
    pendingActions: core.pendingActions,
    readRoot: core.readRoot,
    writeRoot: core.writeRoot,
    performEntries: core.performEntries,
    applyGithubWrite: github.applyGithubWrite,
    syncGithubFromRemote: github.syncGithubFromRemote,
  };
  return cached;
}
