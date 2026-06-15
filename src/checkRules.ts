export type RuleCategory = 'wellformed' | 'sourced' | 'code' | 'visual' | 'behavioral';
export type RuleDepth = 1 | 2 | 3;
export const RULE_CATEGORIES: RuleCategory[] = ['wellformed', 'sourced', 'code', 'visual', 'behavioral'];
export const CATEGORY_MAX_DEPTH: Record<RuleCategory, RuleDepth> = { wellformed: 1, sourced: 3, code: 3, visual: 2, behavioral: 2 };

export type RuleProfile = string;
export const RULE_PROFILES: RuleProfile[] = ['lifecycle'];

export type RuleClassification = { category: RuleCategory; depth: RuleDepth } | { profile: RuleProfile };

const C = (category: RuleCategory, depth: RuleDepth): RuleClassification => ({ category, depth });
const W: RuleClassification = { category: 'wellformed', depth: 1 };
const P = (profile: RuleProfile): RuleClassification => ({ profile });

const RULE_EXACT: Record<string, RuleClassification> = {
  snapshot_shape_invalid: W,
  export_shape_invalid: W,
  custom: W,
  ac_missing_status: W,
  ac_checkbox_status_mismatch: W,
  unrecognized_lifecycle_state: W,
  unchecked_ac_has_resolution_evidence: W,
  ac_evidence_ref_missing: W,
  ac_proof_ref_missing: W,
  evidence_pr_missing_fields: W,
  dev_work_not_verified: W,
  checked_ac_in_unmapped_section: W,
  case_ac_missing_source_marker: C('sourced', 1),
  case_ac_source_missing: C('sourced', 1),
  external_ac_missing_source_marker: C('sourced', 1),
  case_issue_missing_source_section: C('sourced', 1),
  ac_quote_missing_from_issue_source: C('sourced', 1),
  quote_not_found_in_issue_source: C('sourced', 1),
  ac_not_linked_to_matching_source: C('sourced', 1),
  case_source_not_atomic: C('sourced', 1),
  case_source_claimed_annotation_missing: C('sourced', 2),
  case_source_unlinked: C('sourced', 2),
  source_annotation_unreferenced: C('sourced', 2),
  quote_not_in_raw_message: C('sourced', 2),
  message_book_malformed: C('sourced', 3),
  message_unannotated: C('sourced', 3),
  checked_dev_ac_missing_commit_hash: C('code', 1),
  dev_ac_missing_evidence_or_proof_ref: C('code', 1),
  checked_dev_ac_commit_hash_missing: C('code', 2),
  checked_dev_ac_missing_pr_evidence: C('code', 2),
  case_pr_state_conflict: C('code', 2),
  evidence_missing_sha: C('code', 3),
  evidence_commit_hash_missing: C('code', 3),
  evidence_sha_mismatch_current_head: C('code', 3),
  evidence_missing_ac_version: C('code', 3),
  evidence_ac_version_mismatch_current_ac: C('code', 3),
  checked_dev_ac_missing_ac_version: C('code', 3),
  checked_dev_ac_version_stale: C('code', 3),
  proof_missing_sha: C('code', 3),
  proof_commit_hash_missing: C('code', 3),
  proof_sha_mismatch_current_head: C('code', 3),
  proof_missing_ac_version: C('code', 3),
  proof_ac_version_mismatch_current_ac: C('code', 3),
  approval_missing_evidence_ref: C('code', 3),
  approval_missing_approved_sha: C('code', 3),
  approval_stale_after_pr_head_change: C('code', 3),
  approval_missing_approved_evidence: C('code', 3),
  approval_unknown_approved_evidence: C('code', 3),
  approval_missing_approved_ac_version: C('code', 3),
  approval_stale_after_ac_change: C('code', 3),
  approval_missing_current_dev_ac_evidence: C('code', 3),
  checked_ac_missing_uploaded_evidence: C('visual', 1),
  evidence_missing_justification: C('visual', 2),
  checked_ac_references_failed_video_evidence: C('behavioral', 1),
  develop_state_requires_dev_ac: P('lifecycle'),
  done_state_requires_dev_ac: P('lifecycle'),
  done_issue_has_unchecked_ac: P('lifecycle'),
  done_unchecked_case_ac: P('lifecycle'),
  review_state_unchecked_dev_ac: P('lifecycle'),
  review_state_unpassed_dev_ac: P('lifecycle'),
  review_state_dev_ac_missing_evidence: P('lifecycle'),
  review_state_requires_pr: P('lifecycle'),
  delivery_candidate_has_unchecked_ac: P('lifecycle'),
  delivery_candidate_missing_pr: P('lifecycle'),
  merged_case_has_unchecked_dev_ac: P('lifecycle'),
  case_missing_assignee: P('lifecycle'),
  case_invalid_assignee: P('lifecycle'),
};

const RULE_PREFIXES: Array<[string, RuleClassification]> = [
  ['annotation_', C('sourced', 3)],
  ['case_source_annotation_', C('sourced', 2)],
  ['approval_', C('code', 3)],
  ['evidence_video_', W],
  ['evidence_screenshot_', W],
  ['evidence_entry_', W],
  ['proof_entry_', W],
];

export function classifyRuleCode(code: string): RuleClassification & { explicit: boolean } {
  const exact = RULE_EXACT[code];
  if (exact) return { ...exact, explicit: true };
  for (const [prefix, classification] of RULE_PREFIXES) {
    if (code.startsWith(prefix)) return { ...classification, explicit: true };
  }
  return { category: 'wellformed', depth: 1, explicit: false };
}
