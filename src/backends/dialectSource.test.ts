// DialectSource (docs/DIALECTS.md): the read-only lens over a file in its own idiom. Proven
// here at the IssueSource level against the emoji-register conformance fixture; the CLI-level
// walk (list/check on a registered lens) lives in the dialects e2e.
import { describe, expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIALECTS } from '../dialects.ts';
import { DialectSource } from './dialectSource.ts';

function lens(): { source: DialectSource; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'ztrk-lens-'));
  const file = join(root, 'PLAN.md');
  copyFileSync(join(import.meta.dir, '..', 'dialects.fixtures', 'emoji-register.md'), file);
  const source = new DialectSource({
    dialect: DIALECTS['emoji-register']!, dialectName: 'emoji-register',
    dir: file, format: 'document', isDefault: false, name: 'PLAN.md', readonly: true,
  });
  return { root, source };
}

describe('DialectSource', () => {
  test('serves the file\'s issues as canonical records with true statuses and spans', () => {
    const { root, source } = lens();
    try {
      expect(source.ids()).toEqual(['KQ1', 'KQ2', 'KQ3', 'KQ4']);
      const kq3 = source.load('KQ3')!;
      expect(kq3.title).toBe('Does the 8GB min-spec actually work?');
      expect(kq3.state).toBe('done');
      expect(kq3.stateType).toBe('completed'); // stateTypeOf: preset rules gate on this
      expect(source.load('KQ2')!.state).toBe('ready');
      const origin = source.origin('KQ3');
      expect(origin.path.endsWith('PLAN.md')).toBe(true);
      expect(origin.lineStart).toBeGreaterThan(0);
      expect(source.statusExplicit('KQ3')).toBe(true);
      expect(source.statusExplicit('KQ4')).toBe(false); // the ⚫ nobody declared → defaulted draft
      expect(source.diagnostics()).toEqual([expect.objectContaining({ id: 'KQ4', kind: 'status_unrecognized' })]);
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  test('every write path fails closed with the materialize pointer; readonly by construction', () => {
    const { root, source } = lens();
    try {
      expect(source.readonlySource).toBe(true);
      expect(() => source.write()).toThrow(/read-only dialect lens.*ztrack import/);
      expect(() => source.delete()).toThrow(/read-only dialect lens/);
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  test('a missing file is an empty lens, not a crash', () => {
    const source = new DialectSource({
      dialect: DIALECTS['emoji-register']!, dialectName: 'emoji-register',
      dir: join(tmpdir(), 'ztrk-lens-none', 'ghost.md'), format: 'document', isDefault: false, name: 'ghost', readonly: true,
    });
    expect(source.ids()).toEqual([]);
  });
});
