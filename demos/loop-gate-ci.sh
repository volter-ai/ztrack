#!/usr/bin/env bash
# Deterministic CI coverage for the ztrack loop — everything in demos/loop-e2e.sh that does
# NOT need a live agent. It drives the real Stop hook (plugins/ztrack-gate/hooks/stop-loop.sh)
# with crafted session_id payloads and asserts on its exit codes, and exercises the real
# `ztrack waiver` CLI round-trip. No model calls, so it runs in CI.
#
# (The live-agent cases — that an agent is actually held/released/self-exempts — stay a
#  manual demo in loop-e2e.sh. Descope is covered by the engine unit tests in
#  src/presetKit.test.ts; it has no novel CLI surface, just normal issue authoring.)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="$repo_root/plugins/ztrack-gate/hooks/stop-loop.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tarball="$(cd "$repo_root" && npm pack --pack-destination "$tmp" --silent)"

new_repo() { # $1=name -> echoes dir; fresh git repo with ztrack installed + a basic tracker
  local d="$tmp/$1"; mkdir -p "$d"; ( cd "$d"
    git init -q; git config user.email ci@example.com; git config user.name "loop ci"
    echo "# $1" > README.md; git add README.md; git commit -q -m init
    npm init -y >/dev/null; npm install "$tmp/$tarball" >/dev/null
    npx ztrack init --team APP --preset basic >/dev/null )
  printf '%s' "$d"
}
mk_issue() { printf '%s' "$2" > "$1/body.md"; ( cd "$1" && npx ztrack issue create --title Task --label type:case --state "In Progress" --assignee t --body-file body.md >/dev/null ); }
arm()  { ( cd "$1" && npx ztrack loop start APP-1 --max "${2:-5}" >/dev/null ); }
# helpers that CAPTURE a non-zero exit (so `set -e` doesn't abort): cmd && rc=0 || rc=$?
fire() { local rc; ( cd "$1" && printf '{"session_id":"%s"}' "$2" | bash "$hook" >/dev/null 2>&1 ) && rc=0 || rc=$?; echo "$rc"; }
chk()  { local rc; ( cd "$1" && npx ztrack check >/dev/null 2>&1 ) && rc=0 || rc=$?; echo "$rc"; }
armed(){ [ -f "$1/.volter/.ztrack-loop.json" ] && echo YES || echo NO; }
greps(){ ( cd "$1" && npx ztrack check 2>&1 ) | grep -c "$2" || true; }

red=$'# Task\n\n## Acceptance Criteria\n\n- [x] AC-01 do the thing\n\n## Evidence\n'    # checked, no commit/evidence -> red
green=$'# Task\n\n## Acceptance Criteria\n\n- [ ] AC-01 do the thing\n\n## Evidence\n'   # pending -> green

fails=0
ok() { if [ "$1" = "$2" ]; then echo "  ok: $3"; else echo "  FAIL: $3 (got '$1' want '$2')"; fails=$((fails+1)); fi; }

echo "## Stop hook decision table (real hook, real ztrack, crafted session payloads)"
d="$(new_repo notarmed)"; mk_issue "$d" "$red"
ok "$(fire "$d" S1)" 0 "not armed -> the turn ends (interactive use is never gated)"

d="$(new_repo armedred)"; mk_issue "$d" "$red"; arm "$d"
ok "$(fire "$d" S1)" 2 "armed + red -> held (exit 2)"
ok "$(armed "$d")" YES "a held turn keeps the loop armed"

d="$(new_repo armedgreen)"; mk_issue "$d" "$green"; arm "$d"
ok "$(fire "$d" S1)" 0 "armed + green -> released (exit 0)"
ok "$(armed "$d")" NO "going green disarms the loop"

d="$(new_repo exempt)"; mk_issue "$d" "$red"; arm "$d"
: > "$d/.volter/.ztrack-loop-exempt-S1"
ok "$(fire "$d" S1)" 0 "a session's own exemption is honored"
ok "$(fire "$d" S2)" 2 "a DIFFERENT session is still held (the exemption does not leak)"
ok "$(armed "$d")" YES "an exemption keeps the loop armed for fresh sessions"

d="$(new_repo cap)"; mk_issue "$d" "$red"; arm "$d" 2
fire "$d" CAP >/dev/null; fire "$d" CAP >/dev/null   # iterations 1,2 (held)
ok "$(fire "$d" CAP)" 0 "the iteration past --max trips the cap and releases"
ok "$(armed "$d")" NO "hitting the cap disarms the loop"

echo "## waiver CLI round-trip (sign-off = git identity; AC-only freshness)"
d="$(new_repo waiver)"; mk_issue "$d" "$red"
ok "$(chk "$d")" 1 "the unwaived issue is red"
( cd "$d" && npx ztrack waiver sign APP-1 --reason "infra gap, tracked separately" >/dev/null )
ok "$(chk "$d")" 0 "a fresh signed waiver -> acknowledged -> passes"
( cd "$d" && git commit --allow-empty -q -m "unrelated work" )
ok "$(chk "$d")" 0 "an unrelated commit does NOT stale it (anchored to the ACs, not HEAD)"
( cd "$d" && npx ztrack issue view APP-1 --json body 2>/dev/null \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['body'].replace('do the thing','do a DIFFERENT thing'))" > edited.md \
  && npx ztrack issue edit APP-1 --body-file edited.md >/dev/null )
ok "$(chk "$d")" 1 "editing the acceptance criterion stales the waiver"

d="$(new_repo unreasoned)"; mk_issue "$d" "$red"
printf '# Task\n\n## Acceptance Criteria\n\n- [x] AC-01 do the thing\n\n## Evidence\n\n## Waiver\n\nby: someone\nac-version: acw_deadbeef00\n' > "$d/u.md"
( cd "$d" && npx ztrack issue edit APP-1 --body-file u.md >/dev/null )
ok "$(chk "$d")" 1 "an unreasoned waiver does not pass"
ok "$([ "$(greps "$d" waiver_missing_reason)" -ge 1 ] && echo YES || echo NO)" YES "and it reports waiver_missing_reason"

echo
if [ "$fails" -eq 0 ]; then echo "loop-gate-ci: ALL PASS"; else echo "loop-gate-ci: $fails FAIL"; exit 1; fi
