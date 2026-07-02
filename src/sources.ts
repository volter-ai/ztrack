// ZTB-3: turns the previously-hardwired "one markdown store" into a declared, addressable list.
// Resolution (config -> absolute, format-checked entries) lives here so both the config-load
// path (fail-closed on an unsupported format) and the backend (which actually reads/writes them)
// share one definition of "what a source is" and "which one is THE implicit default".
import { resolve } from 'node:path';
import { markdownStoreDir } from './config.ts';
import type { TrackerSourceConfig } from './types.ts';

export type SourceFormat = 'issue-per-file' | 'document';

/** `format` defaults from the shape of `path` when the config omits it: a `.md` FILE is a
 *  `document` source (many issues, one file — ZTB-4); anything else is a DIRECTORY of
 *  one-issue-per-file markdown (today's only implemented shape). */
export function inferSourceFormat(path: string): SourceFormat {
  return path.toLowerCase().endsWith('.md') ? 'document' : 'issue-per-file';
}

export interface ResolvedSource {
  /** Absolute path this source resolves to: a DIRECTORY of one-issue-per-file markdown for
   *  `issue-per-file`, or the single markdown FILE itself for `document` (ZTB-4). The field name
   *  stays `dir` for compatibility with existing callers, but for a `document` source it names a
   *  file, not a directory — `MarkdownBackend` dispatches on `format` to pick the right class
   *  (`MarkdownSource` vs `DocumentSource`, backends/documentSource.ts) rather than ever
   *  `mkdirSync`-ing it. */
  dir: string;
  format: SourceFormat;
  readonly: boolean;
  /** This source's resolved dir equals today's implicit `markdownStoreDir()` — it gets the
   *  worktree board-index/trunk union machinery (ZTB-3 makes that machinery user-addressable;
   *  it isn't new). At most one entry is ever the default; a `document` source (a FILE path) can
   *  never equal the default directory, so this is always false for one. */
  isDefault: boolean;
}

/** Resolve the declared `sources` list (or the implicit default when absent) into absolute
 *  entries. `sources` absent is BYTE-IDENTICAL to today: one implicit issue-per-file source at
 *  `markdownStoreDir(projectRoot)`. Both formats are implemented (issue-per-file always; the
 *  `document` read path since ZTB-4 — see backends/documentSource.ts; write-back is ZTB-4 dev/09). */
export function resolveSources(projectRoot: string, config: { sources?: TrackerSourceConfig[] }): ResolvedSource[] {
  const defaultDir = markdownStoreDir(projectRoot);
  if (!config.sources || config.sources.length === 0) {
    return [{ dir: defaultDir, format: 'issue-per-file', readonly: false, isDefault: true }];
  }
  return config.sources.map((entry) => {
    const format = entry.format ?? inferSourceFormat(entry.path);
    const dir = resolve(projectRoot, entry.path);
    return { dir, format, readonly: !!entry.readonly, isDefault: dir === defaultDir };
  });
}
