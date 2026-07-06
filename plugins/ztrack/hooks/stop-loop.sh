#!/usr/bin/env bash
# ztrack-loop — Claude Code Stop/SubagentStop hook implementing a ralph-pattern loop whose
# completion ORACLE is `ztrack check` (deterministic), not a trusted phrase.
#
# ARMED via `ztrack loop start <issue>`. While armed, no turn ending in the armed root — the
# main agent's (Stop) or a subagent's (SubagentStop) — can end until the target passes the
# check (then the loop disarms itself), or the per-actor iteration cap trips. NOT armed → the
# turn ends normally, so interactive use is never gated. The issue is named at arm time, so
# there's no branch-naming requirement.
#
# This script is registered identically under both Stop and SubagentStop (hooks.json) and is
# itself event-agnostic: it never reads hook_event_name. The gate is root-scoped, not
# agent-scoped — there is no way to identify who armed the loop, and the design doesn't need
# one. What it DOES need is to keep one actor's held turns from bleeding into another's
# counters/exemptions, so it derives an ACTOR id per turn: the payload's agent_id when present
# (a subagent turn), else its session_id (a main-agent turn) — and keys the iteration counter
# and the exemption escape hatch by that actor id. A bare Stop payload (no agent_id) behaves
# exactly as before: actor == session_id, same filenames.
#
# Reads the Claude Code hook payload on stdin. Exit 0 = allow the turn to end; exit 2 = block
# (stderr fed back to the actor — the subagent itself, for a SubagentStop turn).
set -uo pipefail

payload="$(cat 2>/dev/null || true)"
session_id="$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$session_id" ] || session_id="nosession"
agent_id="$(printf '%s' "$payload" | sed -n 's/.*"agent_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
# The actor a turn is scoped to: a subagent's agent_id when present, else the (main-agent)
# session_id. Bare Stop payload (no agent_id) -> actor == session_id, byte-compatible with the
# pre-SubagentStop behavior.
actor="${agent_id:-$session_id}"

state_dir="${VOLTER_STATE_DIR:-.volter}"
if [ -n "${ZTRACK_TRACKER_ROOT:-}" ]; then
  # Explicit override for the cross-repo/cross-worktree shape (e.g. a subagent whose cwd isn't
  # under the tracker root). Skip the upward walk entirely and trust the caller's root — but
  # fail OPEN (exit 0, warn) on a typo/misconfiguration rather than silently trapping the turn.
  root="$ZTRACK_TRACKER_ROOT"
  if [ ! -f "$root/$state_dir/tracker-config.json" ]; then
    echo "ztrack loop: ZTRACK_TRACKER_ROOT=$root has no tracker at $state_dir/tracker-config.json — skipping the gate for this turn." >&2
    exit 0
  fi
else
  root="$PWD"
  while [ "$root" != "/" ] && [ ! -f "$root/$state_dir/tracker-config.json" ]; do
    root="$(dirname "$root")"
  done
fi
marker="$root/$state_dir/.ztrack-loop.json"

# Not armed → ztrack isn't driving this turn → let it end.
[ -f "$marker" ] || exit 0

# Pin the loop's issue from the marker's canonical target (`{"target":{"ids":["ID"]},...}`); flatten
# first since the marker is pretty-printed. Falls back to the legacy flat "issue" field. For a bare/auto
# or file target there is no id — leave it empty so `check --auto-scope` resolves from the branch instead.
issue="$(tr -d '\n' < "$marker" | sed -n 's/.*"ids"[[:space:]]*:[[:space:]]*\[[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$issue" ] || issue="$(sed -n 's/.*"issue"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$marker" | head -1)"
max="$(sed -n 's/.*"maxIterations"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$marker" | head -1)"; [ -n "$max" ] || max=8

# per-actor exemption: an escape hatch for a stuck actor (a main session or one subagent). The
# file is keyed to THIS actor id, so it's honored only for the actor that created it — a
# different actor (fresh session, a different agent_id, or the bare session vs. one of its own
# subagents) won't match and is held again, and it's gitignored so it can't be committed/shared.
# The loop stays armed (marker kept); this only lets the current actor's turn end.
exempt="$root/$state_dir/.ztrack-loop-exempt-$actor"
if [ -f "$exempt" ]; then
  echo "ztrack loop: $actor is exempt for $issue — letting this turn end. The loop stays armed, so any other actor (a fresh session, another subagent) is still held." >&2
  exit 0
fi

# Sweep ALL of this loop's runtime state on disarm — every actor's iter counter and every
# leftover exemption — not just this actor's, so nothing stale lingers in .volter.
sweep_loop_state() { rm -f "$marker" "$root/$state_dir/.ztrack-loop-iter-"* "$root/$state_dir/.ztrack-loop-exempt-"*; }

# per-actor iteration counter (so the cap bounds THIS actor's loop turns, not the whole machine
# — a subagent's held turns don't advance its parent session's counter, or vice versa)
iterfile="$root/$state_dir/.ztrack-loop-iter-$actor"
n="$(cat "$iterfile" 2>/dev/null || echo 0)"
case "$n" in ''|*[!0-9]*) n=0 ;; esac   # a torn/partial write mustn't crash the arithmetic under set -u
n=$((n + 1)); printf '%s' "$n" > "$iterfile"
if [ "$n" -gt "$max" ]; then
  # Hold-and-surface, don't silently vanish: disarm (so the actor isn't trapped) but leave a
  # gitignored breadcrumb so `ztrack loop status` shows the loop capped on this issue.
  sweep_loop_state
  printf '{"issue":"%s","iterations":%s,"cappedAt":"%s"}\n' "$issue" "$max" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$root/$state_dir/.ztrack-loop-capped.json"
  echo "ztrack loop: hit the iteration cap ($max) for $issue without going green — stopping. 'ztrack loop status' shows this; run 'ztrack check' to see what's left, then 'ztrack loop start' to re-arm." >&2
  exit 0
fi

ztrack_bin="${ZTRACK_BIN:-$root/node_modules/.bin/ztrack}"
if [ ! -x "$ztrack_bin" ]; then
  # The oracle can't run, so the turn is held — but say how to get out, or it's a trap.
  echo "ztrack loop: armed for $issue but ztrack isn't installed at $root. Run 'npm i -D ztrack' (or set ZTRACK_BIN); to stop the loop, 'ztrack loop stop', or to end just this turn create the empty file $state_dir/.ztrack-loop-exempt-$actor." >&2
  exit 2
fi

# --auto-scope validates the whole tracker but exits nonzero only on THIS armed issue;
# ZTRACK_ACTIVE_ISSUE pins it so other red issues don't hold this loop.
out="$(cd "$root" && ZTRACK_ACTIVE_ISSUE="$issue" "$ztrack_bin" check --auto-scope 2>&1)"
code=$?
if [ "$code" -eq 0 ]; then
  sweep_loop_state
  echo "ztrack loop: $issue is green — done." >&2
  exit 0
fi
{
  echo "ztrack loop ($issue): not done yet — resolve these before the turn can end:"
  echo "$out" | tail -50
  # Offer the per-actor hand-back only once the actor is PAST THE HALF-WAY point of the
  # iteration budget — early on the answer is "keep working", not "here's the quit button".
  if [ $((n * 2)) -gt "$max" ]; then
    echo
    echo "If you are genuinely blocked and must hand back to a human, exempt THIS actor only by creating an empty file at: $state_dir/.ztrack-loop-exempt-$actor (this does not disarm the loop; any other actor is still held). Otherwise keep working."
  fi
} >&2
exit 2
