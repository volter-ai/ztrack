import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { exportInTotoStatements } from './attest.ts';
import { putBlob } from './blobStore.ts';
import { optionValue } from './cliArgs.ts';
import { canonicalizeIssueMarkdown } from './markdownModel.ts';
import { exportTrackerSnapshot } from './export.ts';
import { generateSigningKey, signStatement, verifyEnvelope, type DsseEnvelope } from './dsse.ts';
import { addEvidenceEntry, type EvidenceSpec } from './mutate.ts';
import { projectRootFrom } from './config.ts';
import type { TrackerClient } from './types.ts';

export async function handleEvidenceCommand(args: string[], client: TrackerClient): Promise<boolean> {
  if (args[0] !== 'evidence') return false;
  if (args[1] === 'add') {
    const issueId = args[2];
    const type = optionValue(args, '--type');
    if (!issueId || !/^[a-z][a-z0-9-]*$/i.test(type)) throw new Error('usage: tracker evidence add <issue> --type <kind>');
    const issue = await client.issue.view(issueId, { json: 'body' });
    const body = String((issue as Record<string, unknown>).body ?? '');
    const filePath = optionValue(args, '--file');
    let blobRef = '';
    if (filePath && !args.includes('--dry-run')) {
      const abs = isAbsolute(filePath) ? filePath : resolve(projectRootFrom(), filePath);
      const bytes = readFileSync(abs);
      const ext = abs.toLowerCase().split('.').pop() ?? '';
      const mediaType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : undefined;
      blobRef = putBlob(projectRootFrom(), new Uint8Array(bytes), mediaType);
    }
    const spec: EvidenceSpec = {
      type,
      ...(optionValue(args, '--ac') ? { ac: optionValue(args, '--ac') } : {}),
      ...(optionValue(args, '--repo') ? { repo: optionValue(args, '--repo') } : {}),
      ...(optionValue(args, '--number') ? { number: optionValue(args, '--number') } : {}),
      ...(optionValue(args, '--head') ? { head: optionValue(args, '--head') } : {}),
      ...(optionValue(args, '--state') ? { state: optionValue(args, '--state') } : {}),
      ...(optionValue(args, '--path') ? { path: optionValue(args, '--path') } : {}),
      ...(optionValue(args, '--url') ? { url: optionValue(args, '--url') } : {}),
      ...(blobRef ? { blob: blobRef } : {}),
      ...(optionValue(args, '--status') ? { status: optionValue(args, '--status') } : {}),
      ...(optionValue(args, '--justification') ? { justification: optionValue(args, '--justification') } : {}),
    };
    const result = addEvidenceEntry(body, spec);
    if (!args.includes('--dry-run')) await client.issue.edit(issueId, { body: result.body });
    process.stdout.write(`${JSON.stringify({ issue: issueId, evidenceId: result.evidenceId, dryRun: args.includes('--dry-run') }, null, 2)}\n`);
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
    const bundle = JSON.parse(readFileSync(resolve(process.cwd(), bundlePath), 'utf8')) as { envelopes: DsseEnvelope[] };
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
  if (args[1] === 'ingest') {
    const bundlePath = optionValue(args, '--bundle');
    const keyPath = optionValue(args, '--key');
    const issueId = optionValue(args, '--issue');
    if (!bundlePath || !keyPath || !issueId) throw new Error('usage: tracker evidence ingest --bundle envelopes.json --key public.pem --issue A-1 [--ac ac/01]');
    const publicKeyPem = readFileSync(resolve(process.cwd(), keyPath), 'utf8');
    const bundle = JSON.parse(readFileSync(resolve(process.cwd(), bundlePath), 'utf8')) as { envelopes: DsseEnvelope[] };
    const acId = optionValue(args, '--ac');
    const issue = await client.issue.view(issueId, { json: 'body' });
    let body = String((issue as Record<string, unknown>).body ?? '');
    let nextId = Math.max(0, ...[...body.matchAll(/^\s*\[E(\d+)\]/gm)].map((match) => Number(match[1]))) + 1;
    const ingested: Array<Record<string, unknown>> = [];
    const rejected: Array<Record<string, unknown>> = [];
    for (const envelope of bundle.envelopes) {
      const verdict = verifyEnvelope(envelope, publicKeyPem);
      if (!verdict.ok) { rejected.push({ reason: verdict.reason }); continue; }
      const statement = verdict.statement;
      const sha = String(statement.subject[0]?.digest?.gitCommit ?? statement.subject[0]?.digest?.gitCommitAbbrev ?? '');
      const predicate = statement.predicate as Record<string, any>;
      const result = String(predicate.result ?? predicate.outcome ?? '');
      const summary = String(predicate.summary ?? statement.predicateType.split('/').slice(-2, -1)[0] ?? 'attested evidence');
      const entryId = `E${nextId++}`;
      const acField = acId || (predicate.claims?.[0]?.acId ?? '');
      const line = `[${entryId}] type: other sha: ${sha}${acField ? ` ac: ${acField}` : ''} justification: ${summary} (signed attestation ${statement.predicateType}, verified keyid ${verdict.keyid}${result ? `, result: ${result}` : ''})`;
      body = /## Evidence/.test(body) ? body.replace(/## Evidence\n/, `## Evidence\n\n${line}\n`) : `${body.replace(/\n+$/, '')}\n\n## Evidence\n\n${line}\n`;
      ingested.push({ entryId, sha, predicateType: statement.predicateType, keyid: verdict.keyid });
    }
    if (ingested.length > 0) await client.issue.edit(issueId, { body: canonicalizeIssueMarkdown(body) });
    process.stdout.write(`${JSON.stringify({ issue: issueId, ingested, rejected }, null, 2)}\n`);
    process.exitCode = rejected.length > 0 && ingested.length === 0 ? 1 : 0;
    return true;
  }
  if (args[1] === 'export') {
    if (optionValue(args, '--format') !== 'in-toto') throw new Error('tracker evidence export: only --format in-toto is supported');
    const projectRoot = projectRootFrom();
    const snapshot = exportTrackerSnapshot({ projectRoot });
    const issuesFilter = optionValue(args, '--issues');
    const result = exportInTotoStatements(snapshot, issuesFilter ? { issues: issuesFilter.split(',').map((s) => s.trim()).filter(Boolean) } : {});
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
