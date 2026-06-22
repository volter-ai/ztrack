#!/usr/bin/env bash
# ztrack-gate — Claude Code Stop hook (shipped by the ztrack-gate plugin).
#
# Holds the agent's turn open while the active issue's `ztrack check --auto-scope` is red,
# so an autonomous loop can't end until the work is formally done. SELF-GATING: it only
# acts in a repo that has a ztrack tracker and allows the turn to end everywhere else — so
# enabling the plugin globally is safe and never bothers you in untracked repos.
#
# --auto-scope validates the whole tracker (cross-issue rules stay correct) but exits
# nonzero only on the issue THIS git checkout is for (resolved from the branch/worktree
# name); other issues are informational, and unresolved scope fails closed.
#
# Runs the repo's OWN installed ztrack (binary == library — the same engine the repo-local
# preset imports). Override the binary with ZTRACK_BIN.
# Exit 0 = allow the turn to end; exit 2 = block (stderr is shown to the agent).
set -uo pipefail

state_dir="${VOLTER_STATE_DIR:-.volter}"

# Find the nearest ancestor holding a ztrack tracker; none → ztrack doesn't govern here,
# so let the turn end (this is what makes global enablement safe).
root="$PWD"
while [ "$root" != "/" ] && [ ! -f "$root/$state_dir/tracker-config.json" ]; do
  root="$(dirname "$root")"
done
[ -f "$root/$state_dir/tracker-config.json" ] || exit 0

# A tracker is present → run that repo's installed ztrack. The repo-local preset imports
# ztrack, so it must be a dependency there.
ztrack_bin="${ZTRACK_BIN:-$root/node_modules/.bin/ztrack}"
if [ ! -x "$ztrack_bin" ]; then
  echo "ztrack-gate: a tracker exists at $root/$state_dir but ztrack is not installed there." >&2
  echo "Add it as a dependency (npm i -D ztrack) or set ZTRACK_BIN to its path." >&2
  exit 2
fi

out="$(cd "$root" && "$ztrack_bin" check --auto-scope 2>&1)"
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
fi
{
  echo "ztrack check (auto-scoped to this branch) is failing — produce the missing evidence or fix the findings before ending the turn:"
  echo "$out" | tail -60
} >&2
exit 2
