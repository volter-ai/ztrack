// `ztrack tx <plan|apply>` — a multi-edit transaction over a JSON spec (apply -> re-check ->
// revert if worse; see tx.ts). Extracted from cli.ts (ZTB-28 dev/04), following the established
// verb-module pattern (cliImport.ts/cliWaiver.ts/cliLoop.ts): flag parsing + JSON I/O only,
// dispatched from cli.ts's main().
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { optionValue } from './cliArgs.ts';
import { projectRootFrom } from './config.ts';
import { applyTx, planTx, type TxEdit } from './tx.ts';

/** `ztrack tx <plan|apply> --file tx.json`. Returns true once handled. */
export async function handleTxCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'tx') return false;
  const action = args[1];
  const filePath = optionValue(args, '--file');
  if (!action || !['plan', 'apply'].includes(action) || !filePath) {
    throw new Error('usage: tracker tx <plan|apply> --file tx.json   (tx.json: {"edits": [{"issue": "A-1", "op": "check", "acId": "dev/01", ...}]}; apply accepts {"base": {...}} from a prior plan)');
  }
  const spec = JSON.parse(readFileSync(isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath), 'utf8')) as { edits: TxEdit[]; base?: Record<string, string> };
  if (action === 'plan') {
    const plan = await planTx(spec.edits);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return true;
  }
  const result = await applyTx(spec.edits, { projectRoot: projectRootFrom(), ...(spec.base ? { base: spec.base } : {}) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.committed ? 0 : 1;
  return true;
}
