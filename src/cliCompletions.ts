// `ztrack completions <bash|zsh>` — emit a shell completion script for the ztrack CLI.
// Generated statically from a small command map (top-level commands, their subcommands, and
// the most-used flags), so completion needs no runtime introspection and no tracker.

// Top-level commands worth completing (the resource/action surface a user types first).
const TOP_LEVEL = [
  'example', 'init', 'migrate-local', 'check', 'export', 'issue', 'loop', 'waiver', 'preset', 'fmt', 'lint',
  'tx', 'ac', 'evidence', 'visualizer', 'mcp', 'completions',
];

// Subcommands per command (second word).
const SUBCOMMANDS: Record<string, string[]> = {
  issue: ['scaffold', 'create', 'view', 'edit', 'list', 'close', 'comment', 'comments', 'history', 'relate', 'relations', 'unrelate'],
  loop: ['start', 'stop', 'status'],
  waiver: ['sign', 'clear', 'status'],
  preset: ['upgrade'],
  mcp: ['serve'],
  completions: ['bash', 'zsh'],
};

// Flags worth completing for the commands that take them.
const FLAGS: Record<string, string[]> = {
  check: ['--issues', '--json', '--auto-scope', '--verify-commits', '--phase', '--fail-on-warning', '--errors-only', '--output', '--input', '--max-findings', '--categories'],
  export: ['--out', '--issues'],
  init: ['--team', '--preset'],
  loop: ['--max'],
  waiver: ['--reason'],
};

const subcaseLines = (indent: string, fmt: (cmd: string, words: string) => string): string =>
  Object.entries(SUBCOMMANDS).map(([cmd, subs]) => `${indent}${fmt(cmd, [...subs, ...(FLAGS[cmd] ?? [])].join(' '))}`).join('\n');

/** A bash completion script. `complete -F _<cmd> <cmd>`; completes the command, then
 *  per-command subcommands/flags. Self-contained — no bash-completion library required. */
export function bashCompletion(cmd: string): string {
  const fn = `_${cmd.replace(/[^A-Za-z0-9_]/g, '_')}`;
  const top = TOP_LEVEL.join(' ');
  const cases = Object.keys(SUBCOMMANDS).map((c) => {
    const words = [...(SUBCOMMANDS[c] ?? []), ...(FLAGS[c] ?? [])].join(' ');
    return `    ${c}) COMPREPLY=( $(compgen -W "${words}" -- "$cur") ); return ;;`;
  });
  const flagOnly = Object.keys(FLAGS).filter((c) => !SUBCOMMANDS[c]).map((c) =>
    `    ${c}) COMPREPLY=( $(compgen -W "${(FLAGS[c] ?? []).join(' ')}" -- "$cur") ); return ;;`);
  return `# bash completion for ${cmd} — install with:  source <(${cmd} completions bash)
${fn}() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${top}" -- "$cur") ); return
  fi
  case "\${COMP_WORDS[1]}" in
${[...cases, ...flagOnly].join('\n')}
  esac
}
complete -F ${fn} ${cmd}
`;
}

/** A zsh completion script (`#compdef <cmd>`). Install by putting it on $fpath, or
 *  eval it: `source <(${cmd} completions zsh)`. */
export function zshCompletion(cmd: string): string {
  const fn = `_${cmd.replace(/[^A-Za-z0-9_]/g, '_')}`;
  const top = TOP_LEVEL.join(' ');
  const cases = subcaseLines('    ', (c, words) => `${c}) compadd ${words} ;;`);
  const flagOnly = Object.keys(FLAGS).filter((c) => !SUBCOMMANDS[c]).map((c) =>
    `    ${c}) compadd ${(FLAGS[c] ?? []).join(' ')} ;;`).join('\n');
  return `#compdef ${cmd}
# zsh completion for ${cmd} — install with:  source <(${cmd} completions zsh)
${fn}() {
  if (( CURRENT == 2 )); then
    compadd ${top}
    return
  fi
  case "\${words[2]}" in
${cases}
${flagOnly}
  esac
}
compdef ${fn} ${cmd}
`;
}

/** `ztrack completions <bash|zsh>`. Returns true if it handled the command. */
export function handleCompletionsCommand(args: string[], cmd: string): boolean {
  if (args[0] !== 'completions') return false;
  const shell = args[1];
  if (!shell || shell === '--help' || shell === '-h' || shell === 'help') {
    process.stdout.write(`Usage: ${cmd} completions <bash|zsh>\n\nPrints a shell completion script. Install it by sourcing the output:\n  # bash (~/.bashrc):  source <(${cmd} completions bash)\n  # zsh  (~/.zshrc):   source <(${cmd} completions zsh)\n`);
    return true;
  }
  if (shell === 'bash') { process.stdout.write(bashCompletion(cmd)); return true; }
  if (shell === 'zsh') { process.stdout.write(zshCompletion(cmd)); return true; }
  throw new Error(`${cmd} completions: unknown shell '${shell}'. Try 'bash' or 'zsh'.`);
}
