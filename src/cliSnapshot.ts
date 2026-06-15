import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { checkTrackerSnapshot } from './check.ts';
import { optionValue } from './cliArgs.ts';
import { printResourceHelp } from './cliHelp.ts';
import { projectRootFrom } from './config.ts';
import { exportTrackerSnapshot } from './export.ts';

async function writeOutput(text: string, outPath: string): Promise<void> {
  if (!outPath) {
    process.stdout.write(text);
    return;
  }
  writeFileSync(outPath, text);
  process.stdout.write(`${outPath}\n`);
}

export async function handleSnapshotCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'check' && args[0] !== 'organization' && args[0] !== 'snapshot') return false;
  const action = args[0] === 'check' ? 'validate' : args[1];
  const flagArgs = args[0] === 'check' ? args.slice(1) : args.slice(2);
  if (!action || action === '--help' || action === '-h' || action === 'help') {
    printResourceHelp(args[0] === 'snapshot' ? 'snapshot' : 'organization');
    return true;
  }
  const knownFlags: Record<string, Set<string>> = {
    export: new Set(['--out']),
    validate: new Set(['--input', '--issues', '--case', '--categories', '--profile', '--fail-on-warning', '--verify-commits', '--errors-only', '--output', '--json', '--max-findings']),
  };
  const allowedFlags = knownFlags[action];
  if (allowedFlags) {
    const unknownFlags = flagArgs.filter((token) => token.startsWith('--') && !allowedFlags.has(token));
    if (unknownFlags.length > 0) {
      const commandName = args[0] === 'check' ? 'check' : `${args[0]} ${action}`;
      throw new Error(`tracker ${commandName}: unknown flag(s) ${unknownFlags.join(', ')}. Valid flags: ${[...allowedFlags].join(' ')}`);
    }
  }
  const projectRoot = projectRootFrom();
  if (action === 'export') {
    await writeOutput(`${JSON.stringify(exportTrackerSnapshot({ projectRoot }), null, 2)}\n`, optionValue(flagArgs, '--out'));
    return true;
  }
  if (action !== 'validate') throw new Error(`tracker ${args[0]}: unknown action '${action ?? ''}'`);

  const inputPath = optionValue(flagArgs, '--input');
  const issuesFilter = optionValue(flagArgs, '--issues') || optionValue(flagArgs, '--case');
  const issuesList = issuesFilter ? issuesFilter.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const categoriesFlag = optionValue(flagArgs, '--categories');
  const categories = categoriesFlag
    ? Object.fromEntries(categoriesFlag.split(',').map((pair) => { const [c, d] = pair.split('='); return [c!.trim(), Number(d)]; })) as Partial<Record<'wellformed' | 'sourced' | 'code' | 'visual' | 'behavioral', number>>
    : undefined;
  const profileFlag = optionValue(flagArgs, '--profile');
  const report = checkTrackerSnapshot(
      inputPath
        ? JSON.parse(readFileSync(isAbsolute(inputPath) ? inputPath : resolve(projectRoot, inputPath), 'utf8')) as unknown
        : exportTrackerSnapshot({ projectRoot, ...(issuesList ? { issues: issuesList } : {}) }),
      {
        projectRoot,
        ...(issuesList ? { issues: issuesList } : {}),
        ...(categories ? { categories } : {}),
        ...(profileFlag ? { profiles: profileFlag === 'none' ? [] : profileFlag.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
        failOnWarning: flagArgs.includes('--fail-on-warning'),
        verifyCommits: flagArgs.includes('--verify-commits'),
      },
    );
  const outputPath = optionValue(flagArgs, '--output');
  if (outputPath) writeFileSync(isAbsolute(outputPath) ? outputPath : resolve(projectRoot, outputPath), `${JSON.stringify(report, null, 2)}\n`);
  if (flagArgs.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
    const shown = report.findings
      .filter((item) => !flagArgs.includes('--errors-only') || item.level === 'error')
      .slice()
      .sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
    const maxFindings = Number(optionValue(flagArgs, '--max-findings') || '120');
    for (const item of shown.slice(0, maxFindings)) {
      process.stdout.write(`${item.level.toUpperCase()} ${item.code}:${item.issue ? ` issue=${item.issue}` : ''} ${item.message}\n`);
    }
    if (shown.length > maxFindings) process.stdout.write(`... ${shown.length - maxFindings} more\n`);
  }
  process.exitCode = report.valid ? 0 : 1;
  return true;
}
