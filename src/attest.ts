// in-toto attestation emit (design: strategy/evidence-schema-in-toto.md).
// Every evidence/proof/approval entry that carries a commit anchor becomes
// one in-toto Statement: subject = the implementation state the evidence
// speaks about (git commit), predicate = the claim binding (AC ids + the
// AC-Version content hashes) plus the artifact details. Unsigned JSON for
// now (DSSE/Sigstore signing is the flagged follow-up); entries without a
// commit anchor are counted as skipped, never silently dropped.
import type { ExportedTrackerSnapshot } from './export.ts';

const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';

export type InTotoStatement = {
  _type: typeof STATEMENT_TYPE;
  subject: Array<{ name: string; digest: Record<string, string> }>;
  predicateType: string;
  predicate: Record<string, unknown>;
};

export type AttestExportResult = {
  statements: InTotoStatement[];
  skipped: Array<{ issue: string; entry: string; reason: string }>;
};

// Full 40-hex shas use the spec digest key; abbreviated shas (common in
// issue bodies) are declared as such rather than passed off as full digests.
function commitDigest(sha: string): Record<string, string> {
  return /^[0-9a-f]{40}$/i.test(sha) ? { gitCommit: sha.toLowerCase() } : { gitCommitAbbrev: sha.toLowerCase() };
}

function claimsFor(ac: string[], acVersions: Record<string, string>, fallbackVersion: string): Array<{ acId: string; acVersion: string }> {
  return ac.map((acId) => ({ acId, acVersion: acVersions[acId] || fallbackVersion || '' }));
}

type SnapshotCase = ExportedTrackerSnapshot['cases'][number];
type AttestableEntry = {
  id: string;
  type?: string;
  ac?: string[];
  evidence?: string[];
  fields?: Record<string, string>;
  [key: string]: unknown;
};
type AttestableCriterion = { commitHashes?: unknown };

function field(entry: AttestableEntry, name: string): string {
  const direct = (entry as Record<string, unknown>)[name];
  if (typeof direct === 'string') return direct;
  if (typeof direct === 'number' || typeof direct === 'boolean') return String(direct);
  return entry.fields?.[name] ?? '';
}

function versionMap(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean)) {
    const match = /^(?<id>dev\/\d{1,3})=(?<version>acv_[0-9a-f]{8,64})$/i.exec(part);
    if (match?.groups) out[match.groups.id.toLowerCase().replace(/\/(\d)$/, '/0$1')] = match.groups.version;
  }
  return out;
}

function listField(raw: string): string[] {
  return raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
}

function stringListField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function asEntries(value: unknown): AttestableEntry[] {
  return Array.isArray(value) ? value.filter((item): item is AttestableEntry => Boolean(item) && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') : [];
}

function caseEvidence(currentCase: SnapshotCase): AttestableEntry[] {
  const validated = asEntries(currentCase.validatedIssue?.evidence);
  return validated.length ? validated : asEntries((currentCase as Record<string, unknown>).evidence);
}

function caseProofs(currentCase: SnapshotCase): AttestableEntry[] {
  const validated = asEntries(currentCase.validatedIssue?.proofs);
  return validated.length ? validated : asEntries((currentCase as Record<string, unknown>).proofs);
}

function caseAcceptanceCriteria(currentCase: SnapshotCase): AttestableCriterion[] {
  const validated = currentCase.validatedIssue?.acceptanceCriteria;
  if (Array.isArray(validated) && validated.length) return validated as AttestableCriterion[];
  const exported = (currentCase as Record<string, unknown>).acceptanceCriteria;
  return Array.isArray(exported) ? exported as AttestableCriterion[] : [];
}

function caseImplementationSha(currentCase: SnapshotCase): string {
  const exportedSha = (currentCase as Record<string, unknown>).currentImplementationSha;
  if (typeof exportedSha === 'string' && exportedSha) return exportedSha;
  const evidence = caseEvidence(currentCase);
  const pr = evidence.find((entry) => entry.type === 'pr' && field(entry, 'head'));
  if (pr) return field(pr, 'head');
  const merged = evidence.find((entry) => entry.type === 'pr' && field(entry, 'merge-commit'));
  if (merged) return field(merged, 'merge-commit');
  const commits = [...new Set(caseAcceptanceCriteria(currentCase).flatMap((criterion) => stringListField(criterion.commitHashes)))];
  return commits.length === 1 ? commits[0]! : '';
}

export function exportInTotoStatements(
  snapshot: ExportedTrackerSnapshot,
  options: { issues?: string[] } = {},
): AttestExportResult {
  const issueFilter = options.issues ? new Set(options.issues) : null;
  const statements: InTotoStatement[] = [];
  const skipped: AttestExportResult['skipped'] = [];

  for (const currentCase of snapshot.cases) {
    if (issueFilter && !issueFilter.has(currentCase.identifier)) continue;
    const subjectName = currentCase.identifier;
    const caseSha = caseImplementationSha(currentCase);

    for (const entry of caseEvidence(currentCase)) {
      const approvedSha = field(entry, 'approved-sha');
      const approvedEvidence = listField(field(entry, 'approved-evidence'));
      const isApproval = Boolean(approvedSha || approvedEvidence.length > 0);
      // Anchor resolution mirrors the validator: an entry's own sha wins;
      // otherwise the evidence speaks about the case's implementation state.
      // The anchor's provenance is declared, never implied.
      const own = field(entry, 'sha') || field(entry, 'head') || (isApproval ? approvedSha : '');
      const sha = own || caseSha;
      if (!sha) {
        skipped.push({ issue: subjectName, entry: entry.id, reason: 'no commit anchor (entry or case)' });
        continue;
      }
      const base = {
        issue: subjectName,
        entryId: entry.id,
        claims: claimsFor(entry.ac ?? [], versionMap(field(entry, 'ac-version')), field(entry, 'ac-version')),
        anchorSource: own ? (isApproval && !field(entry, 'sha') && !field(entry, 'head') ? 'approval' : 'entry') : 'case-implementation',
        ...(field(entry, 'justification') ? { justification: field(entry, 'justification') } : {}),
        environment: { world: 'production' },
      };
      if (isApproval) {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(approvedSha || sha) }],
          predicateType: 'https://volter.ai/attestation/approval/v1',
          predicate: {
            ...base,
            approvedClaims: Object.entries(versionMap(field(entry, 'approved-ac-version'))).map(([acId, acVersion]) => ({ acId, acVersion })),
            approvedEvidence,
          },
        });
        continue;
      }
      if (entry.type === 'screenshot') {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(sha) }],
          predicateType: 'https://volter.ai/attestation/screenshot-evidence/v1',
          predicate: { ...base, media: { ...(field(entry, 'path') ? { path: field(entry, 'path') } : {}), ...(field(entry, 'url') ? { url: field(entry, 'url') } : {}) } },
        });
      } else if (entry.type === 'video') {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(sha) }],
          predicateType: 'https://volter.ai/attestation/human-qa/v1',
          predicate: { ...base, result: field(entry, 'result') || field(entry, 'status') || '', ...(field(entry, 'url') ? { session: { url: field(entry, 'url') } } : {}), ...(field(entry, 'summary') ? { summary: field(entry, 'summary') } : {}) },
        });
      } else if (entry.type === 'pr') {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(sha) }],
          predicateType: 'https://volter.ai/attestation/change-review/v1',
          predicate: {
            ...base,
            review: {
              repo: field(entry, 'repo'),
              number: Number(field(entry, 'number')) || 0,
              state: field(entry, 'state'),
              draft: ['true', 'yes', '1'].includes(field(entry, 'draft').toLowerCase()),
              ...(field(entry, 'merge-commit') ? { mergeCommit: field(entry, 'merge-commit') } : {}),
            },
          },
        });
      } else {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(sha) }],
          predicateType: 'https://volter.ai/attestation/evidence/v1',
          predicate: base,
        });
      }
    }

    for (const proof of caseProofs(currentCase)) {
      const proofSha = field(proof, 'sha') || caseSha;
      if (!proofSha) {
        skipped.push({ issue: subjectName, entry: proof.id, reason: 'no commit anchor (proof or case)' });
        continue;
      }
      statements.push({
        _type: STATEMENT_TYPE,
        subject: [{ name: subjectName, digest: commitDigest(proofSha) }],
        predicateType: 'https://volter.ai/attestation/proof/v1',
        predicate: {
          issue: subjectName,
          entryId: proof.id,
          anchorSource: field(proof, 'sha') ? 'entry' : 'case-implementation',
          claim: field(proof, 'claim'),
          claims: claimsFor(proof.ac ?? [], versionMap(field(proof, 'ac-version')), field(proof, 'ac-version')),
          evidence: proof.evidence ?? [],
          environment: { world: 'production' },
        },
      });
    }
  }

  return { statements, skipped };
}
