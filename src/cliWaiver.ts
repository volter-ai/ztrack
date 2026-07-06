import { git } from './core/gitWorld.ts';
import { projectRootFrom } from './config.ts';
import { createTrackerClient } from './sdk.ts';
import { optionValue } from './cliArgs.ts';
import { commandName } from './cliHelp.ts';
import { statusMark, ui } from './cliStyle.ts';
import { checkTracker } from './check.ts';
import { parseWaiverLine, type Finding } from './core/engine.ts';

// The issue's `## Waivers` section is a list of located waiver directives, one per row:
// `- code: <finding-code> [ac: <acId>] [ref: <subject>] reason: <text> by: <signer>` (parsed
// identically by the core in engine.parseWaivers). `ref` pins the waiver to ONE finding
// occurrence (its `subject`/`evidenceId`) — the `// eslint-disable-next-line` form — so it can
// suppress only that occurrence. These helpers read/strip/re-render the section.
type WaiverRow = { code: string; acId?: string; ref?: string; reason: string; approvedBy: string };
function parseWaiverRows(body: string): WaiverRow[] {
  const m = /(?:^|\n)##\s+waivers\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(body);
  if (!m) return [];
  const rows: WaiverRow[] = [];
  for (const line of m[1]!.split('\n')) {
    // Parse via the core's single source of truth so `status`/`migrate` split reason/signer exactly
    // as `check` does — in particular the LAST-`by:` split, so a reason containing "by:" is not
    // truncated and the real signer is not mis-attributed.
    const parsed = parseWaiverLine(line);
    if (parsed) rows.push(parsed);
  }
  return rows;
}
function stripWaiversSection(body: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of body.split('\n')) {
    if (/^##\s+waivers\b/i.test(line)) { skipping = true; continue; }
    if (skipping && /^##\s+/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
function renderRow(w: WaiverRow): string {
  return `- code: ${w.code}${w.acId ? ` ac: ${w.acId}` : ''}${w.ref ? ` ref: ${w.ref}` : ''} reason: ${w.reason} by: ${w.approvedBy}`;
}
function withWaivers(body: string, rows: WaiverRow[]): string {
  const base = stripWaiversSection(body);
  if (!rows.length) return `${base}\n`;
  return `${base}\n\n## Waivers\n\n${rows.map(renderRow).join('\n')}\n`;
}

// Findings whose (issue, code, ac) a waiver would accept AND that carry a distinct `subject` —
// the occurrences a `ref:` pin can name. Both 'error' (firing) and 'acknowledged' (already
// downgraded by an existing broad waiver) count, so `sign`/`migrate` see every occurrence.
function subjectOccurrences(findings: Finding[], issueId: string, code: string, acId?: string): Array<{ subject: string; acId?: string }> {
  const seen = new Set<string>();
  const out: Array<{ subject: string; acId?: string }> = [];
  for (const f of findings) {
    if (f.issueId !== issueId || f.code !== code) continue;
    if (acId !== undefined && f.acId !== acId) continue;
    if (f.subject === undefined) continue;
    const key = `${f.acId ?? ''}\x1f${f.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ subject: f.subject, ...(f.acId ? { acId: f.acId } : {}) });
  }
  return out;
}

/** `ztrack waiver sign|clear|status|migrate` — the eslint-`disable`-style escape: an authority
 *  acknowledges ONE specific check finding (by code, optionally an AC, optionally pinned to one
 *  occurrence with `ref:`). The core downgrades the matching finding to 'acknowledged'; a waiver
 *  matching nothing is `waiver_unused`; an unpinned waiver that could pin is `waiver_overbroad`.
 *  Returns true once it has handled the `waiver` command. */
export async function handleWaiverCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'waiver') return false;
  const command = commandName();
  const action = args[1];
  // `--help` must be a TOTAL function (no tracker config loaded) like every other verb's — checked
  // BEFORE `projectRootFrom()` below (which throws with no config), so `ztrack waiver --help` works
  // in an uninitialized repo instead of erroring on the wrong thing.
  if (!action || ['--help', '-h', 'help'].includes(action)) {
    process.stdout.write(`Usage: ${command} waiver <sign <issue> --code <finding-code> [--ac <acId>] [--ref <subject>] --reason "..." | clear <issue> [--code <code>] | status <issue> | migrate <issue> | migrate --all>\n\nAcknowledges ONE check finding (by its code) on <issue>, signed as your git identity, in the issue's \`## Waivers\` section. \`--ref <subject>\` pins the waiver to a single occurrence (the offending value, e.g. a commit sha) — the \`// eslint-disable-next-line\` form; \`sign\` auto-captures it when the finding is unambiguous. An unpinned waiver that could be pinned is reported \`waiver_overbroad\`; one that matches nothing is \`waiver_unused\`. \`migrate\` rewrites legacy unpinned waivers into per-occurrence pinned rows. Prefer fixing the issue — waive only a finding you knowingly accept.\n`);
    return true;
  }
  const projectRoot = projectRootFrom();
  const id = args[2];
  const migrateAll = action === 'migrate' && args.includes('--all');
  if (!migrateAll && (!id || id.startsWith('-'))) throw new Error(`${command} waiver ${action}: needs an issue id, e.g. \`${command} waiver ${action} APP-1\`${action === 'migrate' ? ` (or \`${command} waiver migrate --all\`)` : ''}`);
  const wClient = createTrackerClient();

  if (action === 'sign') {
    const issueView = await wClient.issue.view(id, { json: 'body' });
    const body = String((issueView as Record<string, unknown>).body ?? '');
    const rows = parseWaiverRows(body);
    const reason = optionValue(args, '--reason');
    const code = optionValue(args, '--code');
    // optionValue returns '' for an absent flag — coalesce to undefined so "issue-level" (no ac)
    // and "unpinned" (no ref) are represented consistently everywhere downstream.
    const acId = optionValue(args, '--ac') || undefined;
    let ref = optionValue(args, '--ref') || undefined;
    if (!code) throw new Error(`${command} waiver sign: --code <finding-code> is required — the check finding you are accepting (e.g. evidence_commit_not_found).`);
    if (!reason) throw new Error(`${command} waiver sign: --reason "<why this failing state is acceptable>" is required`);
    // Pin precisely by default: if the accepted (code, ac) resolves to exactly one occurrence,
    // capture its subject as `ref` automatically; if several, make the signer choose one.
    if (!ref) {
      const occ = subjectOccurrences((await checkTracker({ projectRoot, verifyCommits: true })).findings, id, code, acId);
      if (occ.length === 1) { ref = occ[0]!.subject; }
      else if (occ.length > 1) throw new Error(`${command} waiver sign: '${code}'${acId ? ` (${acId})` : ''} on ${id} has ${occ.length} distinct occurrences (${occ.map((o) => `${o.subject}${o.acId ? ` on ${o.acId}` : ''}`).join(', ')}). Pin one with --ref <subject>${acId ? '' : ' (add --ac <acId> if the same subject recurs across ACs)'}, or \`${command} waiver migrate ${id}\` to pin them all.`);
      // occ.length === 0 → this code carries no subject; an unpinned waiver is correct.
    }
    const gitName = git(projectRoot, ['config', 'user.name']);
    const gitEmail = git(projectRoot, ['config', 'user.email']);
    // `Name (email)`, not git's `Name <email>` — angle brackets get mangled by the markdown
    // round-trip; parens survive. The signer is the git identity (authors commits too).
    const approvedBy = gitName && gitEmail ? `${gitName} (${gitEmail})` : (gitName || gitEmail);
    if (!approvedBy) throw new Error(`${command} waiver sign: no git identity configured. Set one (\`git config user.name\` / \`user.email\`) — a waiver must record who signed it.`);
    const next = rows.filter((w) => !(w.code === code && (w.acId ?? '') === (acId ?? '') && (w.ref ?? '') === (ref ?? '')));  // replace a same code+ac+ref waiver
    next.push({ code, reason, approvedBy, ...(acId ? { acId } : {}), ...(ref ? { ref } : {}) });
    await wClient.issue.edit(id, { body: withWaivers(body, next) });
    process.stdout.write(`${statusMark('pass')} ${ui.green('waiver signed')} ${ui.dim(`→ ${id}${acId ? ` (${acId})` : ''}${ref ? ` [ref ${ref}]` : ''} for '${code}' by ${approvedBy}. Honored only while it matches a finding — otherwise check reports waiver_unused.`)}\n`);
    return true;
  }

  if (action === 'clear') {
    const issueView = await wClient.issue.view(id, { json: 'body' });
    const body = String((issueView as Record<string, unknown>).body ?? '');
    const rows = parseWaiverRows(body);
    const code = optionValue(args, '--code');
    const next = code ? rows.filter((w) => w.code !== code) : [];
    await wClient.issue.edit(id, { body: withWaivers(body, next) });
    process.stdout.write(`${statusMark('pass')} ${ui.dim(code ? `waiver for '${code}' cleared on ${id}` : `all waivers cleared on ${id}`)}\n`);
    return true;
  }

  if (action === 'status') {
    const issueView = await wClient.issue.view(id, { json: 'body' });
    const body = String((issueView as Record<string, unknown>).body ?? '');
    const rows = parseWaiverRows(body);
    if (!rows.length) { process.stdout.write(`${statusMark('info')} ${ui.dim(`${id} has no waivers`)}\n`); return true; }
    // Correlate against a live check so each row's state (fires / unused / overbroad) is honest.
    const findings = (await checkTracker({ projectRoot, verifyCommits: true })).findings;
    const overbroad = findings.some((f) => f.code === 'waiver_overbroad' && f.issueId === id);
    const unused = new Set(findings.filter((f) => f.code === 'waiver_unused' && f.issueId === id).map((f) => f.acId ?? ''));
    const state = (w: WaiverRow): string => {
      if (unused.has(w.acId ?? '') && !w.ref) return ui.yellow('unused?');
      return ui.green('active');
    };
    const lines = rows.map((w) => `  ${state(w)} ${ui.dim(`${w.code}${w.acId ? ` (${w.acId})` : ''}${w.ref ? ` [ref ${w.ref}]` : ' [unpinned]'} — ${w.reason} [${w.approvedBy}]`)}`);
    const hint = overbroad ? `\n  ${ui.yellow('⚠ some waivers are unpinned (waiver_overbroad)')} ${ui.dim(`— run \`${command} waiver migrate ${id}\` to pin them to one occurrence each.`)}` : '';
    process.stdout.write(`${statusMark('info')} ${ui.bold(`${id} carries ${rows.length} waiver${rows.length === 1 ? '' : 's'}`)}\n${lines.join('\n')}${hint}\n`);
    return true;
  }

  if (action === 'migrate') {
    // Rewrite legacy unpinned waivers into fingerprinted per-occurrence rows: one pinned row per
    // distinct subject the waiver currently suppresses. Idempotent (already-pinned rows untouched),
    // reason + signer preserved. `--all` migrates every issue that carries waivers.
    const result = await checkTracker({ projectRoot, verifyCommits: true });
    const findings = result.findings;
    const targetIds = migrateAll ? (result.export?.issues ?? []).map((i) => i.id) : [id!];
    let migratedIssues = 0; let addedRows = 0;
    for (const issueId of targetIds) {
      const view = await wClient.issue.view(issueId, { json: 'body' });
      const body = String((view as Record<string, unknown>).body ?? '');
      const rows = parseWaiverRows(body);
      if (!rows.length) continue;
      const next: WaiverRow[] = [];
      const seen = new Set<string>();
      let changed = false;
      for (const row of rows) {
        if (row.ref) { next.push(row); continue; }  // already pinned — leave it
        const occ = subjectOccurrences(findings, issueId, row.code, row.acId);
        if (!occ.length) { next.push(row); continue; }  // nothing subject-bearing to pin
        changed = true;
        for (const o of occ) {
          const key = `${row.code}\x1f${o.acId ?? row.acId ?? ''}\x1f${o.subject}`;
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({ code: row.code, reason: row.reason, approvedBy: row.approvedBy, ...((o.acId ?? row.acId) ? { acId: o.acId ?? row.acId } : {}), ref: o.subject });
          addedRows++;
        }
      }
      if (changed) { await wClient.issue.edit(issueId, { body: withWaivers(body, next) }); migratedIssues++; }
    }
    process.stdout.write(migratedIssues
      ? `${statusMark('pass')} ${ui.green(`migrated ${migratedIssues} issue${migratedIssues === 1 ? '' : 's'}`)} ${ui.dim(`→ ${addedRows} pinned per-occurrence waiver${addedRows === 1 ? '' : 's'}. Re-run \`${command} check\` — the same findings stay acknowledged, now with zero waiver_overbroad.`)}\n`
      : `${statusMark('info')} ${ui.dim(`nothing to migrate${migrateAll ? '' : ` on ${id}`} — no unpinned waiver names a subject-bearing finding.`)}\n`);
    return true;
  }

  throw new Error(`${command} waiver: unknown action '${action}'. Try 'sign <issue> --code <code> --reason "..."', 'clear <issue> [--code <code>]', 'status <issue>', or 'migrate <issue>|--all'.`);
}
