// `ztrack fmt` — canonicalize an issue body (or standalone file) through the active preset's
// `serialize`, either printing the canonical form, checking whether it's already canonical
// (`--check`), or writing it back (`--write`). Extracted from cli.ts (ZTB-28 dev/04), following
// the established verb-module pattern (cliImport.ts/cliWaiver.ts/cliLoop.ts): flag parsing +
// terminal rendering only, dispatched from cli.ts's main().
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { optionValue } from './cliArgs.ts';
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { viewToRecord, columnsToEdit } from './core/loader.ts';
import type { IssueRecord } from './core/engine.ts';
import { canonicalizeBody } from './modelEdit.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { createTrackerClient } from './sdk.ts';

/** `ztrack fmt [--input file | --issue id] [--write | --check]`. Returns true once handled. */
export async function handleFmtCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'fmt') return false;
  const inputPath = optionValue(args, '--input');
  const issueId = optionValue(args, '--issue');
  const write = args.includes('--write');
  const checkOnly = args.includes('--check');
  const projRoot = projectRootFrom();
  const preset = await resolveTrackerValidation(loadTrackerConfig(projRoot), projRoot);
  const fmtClient = (issueId !== '') ? createTrackerClient() : null;
  let record: IssueRecord;
  // A standalone --input file's EOL is a file-boundary concern: canonicalize in LF space and
  // restore the file's own EOL on write, so a CRLF (Windows/autocrlf) file that is canonical
  // modulo line endings reads as canonical instead of failing --check forever.
  let inputHadCrlf = false;
  if (inputPath) {
    // a standalone file carries no columns; canonicalize the body content with a placeholder
    const rawBody = readFileSync(isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath), 'utf8');
    inputHadCrlf = rawBody.includes('\r\n');
    record = { id: 'fmt', title: 'fmt', status: 'draft', body: rawBody.replace(/\r\n?/g, '\n') };
  } else if (issueId) {
    const issue = await fmtClient!.issue.view(issueId, { json: 'identifier,title,state,stateType,assignee,labels,children,body' });
    record = viewToRecord(issue as Record<string, unknown>, issueId);
  } else {
    throw new Error("tracker fmt: provide --issue <id> or --input <file> (plus --write to apply, --check to verify)");
  }
  const result = canonicalizeBody(preset, record);
  const canonical = result.body === record.body;
  if (checkOnly) {
    process.stdout.write(canonical ? 'canonical\n' : 'NOT canonical (run ztrack fmt --write)\n');
    process.exitCode = canonical ? 0 : 1;
    return true;
  }
  if (write) {
    if (canonical) { process.stdout.write('already canonical\n'); return true; }
    if (issueId) {
      await fmtClient!.issue.edit(issueId, columnsToEdit(result.body, result.columns, record));
      process.stdout.write(`formatted ${issueId}\n`);
    } else {
      const out = inputHadCrlf ? result.body.replace(/\n/g, '\r\n') : result.body;
      writeFileSync(isAbsolute(inputPath!) ? inputPath! : resolve(process.cwd(), inputPath!), out);
      process.stdout.write(`formatted ${inputPath}\n`);
    }
    return true;
  }
  process.stdout.write(result.body);
  return true;
}
