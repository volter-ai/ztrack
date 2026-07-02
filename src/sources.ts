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
  /** Absolute path: a directory (the only implemented format is `issue-per-file`). */
  dir: string;
  format: SourceFormat;
  readonly: boolean;
  /** This source's resolved dir equals today's implicit `markdownStoreDir()` — it gets the
   *  worktree board-index/trunk union machinery (ZTB-3 makes that machinery user-addressable;
   *  it isn't new). At most one entry is ever the default. */
  isDefault: boolean;
}

/** Fail closed: `format: "document"` (declared or defaulted from a `.md` path) names the
 *  not-yet-landed dependency instead of silently being ignored or mis-read as a directory. */
function assertFormatSupported(entry: TrackerSourceConfig, index: number): SourceFormat {
  const format = entry.format ?? inferSourceFormat(entry.path);
  if (format === 'document') {
    throw new Error(
      `tracker config: sources[${index}] ("${entry.path}") is a "document" source (a single markdown file holding ` +
      `many issues), which ztrack does not yet implement — that lands in ZTB-4. Point "path" at a directory of ` +
      'one-issue-per-file markdown instead, or remove this source.',
    );
  }
  return format;
}

/** Resolve the declared `sources` list (or the implicit default when absent) into absolute,
 *  format-checked entries. `sources` absent is BYTE-IDENTICAL to today: one implicit
 *  issue-per-file source at `markdownStoreDir(projectRoot)`. */
export function resolveSources(projectRoot: string, config: { sources?: TrackerSourceConfig[] }): ResolvedSource[] {
  const defaultDir = markdownStoreDir(projectRoot);
  if (!config.sources || config.sources.length === 0) {
    return [{ dir: defaultDir, format: 'issue-per-file', readonly: false, isDefault: true }];
  }
  return config.sources.map((entry, index) => {
    const format = assertFormatSupported(entry, index);
    const dir = resolve(projectRoot, entry.path);
    return { dir, format, readonly: !!entry.readonly, isDefault: dir === defaultDir };
  });
}
