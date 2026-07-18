import type { EffectiveExtension } from './extensions';
import type { CoreIssue } from './model';

function relations(issue: CoreIssue): Array<{ type: string; issueId: string }> {
  return (issue as { relations?: Array<{ type: string; issueId: string }> }).relations ?? [];
}

export function hasBlockedAcceptanceCriterion(issue: CoreIssue): boolean {
  return issue.acceptanceCriteria.some((criterion) => {
    const blockedBy = (criterion as { blockedBy?: unknown }).blockedBy;
    return Array.isArray(blockedBy) && blockedBy.length > 0;
  });
}

export function isOperationallyBlocked(issue: CoreIssue, extension: EffectiveExtension): boolean {
  return relations(issue).some((relation) => relation.type === 'blocked-by') ||
    hasBlockedAcceptanceCriterion(issue) ||
    extension.isOperationallyBlocked?.(issue) === true;
}

export function operationalBlockLabel(issue: CoreIssue, extension: EffectiveExtension): string | undefined {
  if (!isOperationallyBlocked(issue, extension)) return undefined;
  return extension.operationalBlockLabel?.(issue) ??
    (hasBlockedAcceptanceCriterion(issue) ? 'blocked by acceptance criterion' : undefined);
}
