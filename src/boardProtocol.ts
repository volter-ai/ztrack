/** The exact shipped board reader/protocol closure. Missing artifacts fail closed. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { boardDocumentProtocol } from './boardDocument.ts';

const artifacts = [
  { export: './board-document', path: 'dist/board-document.cjs' },
  { export: './kanban-preset', path: 'dist/kanban-preset.cjs' },
  { export: './preset-kit', path: 'dist/preset-kit.cjs' },
  { export: './board-protocol', path: 'dist/src/boardProtocol.js' },
] as const;

export function boardDocumentContract(): { version: 1; protocol: typeof boardDocumentProtocol; artifacts: Array<{ export: string; path: string; sha256: string }> } {
  const root = new URL('../../', import.meta.url);
  const reader = createRequire(import.meta.url)('../board-document.cjs') as { boardDocumentProtocol: typeof boardDocumentProtocol };
  return { version: 1, protocol: reader.boardDocumentProtocol, artifacts: artifacts.map((entry) => ({ ...entry,
    sha256: createHash('sha256').update(readFileSync(fileURLToPath(new URL(entry.path, root)))).digest('hex'),
  })) };
}
