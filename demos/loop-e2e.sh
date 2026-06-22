#!/usr/bin/env bash
# REAL end-to-end test of the ztrack loop: a live headless Claude Code agent driven by the
# armed-loop Stop hook + real `ztrack check`. Proves the loop's distinguishing behavior
# (not the always-on gate): armed+red holds the turn, armed+green releases, not-armed is
# free. Asserts on num_turns from the agent's JSON result.
#
# Needs the `claude` CLI logged in (or CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY) and
# network. Uses Haiku for speed/cost. Override model with LOOP_E2E_MODEL.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="$repo_root/plugins/ztrack-gate/hooks/stop-loop.sh"
model="${LOOP_E2E_MODEL:-haiku}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tarball="$(cd "$repo_root" && npm pack --pack-destination "$tmp" --silent)"

# a checked AC with no commit/evidence is RED for the basic preset; an unchecked AC is GREEN.
red_body=$'# Task\n\n## Acceptance Criteria\n\n- [x] AC-01 do the thing\n\n## Evidence\n'
green_body=$'# Task\n\n## Acceptance Criteria\n\n- [ ] AC-01 do the thing\n\n## Evidence\n'

setup() { # $1=name $2=red|green $3=arm|noarm  -> echoes the repo dir
  local d="$tmp/$1"; mkdir -p "$d"; ( cd "$d"
    git init -q; git config user.email e2e@example.com; git config user.name "loop e2e"
    echo "# $1" > README.md; git add README.md; git commit -q -m init
    npm init -y >/dev/null; npm install "$tmp/$tarball" >/dev/null
    npx ztrack init --team APP --preset basic >/dev/null
    [ "$2" = red ] && printf '%s' "$red_body" > body.md || printf '%s' "$green_body" > body.md
    npx ztrack issue create --title "Task" --label type:case --state "In Progress" --assignee tester --body-file body.md >/dev/null
    [ "$3" = arm ] && npx ztrack loop start APP-1 --max 2 >/dev/null
  )
  printf '%s' "$d"
}

setup_multi() { # $1=name $2=arm-issue  -> APP-1 green, APP-2 red; arms $2; echoes dir
  local d="$tmp/$1"; mkdir -p "$d"; ( cd "$d"
    git init -q; git config user.email e2e@example.com; git config user.name "loop e2e"
    echo "# $1" > README.md; git add README.md; git commit -q -m init
    npm init -y >/dev/null; npm install "$tmp/$tarball" >/dev/null
    npx ztrack init --team APP --preset basic >/dev/null
    printf '%s' "$green_body" > g.md; npx ztrack issue create --title G --label type:case --state "In Progress" --assignee tester --body-file g.md >/dev/null
    printf '%s' "$red_body"   > r.md; npx ztrack issue create --title R --label type:case --state "In Progress" --assignee tester --body-file r.md >/dev/null
    npx ztrack loop start "$2" --max 2 >/dev/null
  )
  printf '%s' "$d"
}

done_prompt="Reply with exactly the single word DONE and take no other action."
run() { # $1=dir $2=prompt -> echoes the agent JSON result
  ( cd "$1" && timeout 300 claude -p "$2" \
      --model "$model" --output-format json --permission-mode bypassPermissions \
      --settings "{\"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"bash '$hook'\"}]}]}}" \
      2>/dev/null )
}
turns() { printf '%s' "$1" | sed -n 's/.*"num_turns":\([0-9]*\).*/\1/p' | head -1; }
verdict() { [ "${1:-0}" "$2" "$3" ] && echo PASS || echo "FAIL"; }

fails=0
echo "=== A. armed + RED  → agent is HELD (num_turns > 1) ==="
out="$(run "$(setup armed-red red arm)" "$done_prompt")"; t="$(turns "$out")"; v="$(verdict "$t" -gt 1)"; echo "   num_turns=$t  $v"; [ "$v" = PASS ] || { fails=$((fails+1)); echo "$out" | head -c 400; echo; }

echo "=== B. armed + GREEN → agent is RELEASED (num_turns == 1) ==="
out="$(run "$(setup armed-green green arm)" "$done_prompt")"; t="$(turns "$out")"; v="$(verdict "$t" -eq 1)"; echo "   num_turns=$t  $v"; [ "$v" = PASS ] || { fails=$((fails+1)); echo "$out" | head -c 400; echo; }

echo "=== C. NOT armed + red tracker → agent is FREE (num_turns == 1) ==="
out="$(run "$(setup not-armed red noarm)" "$done_prompt")"; t="$(turns "$out")"; v="$(verdict "$t" -eq 1)"; echo "   num_turns=$t  $v"; [ "$v" = PASS ] || { fails=$((fails+1)); echo "$out" | head -c 400; echo; }

echo "=== D. multi-issue scoping: arm the GREEN issue while another is RED → released ==="
d="$(setup_multi scoping APP-1)"
g_exit="$( (cd "$d" && ZTRACK_ACTIVE_ISSUE=APP-1 npx ztrack check --auto-scope >/dev/null 2>&1); echo $? )"
r_exit="$( (cd "$d" && ZTRACK_ACTIVE_ISSUE=APP-2 npx ztrack check --auto-scope >/dev/null 2>&1); echo $? )"
echo "   deterministic scoped check: APP-1 exit=$g_exit (want 0), APP-2 exit=$r_exit (want 1)"
{ [ "$g_exit" = 0 ] && [ "$r_exit" = 1 ]; } || { fails=$((fails+1)); echo "   FAIL: scoping override"; }
out="$(run "$d" "$done_prompt")"; t="$(turns "$out")"; v="$(verdict "$t" -eq 1)"; echo "   agent armed APP-1 → num_turns=$t  $v (released despite APP-2 red)"; [ "$v" = PASS ] || { fails=$((fails+1)); echo "$out" | head -c 400; echo; }

echo "=== E. drives-to-done: a live agent FIXES the issue → loop releases on real green ==="
d="$tmp/converge"; mkdir -p "$d"; ( cd "$d"
  git init -q; git config user.email e2e@example.com; git config user.name "loop e2e"
  echo "# c" > README.md; git add README.md; git commit -q -m init
  npm init -y >/dev/null; npm install "$tmp/$tarball" >/dev/null
  npx ztrack init --team APP --preset basic >/dev/null
  printf '# Task\n\n## Acceptance Criteria\n\n- [ ] AC-01 do the thing status: passed\n\n## Evidence\n' > body.md
  npx ztrack issue create --title "Task" --label type:case --state "In Progress" --assignee tester --body-file body.md >/dev/null
  npx ztrack loop start APP-1 --max 6 >/dev/null )
fix_prompt="The ztrack check is failing on issue APP-1 with a checkbox/status mismatch. In this directory, edit the file body.md so the acceptance-criteria line reads exactly \"- [ ] AC-01 do the thing\" (remove the trailing \" status: passed\"), then run \"npx ztrack issue edit APP-1 --body-file body.md\". Do it now."
out="$(run "$d" "$fix_prompt")"
green_exit="$( (cd "$d" && npx ztrack check >/dev/null 2>&1); echo $? )"
disarmed="$( [ -f "$d/.volter/.ztrack-loop.json" ] && echo NO || echo YES )"
v="$( { [ "$green_exit" = 0 ] && [ "$disarmed" = YES ]; } && echo PASS || echo FAIL )"
echo "   after the agent: ztrack check exit=$green_exit (want 0), loop disarmed=$disarmed (want YES)  $v"
[ "$v" = PASS ] || { fails=$((fails+1)); echo "$out" | head -c 400; echo; }

echo "=== F. disarm escape: arm a red issue, then \`ztrack loop stop\` → agent is FREE ==="
d="$(setup disarm red arm)"; ( cd "$d" && npx ztrack loop stop >/dev/null )
out="$(run "$d" "$done_prompt")"; t="$(turns "$out")"; v="$(verdict "$t" -eq 1)"; echo "   disarmed before run → num_turns=$t  $v (free, though the issue stays red)"; [ "$v" = PASS ] || { fails=$((fails+1)); echo "$out" | head -c 400; echo; }

echo
if [ "$fails" -eq 0 ]; then echo "loop e2e: ALL PASS (real agent, real hook, real ztrack)"; else echo "loop e2e: $fails FAIL"; exit 1; fi
