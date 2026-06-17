// The preset-extension seam. The core renderer draws the universal skeleton
// (ids, status, primitives, findings, audit); a preset's extension supplies its
// own status vocabulary and AC rendering. Mirrors the original visualizer's
// presetExtensions seam, adapted to the core model.

import type { ReactNode } from 'react';
import type { CoreAC, CoreIssue } from './model';
import { defaultExtension } from './presets/default';
import { speckitExtension } from './presets/speckit';

export interface PresetExtension {
  statusOrder: string[];                                  // column / group / view order
  acUnitLabel?: string;                                  // what an AC is called (e.g. "Dev ACs", "User Stories")
  statusClass?(status: string): string;                  // -> css `state-<x>`
  assignee?(issue: CoreIssue): string | undefined;       // preset's assignee field
  pr?(issue: CoreIssue): { url: string } | undefined;    // preset's PR field
  acText?(ac: CoreAC): ReactNode;                        // the AC label
  acEvidence?(ac: CoreAC, projectUrl: (p: string) => string): ReactNode;
  acProof?(ac: CoreAC): ReactNode;                       // proof (explanation + refs)
  issuePanels?(issue: CoreIssue): ReactNode;            // preset-specific issue-level panels
}

const EXTENSIONS: Record<string, PresetExtension> = {
  default: defaultExtension,
  speckit: speckitExtension,
};

export function extensionFor(preset: string): PresetExtension {
  return EXTENSIONS[preset] ?? { statusOrder: [] };
}
