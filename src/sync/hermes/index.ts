// The Hermes kanban sync provider: one board FILE (a `document` source in the kanban preset's
// grammar) kept two-way in step with a Hermes kanban through `hermes kanban`. Standalone like the
// github provider (src/sync/github/index.ts) — no shared sync engine; conflicts land in the same
// provider-agnostic store (src/sync/conflicts.ts) that `ztrack check` gates on.
import { loadTrackerConfig } from '../../config.ts';
import { resolveTrackerValidation } from '../../presetRegistry.ts';
import { hermesExec, type HermesExec } from './board.ts';
import { syncHermes, type HermesPolicy, type HermesSyncResult } from './sync.ts';

export { syncHermes, toFileId, toHermesId, type HermesPolicy, type HermesSyncOpts, type HermesSyncResult } from './sync.ts';
export { hermesExec, readBoard, boardWriter, type HermesCard, type HermesExec, type HermesTarget } from './board.ts';

/** The project's Hermes link, or null when it has none. */
export function linkedHermes(projectRoot: string) {
  try {
    const sync = loadTrackerConfig(projectRoot).sync;
    return sync?.provider === 'hermes' ? sync : null;
  } catch { return null; }
}

/** Sync the linked board file (config `sync: { provider: 'hermes', file, … }`). Null when the
 *  project has no Hermes link. `exec` overrides the `hermes` CLI (tests). */
export async function syncLinkedHermes(projectRoot: string, o: { policy?: HermesPolicy; dryRun?: boolean; exec?: HermesExec } = {}): Promise<HermesSyncResult | null> {
  const link = linkedHermes(projectRoot);
  if (!link) return null;
  const config = loadTrackerConfig(projectRoot);
  const preset = await resolveTrackerValidation(config, projectRoot);
  return syncHermes({
    projectRoot,
    file: link.file,
    exec: o.exec ?? hermesExec({ ...(link.home ? { home: link.home } : {}), ...(link.board ? { board: link.board } : {}), ...(link.bin ? { bin: link.bin } : {}) }),
    preset,
    policy: o.policy ?? link.policy ?? 'merge',
    ...(link.comments !== undefined ? { comments: link.comments } : {}),
    ...(link.show ? { showCommand: link.show } : {}),
    ...(o.dryRun ? { dryRun: true } : {}),
  });
}
