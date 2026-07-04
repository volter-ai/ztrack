// `ztrack ac patch <issue> <acId> --json '{...}'` / `ztrack issue patch <issue> --json '{...}'` —
// the one model edit: parse -> overlay a typed fragment -> validate -> serialize (modelEdit.ts).
// The patch fields are the active preset's SCHEMA shape (run `issue view` to see it); the preset
// owns the grammar and renders it. The claim is then verified by `ztrack check`. Extracted from
// cli.ts (ZTB-28 dev/04), following the established verb-module pattern (cliImport.ts/
// cliWaiver.ts/cliLoop.ts): flag parsing + dispatch only, dispatched from cli.ts's main().
import { optionValue } from './cliArgs.ts';
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { viewToRecord, columnsToEdit } from './core/loader.ts';
import { applyModelPatch } from './modelEdit.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { createTrackerClient } from './sdk.ts';

/** `ztrack ac patch <issue> <acId> --json '{...}'` / `ztrack issue patch <issue> --json '{...}'`
 *  [--dry-run]. Returns true once handled. */
export async function handlePatchCommand(args: string[]): Promise<boolean> {
  if ((args[0] !== 'ac' && args[0] !== 'issue') || args[1] !== 'patch') return false;
  const isAc = args[0] === 'ac';
  const issueId = args[2];
  const acId = isAc ? args[3] : undefined;
  const json = optionValue(args, '--json');
  if (!issueId || (isAc && !acId) || !json) {
    throw new Error(isAc
      ? "usage: tracker ac patch <issue> <acId> --json '{...}'  (fields = the preset's AC schema shape; see `issue view`)"
      : "usage: tracker issue patch <issue> --json '{...}'  (fields = the preset's issue schema shape; see `issue view`)");
  }
  let patch: Record<string, unknown>;
  try { patch = JSON.parse(json) as Record<string, unknown>; }
  catch { throw new Error('tracker patch: --json must be valid JSON'); }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('tracker patch: --json must be a JSON object (the preset schema fields to overlay)');
  }
  const client = createTrackerClient();
  const issue = await client.issue.view(issueId, { json: 'identifier,title,state,stateType,assignee,labels,children,body' });
  const record = viewToRecord(issue as Record<string, unknown>, issueId);
  const root = projectRootFrom();
  const preset = await resolveTrackerValidation(loadTrackerConfig(root), root);
  const result = applyModelPatch(preset, record, { ...(acId ? { acId } : {}), patch });
  if (!args.includes('--dry-run') && result.changed) await client.issue.edit(issueId, columnsToEdit(result.body, result.columns, record));
  process.stdout.write(`${JSON.stringify({ issue: issueId, ...(acId ? { acId } : {}), changed: result.changed, dryRun: args.includes('--dry-run') }, null, 2)}\n`);
  return true;
}
