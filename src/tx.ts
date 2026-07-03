// Changesets (`tracker tx`): multi-edit transactions validated against the
// POST-state. Mutually-dependent edits (check an AC + move the state, where
// neither passes alone) land atomically or not at all.
//
// Mechanics: plan (read-only) describes the edits and records base hashes;
// apply captures pre-state, verifies bases (conflict-on-stale-base), writes
// all edits, re-exports and re-runs the rulebook, and — if validation got
// WORSE (new error findings vs the pre-state baseline) — reverts every
// write by compensation and reports the would-be findings. "Atomic" is
// therefore net-zero at the record level. This module does NOT touch the audit
// log (core/audit.ts) — that log is only ever written by the visualizer server
// today (see audit.ts's top comment for why CLI paths, including this one, aren't
// wired to it), so an attempted-then-reverted tx leaves no `.audit.jsonl` trace;
// its only record is whatever the backend's own history (e.g. git, if the store
// is committed) retains.
import { createHash } from 'node:crypto';
import { checkTracker } from './check.ts';
import { loadTrackerConfig } from './config.ts';
import { viewToRecord, columnsToEdit } from './core/loader.ts';
import { applyModelPatch } from './modelEdit.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { createTrackerClient } from './sdk.ts';

export type TxEdit =
  // a typed model patch (parse -> overlay -> serialize), targeting an issue or one AC by id
  | { issue: string; op: 'patch'; ac?: string; patch: Record<string, unknown> }
  | { issue: string; op: 'set-state'; state: string }
  | { issue: string; op: 'set-body'; body: string };

export type TxPlan = {
  edits: Array<{ issue: string; op: string; detail: string }>;
  base: Record<string, string>; // issue -> sha256(body \0 state)
};

export type TxResult = {
  committed: boolean;
  plan: TxPlan;
  errorsBefore: number;
  errorsAfter: number;
  newFindings: Array<{ code: string; issue?: string; message: string }>;
  reverted: boolean;
};

type IssueState = { body: string; state: string };

function baseHash(issue: IssueState): string {
  return createHash('sha256').update(`${issue.body}\0${issue.state}`).digest('hex').slice(0, 16);
}

function editDetail(edit: TxEdit): string {
  if (edit.op === 'set-state') return `state -> ${edit.state}`;
  if (edit.op === 'set-body') return `body replaced (${edit.body.length} chars)`;
  return `patch ${edit.ac ? `ac ${edit.ac}` : 'issue'} <- ${JSON.stringify(edit.patch)}`;
}

async function readIssue(client: ReturnType<typeof createTrackerClient>, issue: string): Promise<IssueState> {
  const view = await client.issue.view(issue, { json: 'body,state' }) as Record<string, unknown>;
  return { body: String(view.body ?? ''), state: String(view.state ?? '') };
}

export async function planTx(edits: TxEdit[]): Promise<TxPlan> {
  const client = createTrackerClient();
  const base: Record<string, string> = {};
  for (const edit of edits) {
    if (!(edit.issue in base)) base[edit.issue] = baseHash(await readIssue(client, edit.issue));
  }
  return { edits: edits.map((edit) => ({ issue: edit.issue, op: edit.op, detail: editDetail(edit) })), base };
}

export async function applyTx(
  edits: TxEdit[],
  options: { projectRoot: string; base?: Record<string, string> },
): Promise<TxResult> {
  const client = createTrackerClient();
  const plan = await planTx(edits);

  // Conflict-on-stale-base: a caller-provided base (from an earlier plan)
  // must still match reality before any write.
  if (options.base) {
    for (const [issue, hash] of Object.entries(options.base)) {
      if (plan.base[issue] !== hash) {
        throw new Error(`tx conflict: ${issue} changed since the transaction was planned (stale base)`);
      }
    }
  }

  const before = await checkTracker({ projectRoot: options.projectRoot, verifyCommits: true });
  const beforeKeys = new Map<string, number>();
  for (const finding of before.findings) {
    if (finding.severity !== 'error') continue;
    const key = `${finding.code}|${finding.issueId ?? ''}`;
    beforeKeys.set(key, (beforeKeys.get(key) ?? 0) + 1);
  }

  // Capture pre-state for compensation, then apply all edits in order.
  const pre = new Map<string, IssueState>();
  for (const edit of edits) {
    if (!pre.has(edit.issue)) pre.set(edit.issue, await readIssue(client, edit.issue));
  }
  const preset = await resolveTrackerValidation(loadTrackerConfig(options.projectRoot), options.projectRoot);
  const touched = new Set<string>();
  for (const edit of edits) {
    const current = await readIssue(client, edit.issue);
    if (edit.op === 'set-state') {
      await client.issue.edit(edit.issue, { state: edit.state });
    } else if (edit.op === 'set-body') {
      await client.issue.edit(edit.issue, { body: edit.body });
    } else {
      const view = await client.issue.view(edit.issue, { json: 'identifier,title,state,stateType,assignee,labels,children,body' });
      const record = viewToRecord(view as Record<string, unknown>, edit.issue);
      const result = applyModelPatch(preset, record, { ...(edit.ac ? { acId: edit.ac } : {}), patch: edit.patch });
      await client.issue.edit(edit.issue, columnsToEdit(result.body, result.columns, record));
    }
    touched.add(edit.issue);
  }

  const after = await checkTracker({ projectRoot: options.projectRoot, verifyCommits: true });
  const newFindings: TxResult['newFindings'] = [];
  const afterKeys = new Map<string, number>();
  for (const finding of after.findings) {
    if (finding.severity !== 'error') continue;
    const key = `${finding.code}|${finding.issueId ?? ''}`;
    afterKeys.set(key, (afterKeys.get(key) ?? 0) + 1);
    if ((afterKeys.get(key) ?? 0) > (beforeKeys.get(key) ?? 0)) {
      newFindings.push({ code: finding.code, ...(finding.issueId ? { issue: finding.issueId } : {}), message: finding.message });
    }
  }

  const errorsBefore = before.findings.filter((finding) => finding.severity === 'error').length;
  const errorsAfter = after.findings.filter((finding) => finding.severity === 'error').length;
  if (newFindings.length > 0) {
    // Revert by compensation, newest-first.
    for (const issue of [...touched].reverse()) {
      const prior = pre.get(issue)!;
      await client.issue.edit(issue, { body: prior.body, state: prior.state });
    }
    return { committed: false, plan, errorsBefore, errorsAfter, newFindings, reverted: true };
  }
  return { committed: true, plan, errorsBefore, errorsAfter, newFindings: [], reverted: false };
}
