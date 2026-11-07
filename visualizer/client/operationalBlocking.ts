import type { EffectiveExtension } from './extensions';
import type { CoreIssue } from './model';

export function isOperationallyBlocked(issue: CoreIssue, extension: EffectiveExtension): boolean {
  return extension.operationalBlocking[issue.id]?.blocked === true ||
    extension.isOperationallyBlocked?.(issue) === true;
}

export function operationalBlockLabel(issue: CoreIssue, extension: EffectiveExtension): string | undefined {
  if (!isOperationallyBlocked(issue, extension)) return undefined;
  const custom = extension.operationalBlockLabel?.(issue);
  if (custom) return custom;
  const blockers = extension.operationalBlocking[issue.id]?.blockers ?? [];
  if (blockers.length === 0) return 'operationally blocked';
  return `blocked by ${blockers.map((blocker) => blocker.ac ? `${blocker.issue}:${blocker.ac}` : blocker.issue).join(', ')}`;
}
