import { git } from './core/gitWorld.ts';
import { projectRootFrom } from './config.ts';
import { createTrackerClient } from './sdk.ts';
import { optionValue } from './cliArgs.ts';
import { commandName } from './cliHelp.ts';
import { statusMark, ui } from './cliStyle.ts';

// The issue's `## Waivers` section is a list of located waiver directives, one per row:
// `- code: <finding-code> [ac: <acId>] reason: <text> by: <signer>` (parsed identically by the
// core in engine.parseWaivers). These helpers read/strip/re-render it for `waiver sign|clear`.
type WaiverRow = { code: string; acId?: string; reason: string; approvedBy: string };
function parseWaiverRows(body: string): WaiverRow[] {
  const m = /(?:^|\n)##\s+waivers\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(body);
  if (!m) return [];
  const rows: WaiverRow[] = [];
  for (const line of m[1]!.split('\n')) {
    const code = /\bcode:\s*([A-Za-z0-9_]+)/i.exec(line)?.[1];
    if (!code) continue;
    const acId = /\bac:\s*(\S+)/i.exec(line)?.[1];
    const reason = /\breason:\s*(.+?)\s*(?=\s+by:|$)/i.exec(line)?.[1]?.trim() ?? '';
    const approvedBy = /\bby:\s*(.+?)\s*$/i.exec(line)?.[1]?.trim() ?? '';
    rows.push({ code, reason, approvedBy, ...(acId ? { acId } : {}) });
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
function withWaivers(body: string, rows: WaiverRow[]): string {
  const base = stripWaiversSection(body);
  if (!rows.length) return `${base}\n`;
  const render = (w: WaiverRow) => `- code: ${w.code}${w.acId ? ` ac: ${w.acId}` : ''} reason: ${w.reason} by: ${w.approvedBy}`;
  return `${base}\n\n## Waivers\n\n${rows.map(render).join('\n')}\n`;
}

/** `ztrack waiver sign|clear|status` — the eslint-`disable`-style escape: an authority acknowledges
 *  ONE specific check finding (by code, optionally scoped to an AC) in the issue's `## Waivers`
 *  section. The core downgrades the matching finding to 'acknowledged'; a waiver matching nothing is
 *  reported (`waiver_unused`). Returns true once it has handled the `waiver` command. */
export async function handleWaiverCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'waiver') return false;
  const command = commandName();
  const action = args[1];
  const projectRoot = projectRootFrom();
  if (!action || ['--help', '-h', 'help'].includes(action)) {
    process.stdout.write(`Usage: ${command} waiver <sign <issue> --code <finding-code> [--ac <acId>] --reason "..." | clear <issue> [--code <code>] | status <issue>>\n\nAcknowledges ONE check finding (by its code) on <issue>, signed off as your git identity, in the issue's \`## Waivers\` section. The core downgrades that finding to 'acknowledged' so \`${command} check\` passes; a waiver that matches no finding is reported (\`waiver_unused\`). Prefer fixing the issue — waive only a finding you knowingly accept.\n`);
    return true;
  }
  const id = args[2];
  if (!id || id.startsWith('-')) throw new Error(`${command} waiver ${action}: needs an issue id, e.g. \`${command} waiver ${action} APP-1\``);
  const wClient = createTrackerClient();
  const issueView = await wClient.issue.view(id, { json: 'body' });
  const body = String((issueView as Record<string, unknown>).body ?? '');
  const rows = parseWaiverRows(body);
  if (action === 'sign') {
    const reason = optionValue(args, '--reason');
    const code = optionValue(args, '--code');
    const acId = optionValue(args, '--ac');
    if (!code) throw new Error(`${command} waiver sign: --code <finding-code> is required — the check finding you are accepting (e.g. evidence_commit_not_found).`);
    if (!reason) throw new Error(`${command} waiver sign: --reason "<why this failing state is acceptable>" is required`);
    const gitName = git(projectRoot, ['config', 'user.name']);
    const gitEmail = git(projectRoot, ['config', 'user.email']);
    // `Name (email)`, not git's `Name <email>` — angle brackets get mangled by the markdown
    // round-trip; parens survive. The signer is the git identity (authors commits too).
    const approvedBy = gitName && gitEmail ? `${gitName} (${gitEmail})` : (gitName || gitEmail);
    if (!approvedBy) throw new Error(`${command} waiver sign: no git identity configured. Set one (\`git config user.name\` / \`user.email\`) — a waiver must record who signed it.`);
    const next = rows.filter((w) => !(w.code === code && (w.acId ?? '') === (acId ?? '')));  // replace a same code+ac waiver
    next.push({ code, reason, approvedBy, ...(acId ? { acId } : {}) });
    await wClient.issue.edit(id, { body: withWaivers(body, next) });
    process.stdout.write(`${statusMark('pass')} ${ui.green('waiver signed')} ${ui.dim(`→ ${id}${acId ? ` (${acId})` : ''} for '${code}' by ${approvedBy}. Honored only while '${code}' actually fires — otherwise check reports waiver_unused.`)}\n`);
    return true;
  }
  if (action === 'clear') {
    const code = optionValue(args, '--code');
    const next = code ? rows.filter((w) => w.code !== code) : [];
    await wClient.issue.edit(id, { body: withWaivers(body, next) });
    process.stdout.write(`${statusMark('pass')} ${ui.dim(code ? `waiver for '${code}' cleared on ${id}` : `all waivers cleared on ${id}`)}\n`);
    return true;
  }
  if (action === 'status') {
    process.stdout.write(rows.length
      ? `${statusMark('info')} ${ui.bold(`${id} carries ${rows.length} waiver${rows.length === 1 ? '' : 's'}`)}\n${rows.map((w) => `  ${ui.dim(`${w.code}${w.acId ? ` (${w.acId})` : ''} — ${w.reason} [${w.approvedBy}]`)}`).join('\n')}\n`
      : `${statusMark('info')} ${ui.dim(`${id} has no waivers`)}\n`);
    return true;
  }
  throw new Error(`${command} waiver: unknown action '${action}'. Try 'sign <issue> --code <code> --reason "..."', 'clear <issue> [--code <code>]', or 'status <issue>'.`);
}
