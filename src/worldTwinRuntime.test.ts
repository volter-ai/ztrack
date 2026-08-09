// ZTB-27 dev/01: `@volter/twin` is an OPTIONAL peer, and `ztrack/world-annotations` +
// `ztrack/world-source-books` are PUBLIC subpath exports — importing either one, and calling
// any function that touches the world, must surface MISSING_WORLD_TWIN_MESSAGE (never a raw
// MODULE_NOT_FOUND/resolution crash) when the peer isn't installed. `importTwinModule` is the
// injectable seam (mirrors src/sync/github/twinRuntime.test.ts): swapping it to a rejecting stub
// simulates "peer absent" without actually uninstalling it from this repo's devDependencies
// (which the repo's own tests/demos still need).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  __resetTwinWorldRuntimeCacheForTest, __setImportTwinModuleForTest, importTwinModule,
  loadTwinWorldRuntime, MISSING_WORLD_TWIN_MESSAGE,
} from './worldTwinRuntime.ts';
import { addAnnotation, createAnnotation, listAnnotations, validateServiceAnnotations } from './worldAnnotations.ts';
import { loadWorldSourceBooks } from './worldSourceBooks.ts';

const realImport = importTwinModule;
// The cache must be cleared BEFORE each test too, not just after: `bun test` runs every file
// in one process, and a world* file that ran earlier leaves the memoized runtime populated
// after its last test (their beforeEach resets guard only their own entries). An afterEach
// alone lets this file's FIRST test see that stale cache, where loadTwinWorldRuntime()
// short-circuits past the rejecting stub — observed on Linux CI only, where test-file
// ordering differs from macOS (run 28693392845).
beforeEach(() => { __resetTwinWorldRuntimeCacheForTest(); });
afterEach(() => {
  __setImportTwinModuleForTest(realImport);
  __resetTwinWorldRuntimeCacheForTest();
});

function unresolvable(): never {
  const err = new Error("Cannot find package '@volter/twin' imported from worldAnnotations.ts") as Error & { code?: string };
  err.code = 'ERR_MODULE_NOT_FOUND';
  throw err;
}

describe('loadTwinWorldRuntime — missing optional peer', () => {
  test('surfaces the install hint, not the raw module-not-found error', async () => {
    __setImportTwinModuleForTest(() => Promise.reject(new Error('simulated: peer not installed')));
    await expect(loadTwinWorldRuntime()).rejects.toThrow(MISSING_WORLD_TWIN_MESSAGE);
  });

  test('the install hint names the package and the fix', async () => {
    __setImportTwinModuleForTest(unresolvable);
    await expect(loadTwinWorldRuntime()).rejects.toThrow(/npm install -D @volter\/twin\b/);
  });
});

describe('world-annotations entry points — missing optional peer', () => {
  test('listAnnotations rejects with the install hint, not a resolution crash', async () => {
    __setImportTwinModuleForTest(unresolvable);
    await expect(listAnnotations('slack', '/does/not/matter')).rejects.toThrow(MISSING_WORLD_TWIN_MESSAGE);
  });

  test('addAnnotation rejects with the install hint', async () => {
    __setImportTwinModuleForTest(unresolvable);
    const annotation = createAnnotation({ id: 'a1', service: 'slack', eventId: 'e1', classification: 'source', annotator: 'agent' });
    await expect(addAnnotation(annotation, '/does/not/matter')).rejects.toThrow(MISSING_WORLD_TWIN_MESSAGE);
  });

  test('validateServiceAnnotations rejects with the install hint', async () => {
    __setImportTwinModuleForTest(unresolvable);
    await expect(validateServiceAnnotations('/does/not/matter', 'slack')).rejects.toThrow(MISSING_WORLD_TWIN_MESSAGE);
  });
});

describe('world-source-books entry point — missing optional peer', () => {
  test('loadWorldSourceBooks rejects with the install hint, not a resolution crash', async () => {
    __setImportTwinModuleForTest(unresolvable);
    await expect(loadWorldSourceBooks('/does/not/matter')).rejects.toThrow(MISSING_WORLD_TWIN_MESSAGE);
  });
});
