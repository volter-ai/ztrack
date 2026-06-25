// `tracker lint` — the valid-but-suspicious layer. Lint findings are fixed
// by editing text; check findings are fixed by producing evidence. The rule
// set is deliberately tiny and corpus-audited: a rule ships only if every
// firing on the 205 production bodies was adjudicated as a true positive
// (Vale discipline — false positives are the #1 lint killer). Severity is
// configurable per rule via organization.lint.rules ("warn"|"error"|"off").
import { parseIssueMarkdown } from './markdownDocument.ts';
import type { TrackerConfig } from './types.ts';

export type LintSeverity = 'warn' | 'error' | 'off';

export type LintFinding = {
  severity: Exclude<LintSeverity, 'off'>;
  rule: string;
  message: string;
  issue?: string;
  section?: string;
  excerpt?: string;
};

export const LINT_RULES: Record<string, { default: LintSeverity; description: string }> = {
  'todo-marker': { default: 'warn', description: 'TODO/FIXME/TBD left in a case record' },
  'placeholder-token': { default: 'warn', description: 'unfilled template token like <CASE>, <sha>, or lorem ipsum' },
  'unchecked-with-commit': { default: 'warn', description: 'unchecked AC row still carries a Commit: claim' },
};

const TODO_RE = /\b(TODO|FIXME|TBD)\b[:\s]/;
const PLACEHOLDER_RE = /<(CASE|ISSUE|sha|SHA|commit|placeholder|fill[- ]?in|your[- ][a-z]+)>|lorem ipsum/i;
const COMMIT_FIELD_RE = /\bcommit[:\s]+[0-9a-f]{7,40}\b/i;

export function lintIssueBody(body: string, issue?: string, config?: TrackerConfig): LintFinding[] {
  const rules = (config?.organization as Record<string, any> | undefined)?.lint?.rules ?? {};
  const severity = (rule: string): LintSeverity => rules[rule] ?? LINT_RULES[rule]?.default ?? 'warn';
  const findings: LintFinding[] = [];
  const seen = new Set<string>();
  const push = (rule: string, message: string, section?: string, excerpt?: string) => {
    const level = severity(rule);
    if (level === 'off') return;
    const key = `${rule}|${issue ?? ''}|${excerpt ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity: level, rule, message, ...(issue ? { issue } : {}), ...(section ? { section } : {}), ...(excerpt ? { excerpt: excerpt.slice(0, 120) } : {}) });
  };

  const parsed = parseIssueMarkdown(body);
  for (const section of parsed.document.sections) {
    if (section.level !== 2) continue;
    for (const line of section.body.split('\n')) {
      // Inline code spans quote conventions ("`[development:<issue>]`") —
      // documentation, not unfilled tokens. Corpus-adjudicated FP class.
      const prose = line.replace(/`[^`]*`/g, '');
      if (TODO_RE.test(prose)) push('todo-marker', `Unresolved ${TODO_RE.exec(prose)?.[1]} marker.`, section.title, line.trim());
      if (PLACEHOLDER_RE.test(prose)) push('placeholder-token', 'Unfilled template token.', section.title, line.trim());
    }
    for (const item of section.checkboxItems) {
      if (!item.checked && COMMIT_FIELD_RE.test(item.body)) {
        push('unchecked-with-commit', 'Unchecked AC still claims a commit — stale claim or forgotten checkbox.', section.title, item.body.split('\n')[0]);
      }
    }
  }
  return findings;
}
