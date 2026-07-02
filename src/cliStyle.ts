import { isAbsolute, relative } from 'node:path';
import type { CheckResult, CoreRoot, Finding } from './core/engine.ts';

const wantsColor = (stream: NodeJS.WriteStream): boolean => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream.isTTY);
};

const color = (open: string, close = '\x1b[0m') => (text: string): string =>
  wantsColor(process.stdout) ? `${open}${text}${close}` : text;

export const ui = {
  dim: color('\x1b[2m'),
  bold: color('\x1b[1m'),
  green: color('\x1b[32m'),
  red: color('\x1b[31m'),
  yellow: color('\x1b[33m'),
  blue: color('\x1b[34m'),
  cyan: color('\x1b[36m'),
  magenta: color('\x1b[35m'),
  redBadge: color('\x1b[41m\x1b[30m\x1b[1m'),
  yellowBadge: color('\x1b[43m\x1b[30m\x1b[1m'),
  cyanBadge: color('\x1b[46m\x1b[30m\x1b[1m'),
};

export function heading(title: string, subtitle?: string): string {
  return `${ui.bold(title)}${subtitle ? ` ${ui.dim(subtitle)}` : ''}`;
}

export function commandLine(command: string, description: string): string {
  if (command.length > 48) {
    return `  ${ui.cyan(command)}\n  ${' '.repeat(48)} ${ui.dim(description)}`;
  }
  return `  ${ui.cyan(command.padEnd(48))} ${ui.dim(description)}`;
}

export function stackedCommand(index: number, title: string, command: string, description: string): string {
  const commandLines = wrapWords(command, 50);
  const descriptionLines = wrapWords(description, 56);
  return [
    `  ${ui.dim(`${index}.`)} ${ui.cyan(commandLines[0] ?? command)}`,
    ...commandLines.slice(1).map((line) => `     ${ui.cyan(line)}`),
    ...descriptionLines.map((line) => `     ${ui.dim(line)}`),
  ].join('\n');
}

export function helpSection(_position: 'top' | 'middle' | 'bottom', title: string, rows: Array<[string, string]>): string {
  // Size the box to its widest content so long command/description lines never overflow the
  // border (padEnd only pads — it never truncates). Columns are derived from the rows.
  const headerText = ` ${title} `;
  const commandWidth = Math.max(...rows.map(([command]) => command.length));
  const descriptionWidth = Math.max(...rows.map(([, description]) => description.length));
  const width = Math.max(commandWidth + descriptionWidth + 6, headerText.length + 4);
  const header = `${ui.dim(`╭─${headerText}${'─'.repeat(width - headerText.length - 3)}╮`)}`;
  const body = rows.map(([command, description]) =>
    `${ui.dim('│')}  ${ui.cyan(command.padEnd(commandWidth))} ${ui.dim(description.padEnd(descriptionWidth))} ${ui.dim('│')}`);
  return [header, ...body, ui.dim(`╰${'─'.repeat(width - 2)}╯`)].join('\n');
}

function wrapWords(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function statusMark(kind: 'pass' | 'fail' | 'warn' | 'info'): string {
  if (kind === 'pass') return ui.green('✓');
  if (kind === 'fail') return ui.red('✗');
  if (kind === 'warn') return ui.yellow('!');
  return ui.blue('•');
}

// A small derived summary of a CheckResult — the validated root has no separate
// "summary" object, so we compute the metric box from the findings + issue count.
export interface CheckSummary { issues: number; errors: number; warnings: number; acknowledged: number; status: 'pass' | 'warn' | 'fail' }
export function summarizeResult(result: CheckResult<CoreRoot>): CheckSummary {
  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const acknowledged = result.findings.filter((f) => f.severity === 'acknowledged').length;
  const warnings = result.findings.length - errors - acknowledged;
  return {
    issues: result.export?.issues.length ?? 0,
    errors,
    warnings,
    acknowledged,
    status: errors > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass',
  };
}

function statusText(ok: boolean): string {
  if (ok) return `${statusMark('pass')} ${ui.green('ztrack check passed')}`;
  return `${statusMark('fail')} ${ui.red('ztrack check failed')}`;
}

function metric(label: string, value: unknown): string {
  return `${ui.dim(label)} ${ui.bold(String(value ?? 0))}`;
}

function metricBox(summary: CheckSummary): string {
  const ackPart = summary.acknowledged > 0 ? [`acknowledged ${summary.acknowledged}`] : [];
  const raw = [`issues ${summary.issues}`, `errors ${summary.errors}`, `warnings ${summary.warnings}`, ...ackPart].join('  •  ');
  const content = [
    metric('issues', summary.issues),
    summary.errors > 0 ? `${ui.dim('errors')} ${ui.red(String(summary.errors))}` : metric('errors', summary.errors),
    summary.warnings > 0 ? `${ui.dim('warnings')} ${ui.yellow(String(summary.warnings))}` : metric('warnings', summary.warnings),
    ...(summary.acknowledged > 0 ? [`${ui.dim('acknowledged')} ${ui.cyan(String(summary.acknowledged))}`] : []),
  ].join(ui.dim('  •  '));
  const width = raw.length + 4;
  return [
    ui.dim(`╭${'─'.repeat(width)}╮`),
    `${ui.dim('│')} ${content} ${ui.dim('│')}`,
    ui.dim(`╰${'─'.repeat(width)}╯`),
  ].join('\n');
}

function findingGroupKey(finding: Finding): string {
  return finding.issueId || 'workspace';
}

function findingLevel(finding: Finding): string {
  if (finding.severity === 'error') return ui.redBadge(' x error ');
  if (finding.severity === 'acknowledged') return ui.cyanBadge(' ack ');
  return ui.yellowBadge(' warn ');
}

function codeLabel(code: string): string {
  return ui.dim(code);
}

// A dim ` — path:line` suffix citing where the finding's issue actually lives, project-root-
// relative so terminals make it clickable (an absolute path in memory is fine; only the
// RENDERED path must be root-relative — see Finding.origin, engine.ts).
function originSuffix(finding: Finding, projectRoot?: string): string {
  if (!finding.origin) return '';
  const path = projectRoot && isAbsolute(finding.origin.path) ? relative(projectRoot, finding.origin.path) : finding.origin.path;
  const loc = finding.origin.line !== undefined ? `${path}:${finding.origin.line}` : path;
  return ` ${ui.dim(`— ${loc}`)}`;
}

export function renderCheckReport(result: CheckResult<CoreRoot>, options: { errorsOnly?: boolean; maxFindings?: number; projectRoot?: string } = {}): string {
  const summary = summarizeResult(result);
  const findings = result.findings
    .filter((finding) => !options.errorsOnly || finding.severity === 'error')
    .slice()
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return findingGroupKey(a).localeCompare(findingGroupKey(b)) || a.code.localeCompare(b.code);
    });
  const maxFindings = options.maxFindings ?? 120;
  const shown = findings.slice(0, maxFindings);
  const lines: string[] = [
    statusText(result.ok),
    metricBox(summary),
  ];

  if (shown.length === 0) {
    lines.push('', `${statusMark('pass')} ${ui.dim('No findings at the configured rigor level.')}`);
  } else {
    lines.push('', ui.bold('Findings'));
    let currentGroup = '';
    const groupItems = new Map<string, Finding[]>();
    for (const finding of shown) {
      const group = findingGroupKey(finding);
      groupItems.set(group, [...(groupItems.get(group) ?? []), finding]);
    }
    for (const [group, items] of groupItems) {
      if (group !== currentGroup) {
        lines.push(`\n${ui.bold(group)}`);
        currentGroup = group;
      }
      lines.push(ui.dim('│'));
      items.forEach((finding, index) => {
        const last = index === items.length - 1;
        const branch = last ? '╰─' : '├─';
        const detailPrefix = last ? '   └─' : '│  └─';
        lines.push(`${ui.dim(branch)} ${findingLevel(finding)} ${codeLabel(finding.code)}${originSuffix(finding, options.projectRoot)}`);
        lines.push(`${ui.dim(detailPrefix)} ${finding.message}`);
        if (finding.fix) lines.push(`${ui.dim(last ? '      ' : '│     ')}${ui.cyan('↳')} ${ui.dim(finding.fix)}`);
        if (!last) lines.push(ui.dim('│'));
      });
    }
    if (findings.length > shown.length) {
      lines.push('', ui.dim(`... ${findings.length - shown.length} more findings hidden by --max-findings`));
    }
  }

  const exitHint = result.ok
    ? `${statusMark('pass')} ${ui.dim('exit 0')}`
    : `${statusMark('fail')} ${ui.dim('exit 1: produce evidence or lower the configured rigor')}`;
  lines.push('', exitHint);
  return `${lines.join('\n')}\n`;
}

// `--auto-scope` view: a banner naming the resolved issue (or the fail-closed
// fallback), the blocking findings rendered as the gate, and a one-line digest of
// the findings in OTHER issues that this branch is not responsible for.
export function renderScopedReport(
  result: CheckResult<CoreRoot>,
  opts: {
    activeIssue: string | null; reason: string;
    blocking: Finding[]; informational: Finding[];
    errorsOnly?: boolean; maxFindings?: number; projectRoot?: string;
  },
): string {
  const banner = opts.activeIssue
    ? `${statusMark('info')} ${ui.dim('auto-scope →')} ${ui.bold(opts.activeIssue)} ${ui.dim(`(${opts.reason})`)}`
    : `${statusMark('warn')} ${ui.dim('auto-scope →')} ${ui.yellow('unresolved')} ${ui.dim(`(${opts.reason}); gating the whole tracker`)}`;

  const blockingResult: CheckResult<CoreRoot> = {
    ok: !opts.blocking.some((f) => f.severity === 'error'),
    findings: opts.blocking,
    ...(result.export ? { export: result.export } : {}),
  };
  const body = renderCheckReport(blockingResult, {
    ...(opts.errorsOnly ? { errorsOnly: true } : {}),
    ...(opts.maxFindings !== undefined ? { maxFindings: opts.maxFindings } : {}),
    ...(opts.projectRoot ? { projectRoot: opts.projectRoot } : {}),
  });

  let info = '';
  if (opts.informational.length) {
    const byIssue = new Map<string, number>();
    for (const f of opts.informational) byIssue.set(f.issueId ?? 'workspace', (byIssue.get(f.issueId ?? 'workspace') ?? 0) + 1);
    const digest = [...byIssue].map(([id, n]) => `  ${ui.dim('•')} ${id} ${ui.dim(`(${n})`)}`).join('\n');
    info = `\n${ui.dim(`ℹ ${opts.informational.length} finding(s) in other issues — not gating this branch:`)}\n${digest}\n`;
  }

  return `${banner}\n${body}${info}`;
}
