#!/usr/bin/env bash
# Claude Code Stop hook: the agent's turn cannot end while `ztrack check` is red.
#
# --auto-scope makes the gate adapt to the worktree it runs in: it validates the
# whole tracker (so cross-issue rules stay correct) but only EXITS NONZERO on the
# issue THIS checkout is for — resolved from the git branch/worktree name. Other
# issues are surfaced as informational, not blocking. Unresolved scope fails closed
# (gates everything). Drop the same hook into N worktrees and each scopes itself —
# no shared marker file, no coordination. (A worktree sees the issues only when the
# store is committed — the default for a LOCAL tracker. A tracker LINKED to GitHub
# gitignores the store, so run `ztrack sync` in the worktree first to populate it.)
#
# IMPORTANT: the repo-local preset (.volter/tracker/validation/preset.mts) imports ztrack
# via `import 'ztrack/preset-kit'`, so ztrack must be an INSTALLED dependency of this
# repo — and the check must run THAT installed copy, the same engine the preset imports
# (binary == library). This hook invokes the LOCAL binary and never `npx --yes ztrack`,
# which could fetch a different "latest" version and then fail the preset's require.
# Pinning is then just your lockfile: "done" only changes on a reviewed dependency bump.
# (Set ZTRACK_BIN to override the path in a monorepo/workspace.)
#
# Wire in .claude/settings.json:
#   {"hooks": {"Stop": [{"hooks": [{"type": "command",
#     "command": "bash node_modules/ztrack/hooks/stop-check.sh"}]}]}}
# Exit 0 = allow turn end; exit 2 = block (stderr is shown to the agent).
set -uo pipefail

ztrack_bin="${ZTRACK_BIN:-node_modules/.bin/ztrack}"
if [ ! -x "$ztrack_bin" ]; then
  {
    echo "ztrack is not installed in this repo, but the repo-local preset imports it (require('ztrack/preset-kit'))."
    echo "Add it as a dependency — npm i -D ztrack  (or pnpm add -D ztrack / yarn add -D ztrack) — or set ZTRACK_BIN to its path."
    echo "The Stop gate cannot run without it."
  } >&2
  exit 2
fi

out="$("$ztrack_bin" check --auto-scope 2>&1)"
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
fi
{
  echo "ztrack check (auto-scoped to this branch) is failing — produce the missing evidence or fix the findings before ending the turn:"
  echo "$out" | tail -60
} >&2
exit 2
