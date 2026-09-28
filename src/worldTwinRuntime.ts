// The world adapters (`worldAnnotations.ts`, `worldSourceBooks.ts`) read the mirrored world
// through `@volter/world-core`'s generic event surface. `@volter/world-core` is an OPTIONAL
// peer dependency (see package.json `peerDependenciesMeta`) — and `./world-annotations` +
// `./world-source-books` are PUBLIC subpath exports (package.json `exports`), so importing
// either subpath without the peer installed must not crash with a raw ESM resolution error.
// A static `import … from '@volter/world-core'` at the top of either module would fail to
// RESOLVE the moment the peer is absent, because ESM resolves the entire static import graph
// before any code runs — the same failure the sibling seam at src/sync/github/twinRuntime.ts
// exists for (read that file first; this mirrors its shape).
export type TwinWorldRuntime = {
  DELTA_TYPE_SUFFIX: typeof import('@volter/world-core').DELTA_TYPE_SUFFIX;
  listEvents: typeof import('@volter/world-core').listEvents;
  loadWorldConfig: typeof import('@volter/world-core').loadWorldConfig;
  worldStateRoot: typeof import('@volter/world-core').worldStateRoot;
};

export const MISSING_WORLD_TWIN_MESSAGE = 'ztrack world adapters (world-annotations / world-source-books) require the optional @volter/world-core package. Install it with: npm install -D @volter/world-core';

/** Injectable for tests that simulate the peer being unresolvable without actually
 *  uninstalling it (see worldTwinRuntime.test.ts). Production code never overrides this. */
export let importTwinModule = () => import('@volter/world-core');

export function __setImportTwinModuleForTest(fn: typeof importTwinModule): void {
  importTwinModule = fn;
}

let cached: TwinWorldRuntime | null = null;

/** Test-only: clears the memoized runtime so a test that simulates the peer being present or
 *  absent doesn't leak its result into an unrelated test (see worldTwinRuntime.test.ts). */
export function __resetTwinWorldRuntimeCacheForTest(): void {
  cached = null;
}

/** Load the twin world-event surface, memoized after the first successful call. Throws
 *  MISSING_WORLD_TWIN_MESSAGE (never a raw MODULE_NOT_FOUND) when the optional peer isn't
 *  installed. */
export async function loadTwinWorldRuntime(): Promise<TwinWorldRuntime> {
  if (cached) return cached;
  let twin: typeof import('@volter/world-core');
  try {
    twin = await importTwinModule();
  } catch {
    throw new Error(MISSING_WORLD_TWIN_MESSAGE);
  }
  cached = {
    DELTA_TYPE_SUFFIX: twin.DELTA_TYPE_SUFFIX,
    listEvents: twin.listEvents,
    loadWorldConfig: twin.loadWorldConfig,
    worldStateRoot: twin.worldStateRoot,
  };
  return cached;
}
