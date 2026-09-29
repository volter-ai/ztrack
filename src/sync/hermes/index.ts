// The board-file sync provider: one board FILE (a `document` source in the kanban preset's
// grammar) kept in step with a kanban in Hermes's format through supercode's board door
// (`supercode workflow`). Standalone like the github provider (src/sync/github/index.ts): no
// shared sync engine.
import { loadTrackerConfig } from '../../config.ts';
import { resolveTrackerValidation } from '../../presetRegistry.ts';
import { boardExec, type BoardExec } from './board.ts';
import { syncHermes, type HermesSyncResult } from './sync.ts';
import { watchHermes } from './watch.ts';

export { syncHermes, toFileId, toBoardId, type HermesSyncOpts, type HermesSyncResult } from './sync.ts';
export { watchHermes, type HermesWatchOpts } from './watch.ts';
export { boardExec, readBoard, boardWriter, type BoardCard, type BoardExec, type BoardTarget } from './board.ts';

/** The project's board link, or null when it has none. */
export function linkedHermes(projectRoot: string) {
  try {
    const sync = loadTrackerConfig(projectRoot).sync;
    return sync?.provider === 'hermes' ? sync : null;
  } catch { return null; }
}

/** Sync the linked board file (config `sync: { provider: 'hermes', file, … }`). Null when the
 *  project has no board link. `exec` overrides the `supercode` CLI (tests). */
export async function syncLinkedHermes(projectRoot: string, o: { dryRun?: boolean; exec?: BoardExec } = {}): Promise<HermesSyncResult | null> {
  const link = linkedHermes(projectRoot);
  if (!link) return null;
  const config = loadTrackerConfig(projectRoot);
  const preset = await resolveTrackerValidation(config, projectRoot);
  return syncHermes({
    projectRoot,
    file: link.file,
    exec: o.exec ?? boardExec({ ...(link.home ? { home: link.home } : {}), ...(link.board ? { board: link.board } : {}), ...(link.bin ? { bin: link.bin } : {}) }),
    preset,
    ...(o.dryRun ? { dryRun: true } : {}),
  });
}

/** Sync the linked board file whenever it or its board changes, until the board's event stream
 *  ends (then rejects). Null when the project has no board link. */
export function watchLinkedHermes(projectRoot: string, o: { onSync: (why: string, r: HermesSyncResult | Error) => void }): Promise<never> | null {
  const link = linkedHermes(projectRoot);
  if (!link) return null;
  return watchHermes({
    projectRoot,
    link,
    sync: async () => (await syncLinkedHermes(projectRoot))!,
    onSync: o.onSync,
  });
}
