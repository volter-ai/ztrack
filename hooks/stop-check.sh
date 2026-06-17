#!/usr/bin/env bash
# Claude Code Stop hook: the agent's turn cannot end while `ztrack check`
# is red. Wire in .claude/settings.json:
#   {"hooks": {"Stop": [{"hooks": [{"type": "command",
#     "command": "bash node_modules/ztrack/hooks/stop-check.sh"}]}]}}
# Exit 0 = allow turn end; exit 2 = block (stderr is shown to the agent).
set -uo pipefail
out="$(npx --yes ztrack check 2>&1)"
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
fi
{
  echo "ztrack check is failing — produce the missing evidence or fix the findings before ending the turn:"
  # Lead with the human-readable ERROR/WARNING lines (most actionable for the
  # agent); fall back to the full output if none were parsed.
  findings="$(echo "$out" | grep -E '^(ERROR|WARNING) ' | head -40)"
  if [ -n "$findings" ]; then echo "$findings"; else echo "$out" | head -40; fi
} >&2
exit 2
