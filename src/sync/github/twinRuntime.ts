// The twin packages (`@volter-ai-dev/twin` + `@volter-ai-dev/twin-github`) are an OPTIONAL peer
// dependency (see package.json `peerDependenciesMeta`) — a plain `npm i -D ztrack` must not pull
// in their transitive tree (react/react-dom) or their stray `volter-twin`/`world-github` bins.
// So sync.ts (the only runtime user of twin outside this file) must never statically import them:
// a static `import … from '@volter-ai-dev/twin'` at the top of any module reachable from cli.ts
// would fail to RESOLVE — and crash the whole CLI, not just `sync github` — the moment the peers
// are absent, because ESM resolves the entire static import graph before any code runs.
//
// This module is the one seam: dynamic `import()`, done lazily (only when a sync command actually
// runs), with a clear install hint if the peers aren't there. `dist/cli.js` is built with
// `--external` for both packages (scripts/build-node-cli.mjs) so this import() stays a real,
// unresolved-until-runtime module load in the published bundle instead of being inlined.
export type TwinRuntime = {
  currentResources: typeof import('@volter-ai-dev/twin').currentResources;
  pendingActions: typeof import('@volter-ai-dev/twin').pendingActions;
  reconcile: typeof import('@volter-ai-dev/twin').reconcile;
  runConnectorPoll: typeof import('@volter-ai-dev/twin').runConnectorPoll;
  applyGithubWrite: typeof import('@volter-ai-dev/twin-github').applyGithubWrite;
  pushPendingGithubActions: typeof import('@volter-ai-dev/twin-github').pushPendingGithubActions;
};

export const MISSING_TWIN_MESSAGE = 'ztrack sync github requires the optional sync packages. Install them with: npm install -D @volter-ai-dev/twin @volter-ai-dev/twin-github';

// `@volter-ai-dev/twin-github` publishes ONLY TypeScript source (`"exports": {".": "./src/index.ts"}`,
// `engines.bun`) — it has no compiled JS entry point at all. Node (>=22.18, the "types" stripping
// default) refuses to type-strip a `.ts` file that lives under node_modules — a hardcoded platform
// restriction (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), not something a flag lifts. So even
// with the peer correctly `npm install`ed, a plain `node`/`npx ztrack` run can never load it — only
// a bun-run of the CLI can (bun is TS-native). Re-telling the user to `npm install` again in that
// case would be actively wrong (they already did, and it won't help), so this is surfaced as its
// own actionable message instead of being folded into MISSING_TWIN_MESSAGE.
export const NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE = "ztrack sync github: @volter-ai-dev/twin-github ships TypeScript source with no Node-compatible build, and this Node runtime cannot load .ts files from node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Run the command under bun instead, e.g.: bunx ztrack sync github ...";

function isNodeTypeStrippingError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /Stripping types is currently unsupported for files under node_modules/.test(message);
}

/** Injectable for tests that simulate the peers being unresolvable without actually uninstalling
 *  them (see twinRuntime.test.ts). Production code never overrides this. */
export let importTwinModules = () => Promise.all([
  import('@volter-ai-dev/twin'),
  import('@volter-ai-dev/twin-github'),
] as const);

export function __setImportTwinModulesForTest(fn: typeof importTwinModules): void {
  importTwinModules = fn;
}

let cached: TwinRuntime | null = null;

/** Load the twin runtime, memoized after the first successful call. Throws MISSING_TWIN_MESSAGE
 *  (never a raw MODULE_NOT_FOUND) when the optional peers aren't installed, or
 *  NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE when they ARE installed but this JS runtime can't load
 *  twin-github's TypeScript-only package (see above — install won't fix that one; bun will). */
export async function loadTwinRuntime(): Promise<TwinRuntime> {
  if (cached) return cached;
  let twin: typeof import('@volter-ai-dev/twin');
  let twinGithub: typeof import('@volter-ai-dev/twin-github');
  try {
    [twin, twinGithub] = await importTwinModules();
  } catch (err) {
    if (isNodeTypeStrippingError(err)) throw new Error(NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE);
    throw new Error(MISSING_TWIN_MESSAGE);
  }
  cached = {
    currentResources: twin.currentResources,
    pendingActions: twin.pendingActions,
    reconcile: twin.reconcile,
    runConnectorPoll: twin.runConnectorPoll,
    applyGithubWrite: twinGithub.applyGithubWrite,
    pushPendingGithubActions: twinGithub.pushPendingGithubActions,
  };
  return cached;
}
