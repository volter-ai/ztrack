import { createHash } from 'node:crypto';

const SOURCE_REF_RE = /(?<![A-Za-z])\[(?:source\s*)?(?<num>\d+)\]/gi;
const UPLOAD_REF_RE = /(?<path>(?:\.?\/)?uploads\/[^\s,)>\]]+\.(?:png|jpe?g|webp))/gi;
const EVIDENCE_REF_RE = /\[E(?<num>\d+)\]/g;
const PROOF_REF_RE = /\[P(?<num>\d+)\]/g;
const AC_VERSION_FIELD_RE = /\bAC-Version:\s*acv_[0-9a-f]{8,64}\b/gi;
const AC_STATUS_FIELD_RE = /\bstatus:\s*(pending|passed|failed|stale|blocked|descoped)\b/gi;

export function acVersionFor(id: string, text: string, sourceRefs: string[], visibility?: string): string {
  const input = JSON.stringify({
    id,
    text: text.trim().replace(/\s+/g, ' '),
    sourceRefs: [...sourceRefs].sort(),
    ...(visibility ? { visibility } : {}),
  });
  return `acv_${createHash('sha256').update(input).digest('hex').slice(0, 12)}`;
}

function sourceRefs(text: string): string[] {
  return [...new Set([...text.matchAll(SOURCE_REF_RE)].flatMap((match) => match.groups?.num ? [match.groups.num] : []))].sort();
}

function developmentVisibility(body: string): 'visible' | 'invisible' {
  return /\b(invisible|non[- ]?visible|cleanup|refactor|internal|backend|infrastructure|no visible ui|preserve existing behavior)\b/i.test(body)
    ? 'invisible'
    : 'visible';
}

function bodyWithoutAcStatus(body: string): string {
  return body.replace(AC_STATUS_FIELD_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function acceptanceCriterionText(body: string, id: string): string {
  return bodyWithoutAcStatus(body)
    .replace(new RegExp(`^\\s*${escapeRegExp(id)}\\s+`, 'i'), '')
    .replace(/\btype:\s*[a-z][a-z0-9_-]*\b/gi, '')
    .replace(SOURCE_REF_RE, '')
    .replace(EVIDENCE_REF_RE, '')
    .replace(PROOF_REF_RE, '')
    .replace(UPLOAD_REF_RE, '')
    .replace(AC_VERSION_FIELD_RE, '')
    .replace(/\bcommit[:\s]+[0-9a-f]{7,40}\b\.?/gi, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Structured mutations must stamp AC-Version exactly the way the snapshot
// exporter computes it; this is the shared derivation.
export function acVersionForItemBody(id: string, itemBody: string): string {
  return acVersionFor(id, acceptanceCriterionText(itemBody, id), sourceRefs(itemBody), developmentVisibility(itemBody));
}
