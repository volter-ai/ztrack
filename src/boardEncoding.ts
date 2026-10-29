/** The board encoding is selected by one reserved structural slot, never by its body text. */
export const BOARD_ENCODING_MARKER = '<!-- ztrack-board-body: escaped-headings-v1 -->';
export const BOARD_WRITE_MODE: 'ef4' | 'escaped-headings-v1' = 'ef4';
export type BoardEncoding = 'ef4' | 'escaped-headings-v1';
export type BoardEncodingSlot = { encoding: BoardEncoding; marker?: string; error?: string };

export function boardEncodingSlot(raw: string): BoardEncodingSlot {
  const lines = raw.split('\n');
  const slot = lines[1] ?? '';
  if (!/ztrack-board-body/i.test(slot)) return { encoding: 'ef4' };
  if (slot !== BOARD_ENCODING_MARKER) return { encoding: 'ef4', marker: slot, error: 'unknown or malformed board body encoding marker' };
  if (!/^status:\s*\S/.test(lines[2] ?? '')) return { encoding: 'ef4', marker: slot, error: 'board body encoding marker must precede the mandatory status line' };
  return { encoding: 'escaped-headings-v1', marker: slot };
}
