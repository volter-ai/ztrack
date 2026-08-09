// The world adapters (`worldAnnotations.ts`, `worldSourceBooks.ts`) read the mirrored world
// through `@volter/twin`'s generic event surface. `@volter/twin` is an OPTIONAL
// peer dependency (see package.json `peerDependenciesMeta`) — and `./world-annotations` +
// `./world-source-books` are PUBLIC subpath exports (package.json `exports`), so importing
// either subpath without the peer installed must not crash with a raw ESM resolution error.
// A static `import … from '@volter/twin'` at the top of either module would fail to
// RESOLVE the moment the peer is absent, because ESM resolves the entire static import graph
// before any code runs — the exact failure #13 fixed for `ztrack sync github` via the sibling
// seam at src/sync/github/twinRuntime.ts (read that file first; this mirrors its shape).
//
// Unlike `@volter/twin-github`, `@volter/twin` ships a compiled JS build
// (`"exports": {".": {"default": "./dist/src/index.js"}}`, verified against the installed
// package) — so once the peer is installed, node loads it natively. There is no Node
// type-stripping failure mode to special-case here (unlike twinRuntime.ts's
// NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE) — only "peer not installed" is a real, distinct case
// for this loader, so only one message constant exists below.
export type TwinWorldRuntime = {
  DELTA_TYPE_SUFFIX: typeof import('@volter/twin').DELTA_TYPE_SUFFIX;
  isEgressEventType: typeof import('@volter/twin').isEgressEventType;
  listEvents: typeof import('@volter/twin').listEvents;
  loadWorldConfig: typeof import('@volter/twin').loadWorldConfig;
  worldStateRoot: typeof import('@volter/twin').worldStateRoot;
};

export const MISSING_WORLD_TWIN_MESSAGE = 'ztrack world adapters (world-annotations / world-source-books) require the optional @volter/twin package. Install it with: npm install -D @volter/twin';

/** Injectable for tests that simulate the peer being unresolvable without actually
 *  uninstalling it (see worldTwinRuntime.test.ts). Production code never overrides this. */
export let importTwinModule = () => import('@volter/twin');

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
  let twin: typeof import('@volter/twin');
  try {
    twin = await importTwinModule();
  } catch {
    throw new Error(MISSING_WORLD_TWIN_MESSAGE);
  }
  cached = {
    DELTA_TYPE_SUFFIX: twin.DELTA_TYPE_SUFFIX,
    isEgressEventType: twin.isEgressEventType,
    listEvents: twin.listEvents,
    loadWorldConfig: twin.loadWorldConfig,
    worldStateRoot: twin.worldStateRoot,
  };
  return cached;
}
