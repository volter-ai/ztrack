// The loop marker — the IPC between `ztrack loop start <target>` and the Stop-hook gate
// (`ztrack check --auto-scope`, run later in a separate process). It records WHAT the ralph
// loop is driving to green (the unified check target) plus the iteration cap. The gate reads
// it to decide what to hold the turn on; the loop command writes it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDirName } from './config.ts';
import type { CheckTarget } from './cliTarget.ts';

export type LoopMarker = {
  target: CheckTarget;            // issue ids | a file | branch-auto | the whole tracker
  maxIterations: number;
  startedAt: string;
  label: string;                  // human label for `loop status` (the id / file / "this branch")
};

export const loopMarkerPath = (root: string): string => join(root, stateDirName(), '.ztrack-loop.json');

export function readLoopMarker(root: string): LoopMarker | null {
  const p = loopMarkerPath(root);
  if (!existsSync(p)) return null;
  try {
    const m = JSON.parse(readFileSync(p, 'utf8')) as Partial<LoopMarker> & { issue?: string };
    if (m.target) return m as LoopMarker;
    // back-compat: an older marker stored a bare `issue` id.
    if (m.issue) return { target: { kind: 'issues', ids: [m.issue] }, maxIterations: m.maxIterations ?? 8, startedAt: m.startedAt ?? '', label: m.issue };
    return null;
  } catch { return null; }
}

/** One-line description of a loop target for `loop status` / arm messages. */
export function describeTarget(t: CheckTarget): string {
  switch (t.kind) {
    case 'issues': return t.ids.join(', ');
    case 'file': return t.path;
    case 'auto': return "this branch's issue";
    case 'all': return 'the whole tracker';
  }
}
