// The shape of a tracker issue id — the CLI's one grammar for "does this bare token look like
// an issue id" (cliTarget.ts's `looksLikeIssueId`). Letter start, dash, alphanumeric suffix:
// a strict SUPERSET of what the markdown backend actually mints (`${teamKey}-${number}`,
// e.g. "ZT-1" — and the teamKey itself may contain dashes, so the prefix admits them) and of
// every id shape the workspace uses ("ZL-A9", "ZTA-1", "DEPLOY-1") — so every id the backend
// mints or serves is accepted here. Deliberately looser than the backend's own SAFE_ID
// (backends/markdownBackend.ts), which guards filenames against path traversal and is a
// different concern; this predicate must not be used for that.
const ISSUE_ID = /^[A-Za-z][A-Za-z0-9-]*-[A-Za-z0-9]+$/;

export function isIssueId(token: string): boolean {
  return ISSUE_ID.test(token);
}
