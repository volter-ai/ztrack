import { describe, expect, test } from 'bun:test';
import { win32 } from 'node:path';
import { classifyProjectPath, normalizeProjectUrlPath } from './visualizerProjectPath.ts';

describe('visualizer project URL paths', () => {
  test('canonical evidence remains POSIX-classifiable on Windows hosts', () => {
    const urlPath = '/project/.volter/evidence/demo.webm';
    expect(win32.normalize(urlPath.replace(/^\/project\//, ''))).toBe('.volter\\evidence\\demo.webm');
    const rel = normalizeProjectUrlPath(urlPath);
    expect(rel).toBe('.volter/evidence/demo.webm');
    expect(classifyProjectPath(rel!, '.volter').canonicalEvidence).toBe(true);
  });

  test('canonical source artifacts remain pinned on Windows hosts', () => {
    const rel = normalizeProjectUrlPath('/project/docs/sources/report.pdf');
    expect(rel).toBe('docs/sources/report.pdf');
    expect(classifyProjectPath(rel!, '.volter').canonicalSource).toBe(true);
  });

  test('rejects encoded backslashes before converting the URL path to a host path', () => {
    expect(normalizeProjectUrlPath('/project/.volter%5Cevidence%5Cdemo.webm')).toBeNull();
    expect(normalizeProjectUrlPath('/project/..%5Coutside.txt')).toBeNull();
  });
});
