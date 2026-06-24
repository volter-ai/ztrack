import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { exportInTotoStatements } from './attest.ts';
import { putBlob } from './blobStore.ts';
import { optionValue } from './cliArgs.ts';
import { exportTrackerRoot } from './export.ts';
import { generateSigningKey, signStatement, verifyEnvelope, type DsseEnvelope } from './dsse.ts';
import { evidenceDir, projectRootFrom } from './config.ts';

export async function handleEvidenceCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'evidence') return false;
  if (args[1] === 'add') {
    // Ingest an evidence file: copy it (friendly-named) into the evidence dir, stamp its sha256,
    // and print the path to cite (`image=<path>`) + digest. The verification anchors to the
    // commit, so COMMIT the file (commit mode, the default) — then `git cat-file -e <sha>:<path>`
    // resolves and the gate accepts it. `--blob` keeps the old content-addressed store form.
    const filePath = optionValue(args, '--file') || args.slice(2).find((a) => !a.startsWith('--'));
    if (!filePath) throw new Error('usage: ztrack evidence add <file> [--name <name>]   (copies it into the evidence dir; cite the printed `image=<path>` in an `ac patch`, then commit it)');
    const root = projectRootFrom();
    const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
    const bytes = readFileSync(abs);
    const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (args.includes('--blob')) {
      const ext = abs.toLowerCase().split('.').pop() ?? '';
      const mediaType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : undefined;
      process.stdout.write(`${JSON.stringify({ blob: putBlob(root, new Uint8Array(bytes), mediaType) }, null, 2)}\n`);
      return true;
    }
    const dir = evidenceDir(root);
    mkdirSync(dir, { recursive: true });
    const name = optionValue(args, '--name') || basename(abs);
    const dest = join(dir, name);
    copyFileSync(abs, dest);
    const path = relative(root, dest);
    process.stdout.write(`${JSON.stringify({ path, sha256 }, null, 2)}\n`);
    process.stderr.write(`✓ stored ${path}\n  cite: image=${path}  (commit it, then it verifies at the cited commit)\n`);
    return true;
  }
  if (args[1] === 'keygen') {
    const key = generateSigningKey();
    const dir = optionValue(args, '--out-dir') || '.volter/keys';
    const base = resolve(projectRootFrom(), dir);
    mkdirSync(base, { recursive: true });
    writeFileSync(resolve(base, 'evidence-signing.pem'), key.privateKeyPem, { mode: 0o600 });
    writeFileSync(resolve(base, 'evidence-signing.pub.pem'), key.publicKeyPem);
    process.stdout.write(`${JSON.stringify({ keyid: key.keyid, privateKey: `${dir}/evidence-signing.pem`, publicKey: `${dir}/evidence-signing.pub.pem` }, null, 2)}\n`);
    return true;
  }
  if (args[1] === 'verify') {
    const bundlePath = optionValue(args, '--bundle');
    const keyPath = optionValue(args, '--key');
    if (!bundlePath || !keyPath) throw new Error('usage: tracker evidence verify --bundle envelopes.json --key public.pem');
    const publicKeyPem = readFileSync(resolve(process.cwd(), keyPath), 'utf8');
    const bundle = JSON.parse(readFileSync(resolve(process.cwd(), bundlePath), 'utf8')) as { envelopes?: DsseEnvelope[] };
    if (!Array.isArray(bundle.envelopes)) throw new Error(`bundle ${bundlePath} is missing an "envelopes" array`);
    const results = bundle.envelopes.map((envelope, index) => {
      const verdict = verifyEnvelope(envelope, publicKeyPem);
      return verdict.ok
        ? { index, ok: true, predicateType: verdict.statement.predicateType, subject: verdict.statement.subject[0] }
        : { index, ok: false, reason: verdict.reason };
    });
    const failed = results.filter((result) => !result.ok).length;
    process.stdout.write(`${JSON.stringify({ verified: results.length - failed, failed, results: failed ? results.filter((r) => !r.ok) : undefined }, null, 2)}\n`);
    process.exitCode = failed > 0 ? 1 : 0;
    return true;
  }
  if (args[1] === 'export') {
    if (optionValue(args, '--format') !== 'in-toto') throw new Error('tracker evidence export: only --format in-toto is supported');
    const projectRoot = projectRootFrom();
    const root = await exportTrackerRoot({ projectRoot });
    const issuesFilter = optionValue(args, '--issues');
    const result = exportInTotoStatements(root, issuesFilter ? { issues: issuesFilter.split(',').map((s) => s.trim()).filter(Boolean) } : {});
    const keyPath = optionValue(args, '--sign-key');
    const text = keyPath
      ? `${JSON.stringify({ envelopes: result.statements.map((statement) => signStatement(statement, readFileSync(resolve(process.cwd(), keyPath), 'utf8'), readFileSync(resolve(process.cwd(), keyPath.replace(/\.pem$/, '.pub.pem')), 'utf8'))), skipped: result.skipped }, null, 2)}\n`
      : `${JSON.stringify(result, null, 2)}\n`;
    const outPath = optionValue(args, '--out');
    if (outPath) writeFileSync(isAbsolute(outPath) ? outPath : resolve(projectRoot, outPath), text);
    else process.stdout.write(text);
    return true;
  }
  return false;
}
