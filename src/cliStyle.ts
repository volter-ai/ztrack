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
  redBadge: color('\x1b[41m\x1b[30m\x1b[1m'),
  yellowBadge: color('\x1b[43m\x1b[30m\x1b[1m'),
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

export function helpSection(position: 'top' | 'middle' | 'bottom', title: string, rows: Array<[string, string]>): string {
  const width = 66;
  const commandWidth = 31;
  const descriptionWidth = width - commandWidth - 6;
  const headerText = ` ${title} `;
  const header = `${ui.dim(`╭─${headerText}${'─'.repeat(width - headerText.length - 2)}╮`)}`;
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

function metricBox(summary: Record<string, unknown>): string {
  const raw = [
    `cases ${summary.cases ?? 0}`,
    `open ${summary.openCases ?? 0}`,
    `errors ${summary.errors ?? 0}`,
    `warnings ${summary.warnings ?? 0}`,
  ].join('  •  ');
  const content = [
    metric('cases', summary.cases),
    metric('open', summary.openCases),
    numberValue(summary.errors) > 0 ? `${ui.dim('errors')} ${ui.red(String(summary.errors))}` : metric('errors', summary.errors),
    numberValue(summary.warnings) > 0 ? `${ui.dim('warnings')} ${ui.yellow(String(summary.warnings))}` : metric('warnings', summary.warnings),
  ].join(ui.dim('  •  '));
  const width = raw.length + 4;
  return [
    ui.dim(`╭${'─'.repeat(width)}╮`),
    `${ui.dim('│')} ${content} ${ui.dim('│')}`,
    ui.dim(`╰${'─'.repeat(width)}╯`),
  ].join('\n');
}

function findingGroupKey(finding: TrackerFinding): string {
  return finding.issue || 'workspace';
}

function findingLevel(finding: TrackerFinding): string {
  return finding.level === 'error'
    ? ui.redBadge(' x error ')
    : ui.yellowBadge(' warn ');
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
    metricBox(summary),
  ];

  if (shown.length === 0) {
    lines.push('', `${statusMark('pass')} ${ui.dim('No findings at the configured rigor level.')}`);
  } else {
    lines.push('', ui.bold('Findings'));
    let currentGroup = '';
    const groupItems = new Map<string, TrackerFinding[]>();
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
        lines.push(`${ui.dim(branch)} ${findingLevel(finding)} ${codeLabel(finding.code)}`);
        lines.push(`${ui.dim(detailPrefix)} ${finding.message}`);
        if (!last) lines.push(ui.dim('│'));
      });
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
