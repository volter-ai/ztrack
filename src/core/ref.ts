// Universal node addressing — one colon-delimited path that uniquely names any node
// in the validated root: an issue, an acceptance criterion, a piece of evidence, or a
// proof.
//
//   <issue>                    an issue                e.g. APP-1
//   <issue>:<ac>               an acceptance criterion e.g. APP-1:dev/01
//   <issue>:<ac>:<evidence>    a piece of evidence     e.g. APP-1:dev/01:E1
//   <issue>:<ac>:proof         an AC's proof           e.g. APP-1:dev/01:proof
//
// The universal id is DERIVED from a node's position — it is never stored as a field
// (that would be a second source of truth, which the one-model contract forbids). Ids
// themselves never contain ':' (the backend SAFE_ID and the AC-id grammar exclude it),
// so ':' is an unambiguous separator at every level.
//
// Cross-references (AC/issue blocking) address nodes RELATIVELY by default and
// absolutely only when they must escape their scope: inside issue I, the bare AC ref
// `dev/02` means `I:dev/02`; to point at another issue you qualify it. Resolution lives
// in core/blocking.ts (it needs the whole tracker to tell an issue ref from an AC ref).

import { z } from 'zod';
import type { Finding } from './engine.ts';

export const REF_DELIM = ':';
export const PROOF_LEAF = 'proof';

export interface NodeRef {
  issue: string;
  ac?: string;
  evidence?: string;
  proof?: boolean;
}

/** The universal id for a node: its absolute colon-delimited path. An issue ref
 *  (`ac` omitted) prints as just the issue id. */
export function formatRef(ref: NodeRef): string {
  const parts: string[] = [ref.issue];
  if (ref.ac !== undefined) parts.push(ref.ac);
  if (ref.proof) parts.push(PROOF_LEAF);
  else if (ref.evidence !== undefined) parts.push(ref.evidence);
  return parts.join(REF_DELIM);
}

/** Split a ref string into its trimmed, non-empty segments. */
export function refSegments(refStr: string): string[] {
  return refStr.split(REF_DELIM).map((s) => s.trim()).filter(Boolean);
}

/** The universal id of the node a finding points at (issue / ac / evidence). */
export function findingId(f: Finding): string | undefined {
  return f.issueId ? formatRef({ issue: f.issueId, ac: f.acId, evidence: f.evidenceId }) : undefined;
}

/** The strict schema for a stored (resolved) block reference: a whole issue (`ac`
 *  omitted) or a specific acceptance criterion. Presets compose this into their AC
 *  schema for the `blockedBy` / `blocks` blocking primitive. */
export const BlockRefSchema = z.object({ issue: z.string().min(1), ac: z.string().min(1).optional() }).strict();
