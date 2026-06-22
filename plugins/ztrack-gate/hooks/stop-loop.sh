#!/usr/bin/env bash
# ztrack-loop — Claude Code Stop hook implementing a ralph-pattern loop whose completion
# ORACLE is `ztrack check` (deterministic), not a trusted phrase.
#
# ARMED via `ztrack loop start <issue>`. While armed, the agent's turn can't end until the
# issue passes the check (then the loop disarms itself), or the per-session iteration cap
# trips. NOT armed → the turn ends normally, so interactive use is never gated. The issue
# is named at arm time, so there's no branch-naming requirement.
#
# Reads the Claude Code hook payload on stdin (uses session_id to scope the iteration
# counter). Exit 0 = allow the turn to end; exit 2 = block (stderr fed back to the agent).
set -uo pipefail

payload="$(cat 2>/dev/null || true)"
session_id="$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$session_id" ] || session_id="nosession"

state_dir="${VOLTER_STATE_DIR:-.volter}"
root="$PWD"
while [ "$root" != "/" ] && [ ! -f "$root/$state_dir/tracker-config.json" ]; do
  root="$(dirname "$root")"
done
marker="$root/$state_dir/.ztrack-loop.json"

# Not armed → ztrack isn't driving this turn → let it end.
[ -f "$marker" ] || exit 0

issue="$(sed -n 's/.*"issue"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$marker" | head -1)"
max="$(sed -n 's/.*"maxIterations"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$marker" | head -1)"; [ -n "$max" ] || max=8

# per-session iteration counter (so the cap bounds THIS loop run, not the whole machine)
iterfile="$root/$state_dir/.ztrack-loop-iter-$session_id"
n="$(cat "$iterfile" 2>/dev/null || echo 0)"; n=$((n + 1)); printf '%s' "$n" > "$iterfile"
if [ "$n" -gt "$max" ]; then
  rm -f "$marker" "$iterfile"
  echo "ztrack loop: hit the iteration cap ($max) for $issue without going green — stopping. Run 'ztrack check' to see what's left, then re-arm to keep going." >&2
  exit 0
fi

ztrack_bin="${ZTRACK_BIN:-$root/node_modules/.bin/ztrack}"
if [ ! -x "$ztrack_bin" ]; then
  echo "ztrack loop: armed for $issue but ztrack isn't installed at $root. Run 'npm i -D ztrack' or set ZTRACK_BIN." >&2
  exit 2
fi

# --auto-scope validates the whole tracker but exits nonzero only on THIS armed issue;
# ZTRACK_ACTIVE_ISSUE pins it so other red issues don't hold this loop.
out="$(cd "$root" && ZTRACK_ACTIVE_ISSUE="$issue" "$ztrack_bin" check --auto-scope 2>&1)"
code=$?
if [ "$code" -eq 0 ]; then
  rm -f "$marker" "$iterfile"
  echo "ztrack loop: $issue is green — done." >&2
  exit 0
fi
{
  echo "ztrack loop ($issue): not done yet — resolve these before the turn can end:"
  echo "$out" | tail -50
} >&2
exit 2
