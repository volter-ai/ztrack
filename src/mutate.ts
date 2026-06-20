// Structured mutations over issue bodies: agents stop rewriting whole bodies
// and instead state intent — `tracker ac check dev/03 --commit <sha>
// --evidence E1` — and the mutation engine performs a SCOPED edit: the body
// is canonicalized (fmt), exactly one checkbox item changes, everything else
// stays byte-identical. Field semantics mirror the preset parser's derivation
// (status field, Commit:, [EN]/[PN] refs, AC-Version stamp via
// acVersionForItemBody) so the next validation reflects the mutation faithfully.
import { acVersionForItemBody } from './acVersion.ts';
import { canonicalizeIssueMarkdown, parseMarkdownDocument } from './markdownModel.ts';
import type { MarkdownCheckboxItem } from './markdownModel.ts';

export type AcStatus = 'pending' | 'passed' | 'failed' | 'stale' | 'blocked' | 'descoped';

export type BlockField = 'blocked-by' | 'blocks';
export type AcMutation =
  | { op: 'check'; acId: string; commit?: string; evidence?: string[]; proof?: string[]; anchor?: boolean }
  | { op: 'uncheck'; acId: string }
  | { op: 'set-status'; acId: string; status: AcStatus }
  // add/remove blocking refs (raw tokens: a bare AC id, `issue:ac`, or a whole issue).
  // `unblock` without refs clears the whole field.
  | { op: 'block'; acId: string; field: BlockField; refs: string[] }
  | { op: 'unblock'; acId: string; field: BlockField; refs?: string[] };

export type AcMutationResult = {
  body: string;
  changed: boolean;
  acId: string;
  itemBefore: string;
  itemAfter: string;
};

const AC_ID_IN_BODY_RE = /\b(?<prefix>AC[- ]?|case\/|dev\/|ext\/|proc\/)(?<num>\d{1,3})\b/i;
const STATUS_FIELD_RE = /\bstatus:\s*(pending|passed|failed|stale|blocked|descoped)\b/i;
const COMMIT_FIELD_RE = /\bcommit[:\s]+[0-9a-f]{7,40}\b\.?/gi;
const AC_VERSION_RE = /\s*\bAC-Version:\s*acv_[0-9a-f]{8,64}\b\.?/gi;
const EVIDENCE_REF_RE = /\s*\[E\d+\]/g;
const PROOF_REF_RE = /\s*\[P\d+\]/g;

function normalizedAcId(itemBody: string): string | null {
  const match = AC_ID_IN_BODY_RE.exec(itemBody);
  if (!match?.groups) return null;
  const prefix = match.groups.prefix!.toLowerCase().replace(' ', '-');
  const num = Number(match.groups.num);
  return prefix.endsWith('/') ? `${prefix}${String(num).padStart(2, '0')}` : `AC-${String(num).padStart(2, '0')}`;
}

function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]+$/gm, '').trim();
}

function setStatusField(itemBody: string, acId: string, status: AcStatus): string {
  if (STATUS_FIELD_RE.test(itemBody)) return itemBody.replace(STATUS_FIELD_RE, `status: ${status}`);
  // Insert directly after the AC id token (the conventional position).
  const idMatch = AC_ID_IN_BODY_RE.exec(itemBody);
  if (idMatch && idMatch.index !== undefined) {
    const end = idMatch.index + idMatch[0].length;
    return `${itemBody.slice(0, end)} status: ${status}${itemBody.slice(end)}`;
  }
  return `${acId} status: ${status} ${itemBody}`;
}

function checkItem(itemBody: string, acId: string, mutation: Extract<AcMutation, { op: 'check' }>): string {
  let body = setStatusField(itemBody, acId, 'passed');
  if (mutation.commit) {
    if (/\bcommit[:\s]+[0-9a-f]{7,40}\b/i.test(body)) {
      body = body.replace(/\b(commit[:\s]+)[0-9a-f]{7,40}\b/i, (_full, label: string) => `${label}${mutation.commit}`);
    } else {
      const tidied = tidy(body);
      // No period after a trailing [N]/[EN] marker — matches corpus
      // convention "desc. [1] Commit: <sha>."
      body = `${tidied}${/[.!?\]]$/.test(tidied) ? '' : '.'} Commit: ${mutation.commit}.`;
    }
  }
  for (const ref of mutation.evidence ?? []) {
    if (!body.includes(`[${ref}]`)) body = `${body} [${ref}]`;
  }
  for (const ref of mutation.proof ?? []) {
    if (!body.includes(`[${ref}]`)) body = `${body} [${ref}]`;
  }
  body = tidy(body);
  if (mutation.anchor !== false) {
    const stripped = tidy(body.replace(AC_VERSION_RE, ' '));
    body = `${stripped} AC-Version: ${acVersionForItemBody(acId, stripped)}`;
  }
  return tidy(body);
}

// The inline `blocked-by:` / `blocks:` field on an AC's checkbox line. The value runs
// to the next known field, a [marker], the trailing AC-Version stamp, or EOL — matching
// the generic preset's parser so a read after the write sees exactly these refs.
const blockFieldRe = (field: BlockField) =>
  new RegExp(`\\b${field}:\\s*(.+?)(?=\\s+(?:status|commit|blocked-by|blocks|ac-version):|\\s*\\[[^\\]]*\\]|$)`, 'i');

function blockingRefs(itemBody: string, field: BlockField): string[] {
  const m = blockFieldRe(field).exec(itemBody);
  return m ? m[1]!.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// Rewrite the field to exactly `refs` (empty removes it). When appending, keep the
// AC-Version stamp last so it stays in its conventional trailing position.
function setBlockingField(itemBody: string, field: BlockField, refs: string[]): string {
  const m = blockFieldRe(field).exec(itemBody);
  const value = refs.join(', ');
  if (m) {
    const replaced = refs.length ? `${field}: ${value}` : '';
    return tidy(itemBody.slice(0, m.index) + replaced + itemBody.slice(m.index + m[0].length));
  }
  if (refs.length === 0) return tidy(itemBody);
  const tidied = tidy(itemBody);
  const anchor = /\s*\bAC-Version:\s*acv_[0-9a-f]{8,64}\b\.?/i.exec(tidied);
  return anchor
    ? tidy(`${tidied.slice(0, anchor.index)} ${field}: ${value}${tidied.slice(anchor.index)}`)
    : tidy(`${tidied} ${field}: ${value}`);
}

function uncheckItem(itemBody: string, acId: string): string {
  let body = itemBody.replace(COMMIT_FIELD_RE, ' ');
  body = body.replace(AC_VERSION_RE, ' ');
  body = body.replace(EVIDENCE_REF_RE, '');
  body = body.replace(PROOF_REF_RE, '');
  body = setStatusField(tidy(body), acId, 'pending');
  return tidy(body);
}

export type EvidenceSpec = {
  type: string;
  ac?: string;
  repo?: string;
  number?: string;
  head?: string;
  state?: string;
  path?: string;
  url?: string;
  // Content-addressed evidence ref (`sha256:<hex>`) — bytes live in the tracker
  // blob store, so existence is checkout-independent. Preferred over `path` for
  // screenshots/frames; `path` remains for back-compat.
  blob?: string;
  status?: string;
  justification?: string;
};

export type EvidenceAddResult = { body: string; evidenceId: string };

// Create a resolvable `[En]` entry in the `## Evidence` section (creating the
// section if absent) and return its id. Agents then reference it from an AC
// line via `ac check --evidence En` — that two-step split keeps entry creation
// out of the AC-Version anchoring path. Field order matches the corpus grammar
// `[En] type: <t> key: value ...` parsed by parseEvidenceSection.
export function addEvidenceEntry(rawBody: string, spec: EvidenceSpec): EvidenceAddResult {
  const canonical = canonicalizeIssueMarkdown(rawBody);
  // `[En]` entries are GFM list items (`- [En] …`); tolerate a legacy bare line too.
  const existingNums = [...canonical.matchAll(/^\s*(?:-\s+)?\[E(\d+)\]/gm)].map((match) => Number(match[1]));
  const id = `E${(existingNums.length ? Math.max(...existingNums) : 0) + 1}`;

  const fields: string[] = [`type: ${spec.type}`];
  const push = (name: string, value?: string): void => { if (value) fields.push(`${name}: ${value}`); };
  push('repo', spec.repo);
  push('number', spec.number);
  push('head', spec.head);
  push('state', spec.state);
  push('path', spec.path);
  push('url', spec.url);
  push('blob', spec.blob);
  push('status', spec.status);
  push('ac', spec.ac);
  // justification may contain spaces; it is the last field (runs to EOL).
  push('justification', spec.justification);
  // Evidence entries are GFM list items so each is its own node (the validator
  // discovers one record per node — no line-scanning).
  const entryLine = `- [${id}] ${fields.join(' ')}`;

  const lines = canonical.split('\n');
  const evidenceHeadingIdx = lines.findIndex((line) => /^#{1,6}\s+Evidence\s*$/i.test(line));
  if (evidenceHeadingIdx === -1) {
    const trimmed = canonical.replace(/\n+$/, '');
    return { body: canonicalizeIssueMarkdown(`${trimmed}\n\n## Evidence\n\n${entryLine}\n`), evidenceId: id };
  }
  // Insert after the last existing [E..] entry in the section, else right after
  // the heading. The section ends at the next heading or EOF.
  let sectionEnd = lines.length;
  for (let i = evidenceHeadingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i]!)) { sectionEnd = i; break; }
  }
  let insertAt = evidenceHeadingIdx + 1;
  for (let i = evidenceHeadingIdx + 1; i < sectionEnd; i++) {
    if (/^\s*(?:-\s+)?\[E\d+\]/.test(lines[i]!)) insertAt = i + 1;
  }
  lines.splice(insertAt, 0, entryLine);
  return { body: canonicalizeIssueMarkdown(lines.join('\n')), evidenceId: id };
}

export function applyAcMutation(rawBody: string, mutation: AcMutation): AcMutationResult {
  const canonical = canonicalizeIssueMarkdown(rawBody);
  const document = parseMarkdownDocument(canonical);
  // Normalize the caller's id the SAME way body ids are normalized (zero-pad the number),
  // so an unpadded query like "AC-2" / "dev/3" matches the body's "AC-02" / "dev/03".
  const targetId = (normalizedAcId(mutation.acId) ?? mutation.acId).toLowerCase();

  // Ancestor sections contain their children's text, so the same physical
  // row surfaces in multiple sections' checkboxItems — dedupe by position.
  const seenLines = new Set<number>();
  const matches: Array<{ item: MarkdownCheckboxItem }> = [];
  for (const section of document.sections) {
    for (const item of section.checkboxItems) {
      if (normalizedAcId(item.body)?.toLowerCase() !== targetId) continue;
      if (seenLines.has(item.lineStart)) continue;
      seenLines.add(item.lineStart);
      matches.push({ item });
    }
  }
  if (matches.length === 0) throw new Error(`AC ${mutation.acId} not found in issue body`);
  if (matches.length > 1) throw new Error(`AC ${mutation.acId} is ambiguous: ${matches.length} checkbox rows carry this id`);

  const item = matches[0]!.item;
  // Use the matched row's OWN canonical id for every mutation (status field, AC-Version
  // stamp), not the caller's raw id — otherwise an unpadded "AC-2" would strip/hash
  // against the wrong token and produce an AC-Version that diverges from the canonical
  // derivation the exporter treats as authoritative.
  const canonicalId = normalizedAcId(item.body) ?? mutation.acId;
  const lines = canonical.split('\n');
  const bodyLines = item.body.split('\n');
  // Only the AC's OWN line (the checkbox line's content) is mutated; continuation/
  // nested lines are preserved byte-for-byte. Mutating the whole multi-line body would
  // collapse continuation indentation and stamp AC-Version onto prose.
  const firstLine = bodyLines[0] ?? '';
  const restLines = bodyLines.slice(1);

  let newChecked = item.checked;
  let newFirst = firstLine;
  if (mutation.op === 'check') {
    newChecked = true;
    newFirst = checkItem(firstLine, canonicalId, mutation);
  } else if (mutation.op === 'uncheck') {
    newChecked = false;
    newFirst = uncheckItem(firstLine, canonicalId);
  } else if (mutation.op === 'set-status') {
    newChecked = mutation.status === 'passed' ? true : mutation.status === 'pending' ? false : item.checked;
    newFirst = tidy(setStatusField(firstLine, canonicalId, mutation.status));
  } else {
    // block / unblock — edit only the blocking field; completion state is untouched.
    const existing = blockingRefs(firstLine, mutation.field);
    const next = mutation.op === 'block'
      ? [...existing, ...mutation.refs.filter((r) => !existing.includes(r))]
      : (mutation.refs ? existing.filter((r) => !mutation.refs!.includes(r)) : []);
    newFirst = setBlockingField(firstLine, mutation.field, next);
  }
  const newBody = [newFirst, ...restLines].join('\n');

  const indentMatch = /^(\s*)-/.exec(lines[item.lineStart - 1] ?? '');
  const indent = indentMatch?.[1] ?? '';
  const rendered = [`${indent}- [${newChecked ? 'x' : ' '}] ${newFirst}`, ...restLines];
  lines.splice(item.lineStart - 1, bodyLines.length, ...rendered);

  const body = canonicalizeIssueMarkdown(lines.join('\n'));
  return {
    body,
    changed: body !== canonical,
    acId: mutation.acId,
    itemBefore: item.body,
    itemAfter: newBody,
  };
}
