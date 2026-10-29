/** Source-bound board codec contract. No environment or process flag can change its default writer. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BOARD_DEFAULT_MODE } from './boardMode.ts';

const ARTIFACTS = [
  '../package.json',
  './boardProtocol.js', './boardMode.js', './boardDocument.js', './documentParser.js', './documentWriteBack.js', './markdownDocument.js',
  './legacyBoard/boardDocument.js', './legacyBoard/documentParser.js', './legacyBoard/documentWriteBack.js',
  './legacyBoard/markdownDocument.js', './legacyBoard/kanban.js',
  '../kanban-preset.cjs', '../preset-kit.cjs', '../../boilerplates/presets/kanban.ts',
] as const;

/** Hash the installed public artifacts, including the reader's local dependency closure. */
export function boardDocumentContract() {
  const artifacts = Object.fromEntries(ARTIFACTS.map((name) => {
    // package.json is at the package root; the other ../ paths are in dist/.
    const path = name === '../package.json' ? '../../package.json' : name;
    const bytes = readFileSync(new URL(path, import.meta.url));
    return [path, { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }];
  }));
  return {
    version: 1,
    readModes: ['legacy-holds', 'backlog-bounded-pause-v1'],
    defaultReader: BOARD_DEFAULT_MODE,
    writer: BOARD_DEFAULT_MODE,
    legacySource: 'be866b90b7b36ebf36ff998b510291a167a3ff2e',
    preservation: { option: { resting: 'preserve' }, mode: 'backlog-bounded-pause-v1', requiresCompatibleAdmission: true },
    artifacts,
  };
}
