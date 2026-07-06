#!/usr/bin/env bash
# Deterministic CI coverage for the ztrack loop — everything in demos/loop-e2e.sh that does
# NOT need a live agent. It drives the real Stop hook (plugins/ztrack/hooks/stop-loop.sh)
# with crafted session_id payloads and asserts on its exit codes, and exercises the real
# `ztrack waiver` CLI round-trip (the eslint-`disable`-style per-finding waiver). No model
# calls, so it runs in CI. Uses the `default` preset.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="$repo_root/plugins/ztrack/hooks/stop-loop.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tarball="$(cd "$repo_root" && npm pack --pack-destination "$tmp" --silent)"

new_repo() { # $1=name [$2=preset] -> echoes dir; fresh git repo with ztrack installed + a tracker
  local d="$tmp/$1"; mkdir -p "$d"; ( cd "$d"
    git init -q; git config user.email ci@example.com; git config user.name "loop ci"
    echo "# $1" > README.md; git add README.md; git commit -q -m init
    npm init -y >/dev/null; npm install "$tmp/$tarball" >/dev/null
    npx ztrack init --team APP --preset "${2:-default}" >/dev/null )
  printf '%s' "$d"
}
mk_issue() { local body="${2//COMMIT/$(cd "$1" && git rev-parse HEAD)}"; printf '%s' "$body" > "$1/body.md"; ( cd "$1" && npx ztrack issue create --title Task --label type:case --state ready --assignee t --body-file body.md >/dev/null ); }
arm()  { ( cd "$1" && npx ztrack loop start APP-1 --max "${2:-5}" >/dev/null ); }
# helpers that CAPTURE a non-zero exit (so `set -e` doesn't abort): cmd && rc=0 || rc=$?
fire() { local rc; ( cd "$1" && printf '{"session_id":"%s"}' "$2" | bash "$hook" >/dev/null 2>&1 ) && rc=0 || rc=$?; echo "$rc"; }
fire_msg() { ( cd "$1" && printf '{"session_id":"%s"}' "$2" | bash "$hook" 2>&1 >/dev/null ) || true; }  # echoes the hook's held message
count_state() { find "$1/.volter" -maxdepth 1 \( -name '.ztrack-loop-iter-*' -o -name '.ztrack-loop-exempt-*' \) 2>/dev/null | wc -l | tr -d ' '; }
chk()  { local rc; ( cd "$1" && npx ztrack check >/dev/null 2>&1 ) && rc=0 || rc=$?; echo "$rc"; }
armed(){ [ -f "$1/.volter/.ztrack-loop.json" ] && echo YES || echo NO; }
# Count FINDINGS of a code, not raw text hits: self-documenting fix hints (the `↳ Fix:` line)
# also mention the code (e.g. `waiver sign … --code <code>`), so exclude those hint lines.
greps(){ ( cd "$1" && npx ztrack check 2>&1 ) | grep "$2" | grep -cv '↳' || true; }

# default grammar: a passed AC with REAL-commit evidence but NO proof -> exactly one
# (waivable) finding, `passed_ac_missing_proof` (COMMIT is substituted with the repo HEAD by
# mk_issue, so evidence_commit_not_found stays quiet). A pending AC -> no findings (green).
red=$'## Acceptance Criteria\n\n- [x] dev/01 v1 do the thing\n  - status: passed\n  - evidence ev1: commit=COMMIT acv=1\n'
green=$'## Acceptance Criteria\n\n- [ ] dev/01 v1 do the thing\n  - status: pending\n'

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

echo "## SubagentStop decision table (real hook, real ztrack, SubagentStop-shaped payloads: session_id + agent_id)"
# ACTOR = agent_id when present (a subagent turn), else session_id — see stop-loop.sh. These
# helpers craft SubagentStop-shaped payloads; fire()/fire_msg() above still cover bare-session
# (Stop) payloads, and the R3/gitignore sections above prove those are byte-for-byte unaffected.
fire_sub() { local rc; ( cd "$1" && printf '{"session_id":"%s","agent_id":"%s","hook_event_name":"SubagentStop"}' "$2" "$3" | bash "$hook" >/dev/null 2>&1 ) && rc=0 || rc=$?; echo "$rc"; }
fire_sub_msg() { ( cd "$1" && printf '{"session_id":"%s","agent_id":"%s","hook_event_name":"SubagentStop"}' "$2" "$3" | bash "$hook" 2>&1 >/dev/null ) || true; }

d="$(new_repo subarmedred)"; mk_issue "$d" "$red"; arm "$d"
ok "$(fire_sub "$d" S1 A1)" 2 "SubagentStop: armed + red -> held (exit 2)"
ok "$(armed "$d")" YES "a held subagent turn keeps the loop armed"

d="$(new_repo subarmedgreen)"; mk_issue "$d" "$green"; arm "$d"
ok "$(fire_sub "$d" S1 A1)" 0 "SubagentStop: armed + green -> released (exit 0)"
ok "$(armed "$d")" NO "going green disarms the loop from a subagent's turn too"

d="$(new_repo subexempt)"; mk_issue "$d" "$red"; arm "$d"
: > "$d/.volter/.ztrack-loop-exempt-A1"
ok "$(fire_sub "$d" S1 A1)" 0 "A1's own exemption is honored for A1"
ok "$(fire_sub "$d" S1 A2)" 2 "a DIFFERENT agent_id (A2), same session S1, is still held -- the exemption does not leak"
ok "$(fire "$d" S1)" 2 "the bare session S1 (no agent_id) is still held too -- A1's exemption doesn't cover its parent session"
ok "$(armed "$d")" YES "an exemption keeps the loop armed for every other actor"

d="$(new_repo subiter)"; mk_issue "$d" "$red"; arm "$d" 2
fire_sub "$d" S1 A1 >/dev/null; fire_sub "$d" S1 A1 >/dev/null   # A1's iterations 1,2 (held) -- must not touch S1's own counter
ok "$(fire "$d" S1)" 2 "a bare-S1 payload after two A1-held turns is STILL held (S1's own counter is only at 1), not capped"
ok "$(armed "$d")" YES "per-actor counters: A1's held turns didn't push the bare session's counter past the cap"

echo "## arm-collision refusal (src/cliLoop.ts \`loop start\`)"
collision_rc()  { local rc; ( cd "$1" && npx ztrack loop start "$2" >/dev/null 2>&1 ) && rc=0 || rc=$?; echo "$rc"; }
collision_msg() { ( cd "$1" && npx ztrack loop start "$2" 2>&1 >/dev/null ) || true; }

d="$(new_repo collision)"; mk_issue "$d" "$red"
( cd "$d" && npx ztrack issue create --title Second --label type:case --state ready --assignee t --body-file body.md >/dev/null )  # APP-2
arm "$d"   # arms APP-1
before="$(cat "$d/.volter/.ztrack-loop.json")"
ok "$(collision_rc "$d" APP-2)" 1 "arming a DIFFERENT target while armed refuses (nonzero exit)"
msg="$(collision_msg "$d" APP-2)"
ok "$([ "$(printf '%s' "$msg" | grep -c 'already armed')" -ge 1 ] && echo YES || echo NO)" YES "the refusal names what's already armed"
after="$(cat "$d/.volter/.ztrack-loop.json")"
ok "$([ "$before" = "$after" ] && echo YES || echo NO)" YES "the marker is unchanged by the refused arm"
ok "$(collision_rc "$d" APP-1)" 0 "re-arming the SAME target succeeds (a refresh, not a collision)"

echo "## ZTRACK_TRACKER_ROOT (cross-repo/cross-worktree shape, e.g. a subagent cwd'd elsewhere)"
fire_envroot()     { local rc; ( cd "$1" && printf '{"session_id":"%s"}' "$3" | ZTRACK_TRACKER_ROOT="$2" bash "$hook" >/dev/null 2>&1 ) && rc=0 || rc=$?; echo "$rc"; }
fire_envroot_msg() { ( cd "$1" && printf '{"session_id":"%s"}' "$3" | ZTRACK_TRACKER_ROOT="$2" bash "$hook" 2>&1 >/dev/null ) || true; }

d="$(new_repo envroot)"; mk_issue "$d" "$red"; arm "$d"
outside="$tmp/outside-envroot"; mkdir -p "$outside"
ok "$(fire_envroot "$outside" "$d" E1)" 2 "ZTRACK_TRACKER_ROOT pointing at the armed tracker holds, even though cwd is OUTSIDE it"
ok "$(armed "$d")" YES "cross-repo hold via ZTRACK_TRACKER_ROOT doesn't disturb the armed marker"

no_tracker="$tmp/no-tracker-envroot"; mkdir -p "$no_tracker"
ok "$(fire_envroot "$outside" "$no_tracker" E1)" 0 "ZTRACK_TRACKER_ROOT pointing at a dir with no tracker -> exit 0 (fail open, never trap on a typo)"
warn_msg="$(fire_envroot_msg "$outside" "$no_tracker" E1)"
ok "$([ "$(printf '%s' "$warn_msg" | grep -c 'ZTRACK_TRACKER_ROOT')" -ge 1 ] && echo YES || echo NO)" YES "...and prints a one-line warning naming ZTRACK_TRACKER_ROOT on stderr"

echo "## waiver CLI round-trip (eslint-disable-style: per-finding, signed off as git identity)"
d="$(new_repo waiver)"; mk_issue "$d" "$red"
ok "$(chk "$d")" 1 "the unwaived issue is red (passed AC, no proof)"
( cd "$d" && npx ztrack waiver sign APP-1 --code passed_ac_missing_proof --reason "proof is in the linked PR" >/dev/null )
ok "$(chk "$d")" 0 "a signed waiver for that finding -> acknowledged -> passes"
( cd "$d" && git commit --allow-empty -q -m "unrelated work" )
ok "$(chk "$d")" 0 "an unrelated commit does NOT affect it (the waiver tracks the finding, not HEAD)"

d="$(new_repo unused)"; mk_issue "$d" "$green"
( cd "$d" && npx ztrack waiver sign APP-1 --code passed_ac_missing_proof --reason "preemptive" >/dev/null )
ok "$([ "$(greps "$d" waiver_unused)" -ge 1 ] && echo YES || echo NO)" YES "a waiver that matches no finding reports waiver_unused"
ok "$(chk "$d")" 0 "but waiver_unused is a warning — check still passes"

d="$(new_repo unreasoned)"; mk_issue "$d" "$red"
( cd "$d" && npx ztrack issue view APP-1 --json body 2>/dev/null \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['body'].rstrip()+'\n\n## Waivers\n\n- code: passed_ac_missing_proof by: someone\n')" > u.md \
  && npx ztrack issue edit APP-1 --body-file u.md >/dev/null )
ok "$(chk "$d")" 1 "an unreasoned waiver does not pass"
ok "$([ "$(greps "$d" waiver_missing_reason)" -ge 1 ] && echo YES || echo NO)" YES "and it reports waiver_missing_reason"

echo "## review-fix regressions — through the REAL packed+installed ztrack CLI (not just unit tests)"

echo "# H1: exactly one missing-blocker (dev/99); a real blocker on dev/01 is resolved, not a phantom"
d="$(new_repo h1)"
printf '## Acceptance Criteria\n\n- [ ] dev/01 v1 First.\n  - status: pending\n- [ ] dev/02 v1 Wait.\n  - status: pending\n  - blocked-by: dev/01\n- [ ] dev/03 v1 Y.\n  - status: pending\n  - blocked-by: dev/99\n' > "$d/body.md"
( cd "$d" && npx ztrack issue create --title T --label type:case --state ready --assignee t --body-file body.md >/dev/null )
ok "$(greps "$d" 'ac_blocker_missing')" 1 "exactly one missing-blocker (dev/99); dev/01 is resolved, not a phantom"

echo "# H2: a per-finding waiver clears a readiness error but NOT a structural self-block"
d="$(new_repo h2)"
printf '## Acceptance Criteria\n\n- [x] dev/01 v1 do the thing\n  - status: passed\n  - evidence ev1: commit=deadbeef acv=1\n- [ ] dev/02 v1 Loop.\n  - status: pending\n  - blocked-by: dev/02\n' > "$d/body.md"
( cd "$d" && npx ztrack issue create --title T --label type:case --state ready --assignee t --body-file body.md >/dev/null )
ok "$(chk "$d")" 1 "unwaived: red (missing proof + self-block)"
( cd "$d" && npx ztrack waiver sign APP-1 --code passed_ac_missing_proof --reason "proof in PR" >/dev/null )
ok "$(chk "$d")" 1 "after waiving the proof finding: STILL red — the self-block is non-waivable"
ok "$([ "$(greps "$d" 'ac_self_block')" -ge 1 ] && echo YES || echo NO)" YES "ac_self_block is still reported (not acknowledged) post-waiver"

echo "## R1: the self-exempt path is offered only past the half-way point of the budget"
d="$(new_repo r1)"; mk_issue "$d" "$red"; arm "$d" 6
early="$(fire_msg "$d" R1)"                                   # n=1 (1*2 <= 6) -> not offered
fire_msg "$d" R1 >/dev/null; fire_msg "$d" R1 >/dev/null      # n=2,3
late="$(fire_msg "$d" R1)"                                    # n=4 (4*2 > 6) -> offered
ok "$(printf '%s' "$early" | grep -c 'ztrack-loop-exempt-')" 0 "no exempt path on an early held turn (keep working)"
ok "$([ "$(printf '%s' "$late" | grep -c 'ztrack-loop-exempt-')" -ge 1 ] && echo YES || echo NO)" YES "exempt path offered once past half the budget"

echo "## R2: the iteration cap holds-and-surfaces (breadcrumb + status), never a silent vanish"
d="$(new_repo r2)"; mk_issue "$d" "$red"; arm "$d" 2
fire "$d" R2 >/dev/null; fire "$d" R2 >/dev/null              # n=1,2 held
ok "$(fire "$d" R2)" 0 "the turn past --max releases (exit 0, not trapped)"
ok "$(armed "$d")" NO "the cap removes the arm marker"
ok "$([ -f "$d/.volter/.ztrack-loop-capped.json" ] && echo YES || echo NO)" YES "and leaves a capped breadcrumb"
ok "$(fire "$d" FRESH)" 0 "a fresh session is not trapped after a cap (not armed -> exit 0)"
ok "$([ "$( ( cd "$d" && npx ztrack loop status ) | grep -c capped )" -ge 1 ] && echo YES || echo NO)" YES "loop status reports the cap"
( cd "$d" && npx ztrack loop start APP-1 --max 2 >/dev/null )
ok "$([ -f "$d/.volter/.ztrack-loop-capped.json" ] && echo YES || echo NO)" NO "re-arming clears the breadcrumb"

echo "## R3: any disarm sweeps EVERY session's iter/exempt files (no stale litter)"
d="$(new_repo r3)"; mk_issue "$d" "$green"; arm "$d" 5
: > "$d/.volter/.ztrack-loop-iter-DEAD"; : > "$d/.volter/.ztrack-loop-exempt-DEAD"   # stray from a dead session
fire "$d" R3 >/dev/null                                       # green -> disarm -> sweep all
ok "$(count_state "$d")" 0 "going green sweeps every session's iter/exempt files"
d="$(new_repo r3stop)"; mk_issue "$d" "$red"; arm "$d" 5
: > "$d/.volter/.ztrack-loop-iter-X"; : > "$d/.volter/.ztrack-loop-exempt-X"
( cd "$d" && npx ztrack loop stop >/dev/null )
ok "$(count_state "$d")" 0 "loop stop sweeps stray iter/exempt files"

echo "# gitignore migration: loop start re-adds the ignore patterns on a repo that lacked them"
d="$(new_repo gi)"
grep -v 'ztrack-loop' "$d/.gitignore" > "$d/.gi.tmp" && mv "$d/.gi.tmp" "$d/.gitignore"   # simulate a pre-loop init
ok "$(grep -c 'ztrack-loop' "$d/.gitignore" || true)" 0 "precondition: loop ignore lines absent"
mk_issue "$d" "$red"
( cd "$d" && npx ztrack loop start APP-1 --max 5 >/dev/null )
ok "$([ "$(grep -c 'ztrack-loop-exempt' "$d/.gitignore")" -ge 1 ] && echo YES || echo NO)" YES "loop start migrated the .gitignore (exempt files now ignored)"

echo
if [ "$fails" -eq 0 ]; then echo "loop-gate-ci: ALL PASS"; else echo "loop-gate-ci: $fails FAIL"; exit 1; fi
