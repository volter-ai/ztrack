#!/usr/bin/env bash
# Real-CLI E2E for `ztrack check` RULE BEHAVIORS — the shipped path: the standalone `default`
# preset the packed+installed CLI writes as `preset.mts`. Primary proof that the check rules
# fire (and stay quiet) correctly through the real CLI. Deterministic, no live agent; CI.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tarball="$(cd "$repo_root" && npm pack --pack-destination "$tmp" --silent)"

fails=0
ok() { if [ "$1" = "$2" ]; then echo "  ok: $3"; else echo "  FAIL: $3 (got '$1' want '$2')"; fails=$((fails+1)); fi; }
yn() { [ "$1" -ge 1 ] && echo Y || echo N; }

new_repo() { local d="$tmp/$1"; mkdir -p "$d"; ( cd "$d"
  git init -q; git config user.email ci@x.com; git config user.name "check e2e"
  echo "# $1" > README.md; git add README.md; git commit -q -m init
  npm init -y >/dev/null; npm install "$tmp/$tarball" >/dev/null
  npx ztrack init --team APP --preset "${2:-default}" >/dev/null ); printf '%s' "$d"; }
# mkissue <repo> <title> <body> [state=ready] [assignee=t]  (pass assignee="" to create an
# EXPLICITLY unassigned issue — a bare create with no --assignee now defaults the assignee
# from git identity (ZTB-7), so the flag must be passed, empty, to mint an unassigned record)
mkissue() { local asg="${5-t}"; ( cd "$1" && printf '%b' "$3" > _b.md \
  && npx ztrack issue create --title "$2" --label type:case --state "${4:-ready}" ${asg+--assignee "$asg"} --body-file _b.md >/dev/null ); }
check_out() { ( cd "$1" && npx ztrack check 2>&1 ) || true; }
chk() { local rc; ( cd "$1" && npx ztrack check >/dev/null 2>&1 ) && rc=0 || rc=$?; echo "$rc"; }
has() { printf '%s' "$1" | grep -c "$2" || true; }
sha() { ( cd "$1" && git rev-parse HEAD ); }

echo "## default preset — wellformedness / evidence / lifecycle / blocking rules fire"
d="$(new_repo rules)"; s="$(sha "$d")"
mkissue "$d" noassignee "## Acceptance Criteria\n\n- [x] dev/01 v1 do it\n  - status: passed\n  - evidence ev1: commit=$s acv=1\n  - proof: \"x\" -> ev1\n" ready ""
mkissue "$d" mismatch   '## Acceptance Criteria\n\n- [x] dev/01 v1 x\n  - status: failed\n'
mkissue "$d" noevidence '## Acceptance Criteria\n\n- [x] dev/01 v1 x\n  - status: passed\n'
mkissue "$d" noproof    "## Acceptance Criteria\n\n- [x] dev/01 v1 x\n  - status: passed\n  - evidence ev1: commit=$s acv=1\n"
mkissue "$d" selfblock  '## Acceptance Criteria\n\n- [ ] dev/01 v1 x\n  - status: pending\n  - blocked-by: dev/01\n'
mkissue "$d" misblock   '## Acceptance Criteria\n\n- [ ] dev/01 v1 x\n  - status: pending\n  - blocked-by: dev/99\n'
mkissue "$d" noac       '## Summary\n\nNo criteria yet.\n'
out="$(check_out "$d")"
ok "$(yn "$(has "$out" 'issue_missing_assignee')")" Y "issue with no assignee fires"
ok "$(yn "$(has "$out" 'ac_checkbox_status_mismatch')")" Y "checkbox/status mismatch fires"
ok "$(yn "$(has "$out" 'passed_ac_missing_evidence')")" Y "passed AC missing evidence fires"
ok "$(yn "$(has "$out" 'passed_ac_missing_proof')")" Y "passed AC missing proof fires"
ok "$(yn "$(has "$out" 'ac_self_block')")" Y "AC self-block fires"
ok "$(yn "$(has "$out" 'ac_blocker_missing')")" Y "missing blocker fires"
ok "$(yn "$(has "$out" 'ready_requires_dev_ac')")" Y "ready issue with no AC fires"

echo "## default preset — a blocking CYCLE and a clean PASS"
d="$(new_repo cycle)"
mkissue "$d" c '## Acceptance Criteria\n\n- [ ] dev/01 v1 a\n  - status: pending\n  - blocked-by: dev/02\n- [ ] dev/02 v1 b\n  - status: pending\n  - blocked-by: dev/01\n'
ok "$(yn "$(has "$(check_out "$d")" 'ac_block_cycle')")" Y "a blocking cycle fires"
d="$(new_repo clean)"; s="$(sha "$d")"
mkissue "$d" ok "## Acceptance Criteria\n\n- [x] dev/01 v1 do it\n  - status: passed\n  - evidence ev1: commit=$s acv=1\n  - proof: \"ev1 proves it\" -> ev1\n"
ok "$(chk "$d")" 0 "a fully-cited green issue passes"

echo "## default preset — commit verification (on by default) catches a cited-but-nonexistent commit"
d="$(new_repo verify)"
mkissue "$d" v '## Acceptance Criteria\n\n- [x] dev/01 v1 x\n  - status: passed\n  - evidence ev1: commit=deadbeef1234 acv=1\n  - proof: "x" -> ev1\n'
vout="$( ( cd "$d" && npx ztrack check 2>&1 ) || true )"
ok "$(yn "$(has "$vout" 'evidence_commit_not_found')")" Y "a nonexistent cited commit fires under default commit verification"

echo "## shell completions — the generated scripts are valid and cover the commands"
d="$(new_repo completions)"
( cd "$d" && npx ztrack completions bash > c.bash 2>/dev/null )
ok "$( bash -n "$d/c.bash" >/dev/null 2>&1 && echo Y || echo N )" Y "bash completion script is syntactically valid (bash -n)"
ok "$(yn "$(grep -c 'complete -F' "$d/c.bash")")" Y "bash script registers a completion function"
ok "$(yn "$(grep -cE '\bloop\b.*\bwaiver\b|\bwaiver\b.*\bloop\b' "$d/c.bash")")" Y "completes the loop + waiver commands"
( cd "$d" && npx ztrack completions zsh > c.zsh 2>/dev/null )
ok "$(yn "$(grep -c '#compdef ztrack' "$d/c.zsh")")" Y "zsh completion script has a #compdef header"
zexit="$( ( cd "$d" && npx ztrack completions fish >/dev/null 2>&1 ); echo $? )"
ok "$zexit" 1 "an unsupported shell exits nonzero with a clear error"

echo
if [ "$fails" -eq 0 ]; then echo "check-e2e: ALL PASS"; else echo "check-e2e: $fails FAIL"; exit 1; fi
