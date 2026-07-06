// ZTB-24: the flag surface becomes a grammar. One declarative table (below) describes every REAL
// command path and the flags its own parser actually reads (line-verified against cliCheck.ts,
// cliImport.ts, cliInit.ts, cliLoop.ts, cliWaiver.ts, cliFmt.ts, cliLint.ts, cliTx.ts, cliSync.ts,
// cliEvidence.ts, cliApi.ts, cliPatch.ts, cliFrontier.ts, cliCompletions.ts, and
// backends/markdownBackend.ts's flagVal/flagAll call sites). Three things read this table:
//   1. `rejectUnknownFlags` — dispatch-time validation in cli.ts's main(), catching a typo'd flag on
//      any command that never had its own unknown-flag guard before (only check/export/import did).
//   2. cliCheck.ts's/cliImport.ts's own KNOWN_FLAGS allow-lists now DERIVE their flag SET from here
//      (`flagSetFor`) instead of keeping a hand-maintained second copy.
//   3. `usageFromRegistry` — renders a flags-only usage fragment for the two actions
//      (issue patch/delete) whose help text is generated from this table rather than hand-written,
//      per the AC.
//   4. src/cliRegistry.test.ts's registry<->help drift test and source meta-scan, so no command's
//      parser and its help text can ever silently diverge again (in either direction).
//
// NOT in this table (left with their existing, unchanged paths): `annotations` and `ingest`
// (always-throw stubs in cli.ts), `extract-issue-ref` (a ghost — no backend consumer exists; the
// unknown-command error from the markdown backend is the correct, existing behavior). Global
// `--help`/`-h`/`help` are valid EVERYWHERE and are not, and must not be, registered per-command.
// `--version`/`-v` are position-0-only and handled before any of this runs.
import { nearestKey } from './configSchema.ts';

export type FlagSpec = {
  name: string;            // canonical form, e.g. '--state'
  takesValue: boolean;
  repeatable?: boolean;    // may legitimately appear more than once (e.g. --label, --source)
  aliases?: string[];      // e.g. '--case' aliases '--issues' on `check`
  hidden?: boolean;        // parsed and accepted, but deliberately undocumented (see cliHelp.ts)
};
export type CommandSpec = {
  path: string[];          // e.g. ['issue', 'list'] ; ['check'] ; ['loop', 'start']
  flags: FlagSpec[];
};

function val(name: string, opts: Partial<Pick<FlagSpec, 'aliases' | 'repeatable' | 'hidden'>> = {}): FlagSpec {
  return { name, takesValue: true, ...opts };
}
function bool(name: string, opts: Partial<Pick<FlagSpec, 'aliases' | 'repeatable' | 'hidden'>> = {}): FlagSpec {
  return { name, takesValue: false, ...opts };
}

// The full command -> flag inventory, as ACTUALLY PARSED (re-verified against the tree; see the
// spec's per-bullet file:line citations). Ordered roughly as the CLI's own dispatch order in
// cli.ts, for ease of cross-checking.
export const REGISTRY: CommandSpec[] = [
  { path: ['check'], flags: [
    val('--issues', { aliases: ['--case'] }),
    val('--source', { repeatable: true }),
    val('--categories'),
    val('--phase'),
    bool('--fail-on-warning'),
    bool('--no-verify-commits'),
    bool('--verify-commits', { hidden: true }), // accepted no-op alias, back-compat only
    val('--input'),
    bool('--auto-scope'),
    val('--output'),
    bool('--json'),
    bool('--errors-only'),
    val('--max-findings'),
    val('--preset'),
  ] },
  { path: ['export'], flags: [ val('--out'), val('--issues') ] },
  { path: ['issue', 'scaffold'], flags: [ val('--title') ] },
  { path: ['issue', 'list'], flags: [
    val('--json'),
    val('--source', { repeatable: true }),
    val('--state'),
    val('--label'),
    val('--parent'),
    val('--search'),
    val('--limit'),
    bool('--actionable'),
    bool('--blocked'),
  ] },
  { path: ['issue', 'view'], flags: [ bool('--json') ] },
  { path: ['issue', 'get'], flags: [ bool('--json') ] }, // ZTB-24 dev/05: `get` is a full alias of `view`
  { path: ['issue', 'create'], flags: [
    val('--title'), val('--body'), val('--body-file'), val('--state'), val('--assignee'),
    val('--label', { repeatable: true }), val('--project'), val('--parent'),
  ] },
  { path: ['issue', 'edit'], flags: [
    val('--title'), val('--body'), val('--body-file'), val('--state'), val('--assignee'),
    val('--project'), bool('--remove-project'), val('--parent'), bool('--remove-parent'),
    val('--add-label', { repeatable: true }), val('--remove-label', { repeatable: true }),
    val('--expect-state'), val('--expect-body-sha'), // parsed+stripped in cli.ts before forwarding
  ] },
  { path: ['issue', 'comment'], flags: [ val('--body'), val('--body-file') ] },
  { path: ['issue', 'close'], flags: [ val('--reason'), val('--comment'), val('--comment-file') ] },
  { path: ['issue', 'delete'], flags: [] },
  { path: ['issue', 'patch'], flags: [ val('--json'), bool('--dry-run') ] },
  { path: ['ac', 'patch'], flags: [ val('--json'), bool('--dry-run') ] },
  { path: ['project', 'list'], flags: [] },
  { path: ['snapshot'], flags: [] }, // not yet implemented by the markdown backend; no flags read
  { path: ['init'], flags: [
    val('--root'), bool('--list'), val('--preset'), val('--sync'), val('--repo'), val('--policy'),
    bool('--branch'), val('--team'),
  ] },
  { path: ['migrate-local'], flags: [ val('--root') ] },
  { path: ['preset', 'upgrade'], flags: [] },
  { path: ['loop', 'start'], flags: [ val('--max'), val('--until') ] },
  { path: ['loop', 'stop'], flags: [] },
  { path: ['loop', 'status'], flags: [] },
  { path: ['waiver', 'sign'], flags: [ val('--code'), val('--reason'), val('--ac'), val('--ref') ] },
  { path: ['waiver', 'clear'], flags: [ val('--code') ] },
  { path: ['waiver', 'status'], flags: [] },
  { path: ['waiver', 'migrate'], flags: [ bool('--all') ] },
  { path: ['import'], flags: [ val('--prefix'), bool('--dry-run'), bool('--register') ] },
  { path: ['fmt'], flags: [ val('--input'), val('--issue'), bool('--write'), bool('--check') ] },
  { path: ['lint'], flags: [ val('--issues'), bool('--json'), bool('--fail-on-warn') ] },
  { path: ['tx', 'plan'], flags: [ val('--file') ] },
  { path: ['tx', 'apply'], flags: [ val('--file') ] },
  { path: ['sync', 'github'], flags: [ val('--repo'), bool('--pull'), bool('--push'), val('--policy'), bool('--json') ] },
  { path: ['evidence', 'add'], flags: [
    val('--file'), val('--name'), bool('--attach'), bool('--commit'),
    bool('--blob', { hidden: true }), // legacy content-addressed store, removed; a stray --blob is inert (cliEvidence.e2e.test.ts pins this)
  ] },
  { path: ['evidence', 'keygen'], flags: [ val('--out-dir') ] },
  { path: ['evidence', 'verify'], flags: [ val('--bundle'), val('--key'), val('--issues') ] },
  { path: ['evidence', 'export'], flags: [ val('--format'), bool('--sign'), val('--sign-key'), val('--issues'), val('--out') ] },
  { path: ['api', 'query'], flags: [ val('--query') ] },
  { path: ['api', 'serve'], flags: [ val('--host'), val('--port') ] },
  { path: ['mcp', 'serve'], flags: [] },
  { path: ['visualizer'], flags: [ val('--project'), val('--preset'), val('--port') ] },
  { path: ['viz'], flags: [ val('--project'), val('--preset'), val('--port') ] },
  { path: ['completions', 'bash'], flags: [] },
  { path: ['completions', 'zsh'], flags: [] },
];

/** Every registered path, longest first — so a 2-token path (`issue list`) is tried before any
 *  1-token path could otherwise shadow it. Paths never actually collide across lengths today (no
 *  command is both a bare verb and a verb+action), but this keeps the resolver correct if one ever does. */
const BY_LENGTH_DESC = [...REGISTRY].sort((a, b) => b.path.length - a.path.length);

/** Resolve `args` to its registered CommandSpec by longest matching path prefix. Returns
 *  undefined for anything unregistered (a ghost, a stub, or a genuinely unknown command) — the
 *  caller's job is to do nothing in that case, preserving today's existing (non-)behavior there. */
export function commandSpecFor(args: string[]): CommandSpec | undefined {
  for (const spec of BY_LENGTH_DESC) {
    if (spec.path.length > args.length) continue;
    if (spec.path.every((token, i) => args[i] === token)) return spec;
  }
  return undefined;
}

function exactSpecFor(path: string[]): CommandSpec | undefined {
  return REGISTRY.find((spec) => spec.path.length === path.length && spec.path.every((t, i) => t === path[i]));
}

/** Every accepted flag TOKEN for one command — its own flags' names AND aliases. `includeHidden`
 *  (default true) controls whether deliberately-undocumented flags (e.g. `--verify-commits`,
 *  `--blob`) are included; they must stay ACCEPTED even when not shown in any help text or
 *  "accepted flags" hint. Exported (as `flagTokensForTest`) purely for cliRegistry.test.ts's
 *  registry<->help drift test — not part of the runtime API other exports above serve. */
function flagTokens(spec: CommandSpec, includeHidden = true): string[] {
  const out: string[] = [];
  for (const f of spec.flags) {
    if (f.hidden && !includeHidden) continue;
    out.push(f.name, ...(f.aliases ?? []));
  }
  return out;
}
export const flagTokensForTest = flagTokens;

/** cliCheck.ts's/cliImport.ts's KNOWN_FLAGS allow-lists derive their flag SET from here — one
 *  source of truth for "is this a real flag on this command", even though those two commands keep
 *  their own (position-insensitive) unknown-flag scan and error wording. */
export function flagSetFor(path: string[]): Set<string> {
  const spec = exactSpecFor(path);
  if (!spec) throw new Error(`cliRegistry: no such command registered: ${path.join(' ')}`);
  return new Set(flagTokens(spec));
}

/** A flags-only usage fragment, e.g. `[--json <value>] [--dry-run]`, rendered straight from the
 *  registry (hidden flags omitted) — used by cliHelp.ts for `issue patch`/`issue delete`, whose
 *  usage line the AC requires be generated from this table rather than hand-written prose. */
export function usageFromRegistry(path: string[]): string {
  const spec = exactSpecFor(path);
  if (!spec) return '';
  return spec.flags
    .filter((f) => !f.hidden)
    .map((f) => (f.takesValue ? `[${f.name} <value>]` : `[${f.name}]`))
    .join(' ');
}

/** Every flag token registered ANYWHERE in the table (all commands, hidden included) — used by the
 *  meta-scan (cliRegistry.test.ts) to check that every flag literal actually parsed somewhere in
 *  src/ is registered on at least one command. */
export function allRegisteredFlagTokens(): Set<string> {
  const out = new Set<string>();
  for (const spec of REGISTRY) for (const t of flagTokens(spec)) out.add(t);
  return out;
}

const HELP_TOKENS = new Set(['--help', '-h', 'help']);

type WalkedToken =
  | { kind: 'positional'; token: string }
  | { kind: 'flag'; token: string; known: FlagSpec | undefined };

/** The one walk both `rejectUnknownFlags` and `positionalArgs` consume, so the two can never
 *  disagree about which token is a value. Per token (after `spec.path` has been sliced off):
 *  HELP_TOKENS are dropped; a `--token` is classified 'flag' (known or not) and, if it's a KNOWN
 *  value-taking flag with NO `=` form, consumes (skips) the very next token as its value ONLY when
 *  that token exists and does not itself look like a flag (`--`-prefixed) — the same guard
 *  `optionValue` has always had (ZTB-41). A following `--token` is instead classified on its own
 *  turn: known → fine, unknown → rejected loud with did-you-mean by the existing mechanism. This
 *  makes the registry walk deliberately STRICTER than the backend's `flagVal`/`flagAll` (which
 *  still unconditionally consume next-token as value): the only possible effect of the mismatch is
 *  converting a silent wrong result into a loud rejection before any handler runs — it can never
 *  misread an invocation that works today via the handler's own parser. Everything else is
 *  classified 'positional'. */
function walkArgs(spec: CommandSpec, remaining: string[]): WalkedToken[] {
  const byToken = new Map<string, FlagSpec>();
  for (const f of spec.flags) { byToken.set(f.name, f); for (const a of f.aliases ?? []) byToken.set(a, f); }

  const out: WalkedToken[] = [];
  for (let i = 0; i < remaining.length; i++) {
    const token = remaining[i]!;
    if (HELP_TOKENS.has(token)) continue;
    if (!token.startsWith('--')) { out.push({ kind: 'positional', token }); continue; }
    const eq = token.indexOf('=');
    const base = eq >= 0 ? token.slice(0, eq) : token;
    const known = byToken.get(base);
    out.push({ kind: 'flag', token, known });
    if (known && known.takesValue && eq < 0) {
      const next = remaining[i + 1];
      if (next !== undefined && !next.startsWith('--')) i += 1;
    }
  }
  return out;
}

/** The POSITIONAL tokens of a registered command invocation — every token that is neither a flag
 *  nor a recognized value-taking flag's consumed value. Walks exactly like `rejectUnknownFlags`
 *  (same `=` handling, same guarded consume-next for a recognized value flag in space form — see
 *  ZTB-41 note on `walkArgs`), via the shared `walkArgs`, so the two can never disagree about which
 *  token is a value. Returns `[]` for an unregistered command path. `args` is the full command
 *  vector (e.g. `['evidence','add',...]`) — this resolves the command's own spec and slices its
 *  path off. */
export function positionalArgs(args: string[]): string[] {
  const spec = commandSpecFor(args);
  if (!spec) return [];
  const remaining = args.slice(spec.path.length);
  return walkArgs(spec, remaining)
    .filter((t): t is { kind: 'positional'; token: string } => t.kind === 'positional')
    .map((t) => t.token);
}

/** Dispatch-time unknown-flag validation. Called from cli.ts's main() AFTER the help/version/
 *  completions interceptions (those must stay config-free and never reach here) and BEFORE
 *  `handleInitCommand`, so it covers every real command. Never rejects an invocation that works
 *  today: an unregistered command path is a silent no-op (existing backend/handler error paths are
 *  untouched), and (since ZTB-41) the walk below is deliberately STRICTER than markdownBackend's own
 *  flagVal/optionValue-family parsers at the one shape where they used to diverge (a space-form
 *  value token that itself looks like a flag) — see `walkArgs`'s docstring — so a
 *  genuinely-working-today invocation is never misread; the only effect on a previously-silent
 *  mismatch is a loud rejection here before any handler runs. */
export function rejectUnknownFlags(args: string[]): void {
  const spec = commandSpecFor(args);
  if (!spec) return; // unregistered command — not this validator's job (ghost/stub/unknown verb)
  const remaining = args.slice(spec.path.length);
  const unknown = walkArgs(spec, remaining)
    .filter((t): t is { kind: 'flag'; token: string; known: FlagSpec | undefined } => t.kind === 'flag' && !t.known)
    .map((t) => t.token);
  if (!unknown.length) return;

  const label = `ztrack ${spec.path.join(' ')}`;
  const accepted = flagTokens(spec, false).sort();
  const withSuggestions = unknown.map((token) => {
    const base = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
    return { token, suggestion: nearestKey(base, flagTokens(spec)) };
  });
  if (withSuggestions.some((u) => u.suggestion)) {
    const parts = withSuggestions.map((u) => (u.suggestion ? `${u.token} (did you mean ${u.suggestion}?)` : u.token));
    throw new Error(`${label}: unknown flag(s) ${parts.join(', ')}.`);
  }
  throw new Error(`${label}: unknown flag(s) ${unknown.join(', ')}. Accepted flags: ${accepted.join(' ')}`);
}
