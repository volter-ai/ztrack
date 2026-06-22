#!/usr/bin/env bash
# Claude Code Stop hook: the agent's turn cannot end while `ztrack check` is red.
#
# --auto-scope makes the gate adapt to the worktree it runs in: it validates the
# whole tracker (so cross-issue rules stay correct) but only EXITS NONZERO on the
# issue THIS checkout is for — resolved from the git branch/worktree name. Other
# issues are surfaced as informational, not blocking. Unresolved scope fails closed
# (gates everything). Drop the same hook into N worktrees and each scopes itself —
# no shared marker file, no coordination.
#
# Wire in .claude/settings.json:
#   {"hooks": {"Stop": [{"hooks": [{"type": "command",
#     "command": "bash node_modules/ztrack/hooks/stop-check.sh"}]}]}}
# Exit 0 = allow turn end; exit 2 = block (stderr is shown to the agent).
set -uo pipefail
out="$(npx --yes ztrack check --auto-scope 2>&1)"
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
fi
{
  echo "ztrack check (auto-scoped to this branch) is failing — produce the missing evidence or fix the findings before ending the turn:"
  echo "$out" | tail -60
} >&2
exit 2
