/** This source constant is the writer boundary. It is never selected from process state. */
export type BoardDocumentMode = 'legacy-holds' | 'backlog-bounded-pause-v1';
export const BOARD_DEFAULT_MODE: BoardDocumentMode = 'legacy-holds';
export type BoardCodecOptions = { resting?: 'legacy' | 'preserve' };

export function preservesRestingState(options: BoardCodecOptions): boolean {
  if (options.resting === 'preserve') return true;
  if (options.resting === 'legacy') return false;
  if (options.resting !== undefined) throw new Error('unknown board resting-state codec mode');
  return BOARD_DEFAULT_MODE === 'backlog-bounded-pause-v1';
}
