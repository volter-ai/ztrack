import type { TrackerFinding, TrackerValidationReport } from './snapshotContract.ts';

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

export function statusMark(kind: 'pass' | 'fail' | 'warn' | 'info'): string {
  if (kind === 'pass') return ui.green('✓');
  if (kind === 'fail') return ui.red('✗');
  if (kind === 'warn') return ui.yellow('!');
  return ui.blue('•');
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function statusText(report: TrackerValidationReport): string {
  if (report.valid) return `${statusMark('pass')} ${ui.green('ztrack check passed')}`;
  return `${statusMark('fail')} ${ui.red('ztrack check failed')}`;
}

function metric(label: string, value: unknown): string {
  return `${ui.dim(label)} ${ui.bold(String(value ?? 0))}`;
}

function findingGroupKey(finding: TrackerFinding): string {
  return finding.issue || 'workspace';
}

function findingLevel(finding: TrackerFinding): string {
  return finding.level === 'error'
    ? `${statusMark('fail')} ${ui.red('error')}`
    : `${statusMark('warn')} ${ui.yellow('warning')}`;
}

function codeLabel(code: string): string {
  return ui.dim(code);
}

export function renderCheckReport(report: TrackerValidationReport, options: { errorsOnly?: boolean; maxFindings?: number } = {}): string {
  const summary = report.summary as Record<string, unknown>;
  const findings = report.findings
    .filter((finding) => !options.errorsOnly || finding.level === 'error')
    .slice()
    .sort((a, b) => {
      if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
      return findingGroupKey(a).localeCompare(findingGroupKey(b)) || a.code.localeCompare(b.code);
    });
  const maxFindings = options.maxFindings ?? 120;
  const shown = findings.slice(0, maxFindings);
  const lines: string[] = [
    statusText(report),
    [
      metric('cases', summary.cases),
      metric('open', summary.openCases),
      metric('errors', summary.errors),
      metric('warnings', summary.warnings),
    ].join(ui.dim('  ·  ')),
  ];

  if (shown.length === 0) {
    lines.push('', `${statusMark('pass')} ${ui.dim('No findings at the configured rigor level.')}`);
  } else {
    lines.push('', ui.bold('Findings'));
    let currentGroup = '';
    for (const finding of shown) {
      const group = findingGroupKey(finding);
      if (group !== currentGroup) {
        lines.push(`\n${ui.bold(group)}`);
        currentGroup = group;
      }
      lines.push(`  ${findingLevel(finding)}  ${codeLabel(finding.code)}`);
      lines.push(`     ${finding.message}`);
    }
    if (findings.length > shown.length) {
      lines.push('', ui.dim(`... ${findings.length - shown.length} more findings hidden by --max-findings`));
    }
  }

  const exitHint = report.valid
    ? `${statusMark('pass')} ${ui.dim('exit 0')}`
    : `${statusMark('fail')} ${ui.dim('exit 1: produce evidence or lower the configured rigor')}`;
  lines.push('', exitHint);
  return `${lines.join('\n')}\n`;
}
