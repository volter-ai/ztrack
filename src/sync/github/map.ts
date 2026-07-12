// Map ztrack issue records <-> the github twin's issue SyncResource.
//
// A SYNCED issue IS the GitHub issue (identity, not linking). Authority split: GitHub owns the
// CONTRACT (open/closed + title/body), ztrack owns VERIFICATION (the fine lifecycle state +
// the acceptance-criteria checks). So only open/closed round-trips — as done-ness; the fine
// ztrack status (draft/ready/in-progress/in-review) is ztrack-LOCAL and is never pushed to
// GitHub (an issue's `state` can't represent it). This module is the pure field/status
// mapping; the GitHub I/O (pull/reconcile/push through @volter/twin + the github twin)
// builds on top of it.
import type { IssueRecord } from '../../core/engine.ts';
import type { SyncResource } from '@volter/twin';

const DONE = 'done';

/** ztrack lifecycle status -> GitHub issue state (only done-ness is representable). */
export function statusToGithubState(status: string): 'open' | 'closed' {
  return status === DONE ? 'closed' : 'open';
}

/** GitHub issue state -> ztrack status: `closed` is done; `open` PRESERVES the local fine
 *  state (or `draft` for a brand-new / reopened issue, when there is no local state to keep). */
export function githubStateToStatus(state: string, existingStatus?: string): string {
  if (state === 'closed') return DONE;
  return existingStatus && existingStatus !== DONE ? existingStatus : 'draft';
}

/** A GitHub issue's identity (the synced issue IS this issue). */
export type GithubIssueRef = { id: string; number: number; repository: string };

/** A ztrack record -> the GitHub issue SyncResource the twin reconciles/pushes. */
export function recordToIssueResource(record: IssueRecord, ref: GithubIssueRef): SyncResource {
  return {
    type: 'issue',
    id: ref.id,
    fields: { number: ref.number, repository: ref.repository, title: record.title, body: record.body, state: statusToGithubState(record.status) },
  };
}

/** The fields a pulled GitHub issue overlays onto the local record. */
export type IssueSyncFields = { title: string; body: string; status: string };

/** A pulled GitHub issue SyncResource -> the fields to overlay onto the local ztrack record.
 *  `existingStatus` preserves the local fine lifecycle state for an open issue. */
export function issueResourceToRecordFields(resource: SyncResource, existingStatus?: string): IssueSyncFields {
  const f = resource.fields as { title?: unknown; body?: unknown; state?: unknown };
  return {
    title: String(f.title ?? ''),
    body: String(f.body ?? ''),
    status: githubStateToStatus(String(f.state ?? 'open'), existingStatus),
  };
}
