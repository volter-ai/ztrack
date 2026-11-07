// in-toto attestation emit (design: strategy/evidence-schema-in-toto.md).
// Operates over the VALIDATED ROOT (the export) — issues > acceptanceCriteria >
// evidence — not a separate snapshot model. Every evidence entry that carries a
// commit anchor becomes one in-toto Statement: subject = the implementation state
// the evidence speaks about (git commit), predicate = the claim binding (the AC id
// + version) plus the artifact details. Entries without a commit anchor are
// counted as skipped, never silently dropped.
import type { CoreRoot } from './core/engine.ts';

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

// Full 40-hex shas use the spec digest key; abbreviated shas (common in issue
// bodies) are declared as such rather than passed off as full digests.
function commitDigest(sha: string): Record<string, string> {
  return /^[0-9a-f]{40}$/i.test(sha) ? { gitCommit: sha.toLowerCase() } : { gitCommitAbbrev: sha.toLowerCase() };
}

// Read a known optional string field off an evidence/AC object (the validated
// schemas carry these as typed optional fields; reading them is not a projection).
function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
}
function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

export function exportInTotoStatements(
  root: CoreRoot,
  options: { issues?: string[] } = {},
): AttestExportResult {
  const issueFilter = options.issues ? new Set(options.issues) : null;
  const statements: InTotoStatement[] = [];
  const skipped: AttestExportResult['skipped'] = [];

  for (const issue of root.issues) {
    if (issueFilter && !issueFilter.has(issue.id)) continue;
    for (const ac of issue.acceptanceCriteria) {
      const acObj = ac as unknown as Record<string, unknown>;
      const acVersion = str(acObj, 'version') || '';
      const acCommits = strList(acObj.commitHashes);
      for (const ev of ac.evidence) {
        const e = ev as unknown as Record<string, unknown>;
        // anchor resolution: an entry's own sha/head/commit wins; otherwise the
        // evidence speaks about the AC's cited implementation commit.
        const own = str(e, 'sha') || str(e, 'head') || str(e, 'commit');
        const sha = own || acCommits[0] || '';
        if (!sha) {
          skipped.push({ issue: issue.id, entry: ev.id, reason: 'no commit anchor (evidence or AC)' });
          continue;
        }
        const type = str(e, 'type');
        const base: Record<string, unknown> = {
          issue: issue.id,
          acId: ac.id,
          entryId: ev.id,
          claims: [{ acId: ac.id, acVersion }],
          anchorSource: own ? 'entry' : 'ac-implementation',
          ...(str(e, 'justification') ? { justification: str(e, 'justification') } : {}),
          environment: { world: 'production' },
        };
        const subject = [{ name: issue.id, digest: commitDigest(sha) }];
        if (type === 'screenshot') {
          // media = where the screenshot lives: a committed path (commit mode) or a
          // digest-pinned URL (attach mode). The legacy content-addressed `blob` ref was
          // removed with blobStore — no CLI path can populate it, so it's not read here.
          statements.push({ _type: STATEMENT_TYPE, subject, predicateType: 'https://volter.ai/attestation/screenshot-evidence/v1', predicate: { ...base, media: { ...(str(e, 'path') ? { path: str(e, 'path') } : {}), ...(str(e, 'url') ? { url: str(e, 'url') } : {}) } } });
        } else if (type === 'video') {
          statements.push({ _type: STATEMENT_TYPE, subject, predicateType: 'https://volter.ai/attestation/human-qa/v1', predicate: { ...base, result: str(e, 'result') || str(e, 'status'), ...(str(e, 'url') ? { session: { url: str(e, 'url') } } : {}), ...(str(e, 'summary') ? { summary: str(e, 'summary') } : {}) } });
        } else if (type === 'pr') {
          statements.push({ _type: STATEMENT_TYPE, subject, predicateType: 'https://volter.ai/attestation/change-review/v1', predicate: { ...base, review: { repo: str(e, 'repo'), number: Number(str(e, 'number')) || 0, state: str(e, 'state'), ...(str(e, 'mergeCommit') ? { mergeCommit: str(e, 'mergeCommit') } : {}) } } });
        } else {
          statements.push({ _type: STATEMENT_TYPE, subject, predicateType: 'https://volter.ai/attestation/evidence/v1', predicate: base });
        }
      }

      // proof primitive (e.g. the default preset's AC proof): attest the claim that
      // the cited evidence demonstrates the AC, anchored on the AC's commit.
      const proof = acObj.proof as { explanation?: string; evidenceRefs?: string[] } | undefined;
      if (proof && acCommits[0]) {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: issue.id, digest: commitDigest(acCommits[0]) }],
          predicateType: 'https://volter.ai/attestation/proof/v1',
          predicate: { issue: issue.id, acId: ac.id, claim: proof.explanation ?? '', evidence: proof.evidenceRefs ?? [], claims: [{ acId: ac.id, acVersion }], environment: { world: 'production' } },
        });
      }
    }
  }

  return { statements, skipped };
}
