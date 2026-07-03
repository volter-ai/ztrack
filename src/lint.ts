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
  'weak_claim': { default: 'warn', description: 'assertive verification language ("works perfectly", "fully verified", ...) with no cited evidence nearby — reads prose, not truth' },
};

const TODO_RE = /\b(TODO|FIXME|TBD)\b[:\s]/;
const PLACEHOLDER_RE = /<(CASE|ISSUE|sha|SHA|commit|placeholder|fill[- ]?in|your[- ][a-z]+)>|lorem ipsum/i;
const COMMIT_FIELD_RE = /\bcommit[:\s]+[0-9a-f]{7,40}\b/i;

// weak_claim: a curated, reviewable lexicon of assertive-verification phrases (add more here
// only after corpus-adjudicating them the way LINT_RULES above requires — false positives are
// the #1 lint killer, so this list stays small and literal rather than broad and clever). Each
// entry is word-boundary anchored and case-insensitive so it can't straddle into an unrelated
// word (e.g. "should work" won't match "workshop").
const WEAK_CLAIM_LEXICON: Array<{ id: string; re: RegExp }> = [
  { id: 'all tests pass(ed)', re: /\ball tests pass(?:ed)?\b/i },
  { id: 'works perfectly', re: /\bworks perfectly\b/i },
  { id: 'fully verified', re: /\bfully verified\b/i },
  { id: 'fully tested', re: /\bfully tested\b/i },
  { id: '100% working', re: /\b100%\s*working\b/i },
  { id: 'should work', re: /\bshould work\b/i },
  { id: 'verified end to end', re: /\bverified end to end\b/i },
];

// Exposed for tests only, so the fixture matrix pinning "every lexicon phrase fires" fails
// loudly if the lexicon grows or shrinks without a matching test being added.
export const WEAK_CLAIM_LEXICON_IDS: string[] = WEAK_CLAIM_LEXICON.map((entry) => entry.id);

// "Cited evidence" is: an evidence/proof/source bracket ref ([E1], [P1], [1], [source 1]), a
// commit hash (this workspace's own tracker docs write `commit=<sha>`, ztrack's own AC rows
// write `commit: <sha>` — both accepted), or an uploaded screenshot path. Deliberately
// permissive: a false NEGATIVE here (treating real evidence as absent) is the failure mode to
// avoid, so recall on evidence-detection is what buys precision on the claim lexicon above.
const EVIDENCE_CITATION_RE = /\[(?:[EP]|source\s*)?\d+\]|\bcommit[:=\s]+[0-9a-f]{7,40}\b|uploads\/[^\s,)>\]]+\.(?:png|jpe?g|webp)/i;

const FENCE_RE = /^\s*(```|~~~)/;
// A NEW item block starts only at a top-level (column-0) checkbox marker — a nested bullet
// (e.g. an indented `- evidence …`/`- proof …` line under an AC row) stays part of the item
// it's nested under, which is exactly the scope "accompanied by cited evidence" needs: the
// item's own claim line and its own nested evidence/proof lines are the same block.
const TOP_LEVEL_CHECKBOX_RE = /^[-*]\s+\[[ xX]\]\s+/;

function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, '');
}

// Splits a section body into "item blocks": free-form prose before the first top-level
// checkbox is block 0; each subsequent top-level checkbox line opens a new block that also
// owns every nested/indented line under it (its own proof/evidence bullets) up to the next
// top-level checkbox or the end of the section. Fenced code (``` / ~~~) is dropped entirely —
// it is neither a claim nor evidence, it's code.
function weakClaimBlocks(sectionBody: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const rawLine of sectionBody.split('\n')) {
    if (FENCE_RE.test(rawLine)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (TOP_LEVEL_CHECKBOX_RE.test(rawLine) && current.length) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(stripInlineCode(rawLine));
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

export function lintIssueBody(body: string, issue?: string, config?: TrackerConfig): LintFinding[] {
  const rules = (config?.organization as Record<string, any> | undefined)?.lint?.rules ?? {};
  const severity = (rule: string): LintSeverity => rules[rule] ?? LINT_RULES[rule]?.default ?? 'warn';
  const findings: LintFinding[] = [];
  const seen = new Set<string>();
  const push = (rule: string, message: string, section?: string, excerpt?: string) => {
    const level = severity(rule);
    if (level === 'off') return;
    const key = `${rule}|${issue ?? ''}|${excerpt ?? ''}|${message}`;
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
    for (const block of weakClaimBlocks(section.body)) {
      const accompanied = EVIDENCE_CITATION_RE.test(block);
      if (accompanied) continue;
      for (const entry of WEAK_CLAIM_LEXICON) {
        const match = entry.re.exec(block);
        if (!match) continue;
        const excerptLine = block.split('\n').find((l) => entry.re.test(l)) ?? match[0];
        push('weak_claim', `The claim "${match[0]}" is not backed by cited evidence here.`, section.title, excerptLine.trim());
      }
    }
  }
  return findings;
}
