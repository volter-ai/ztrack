#!/usr/bin/env bash
# Real-CLI E2E for `ztrack check` RULE BEHAVIORS — the shipped path (the generic preset via
# the packed+installed CLI, the same code `ztrack init` writes as preset.cjs). This is the
# primary proof that the check rules fire (and stay quiet) correctly. presetKit.test.ts keeps
# only SURGICAL unit tests (mdast parser structure, the waiver freshness fingerprint, the
# regression edge cases) — not these behaviors. Deterministic, no live agent, runs in CI.
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
  npx ztrack init --team APP --preset "${2:-basic}" >/dev/null ); printf '%s' "$d"; }
mkissue() { ( cd "$1" && printf '%b' "$3" > _b.md && npx ztrack issue create --title "$2" --label type:case --state "${4:-In Progress}" --assignee t --body-file _b.md >/dev/null ); }
check_out() { ( cd "$1" && npx ztrack check 2>&1 ) || true; }            # full text report (exit ignored)
chk() { local rc; ( cd "$1" && npx ztrack check >/dev/null 2>&1 ) && rc=0 || rc=$?; echo "$rc"; }
has() { printf '%s' "$1" | grep -c "$2" || true; }
sha() { ( cd "$1" && git rev-parse --short HEAD ); }

echo "## basic preset — the data/evidence/blocking rules fire through the real CLI"
d="$(new_repo basic)"; s="$(sha "$d")"
mkissue "$d" mismatch   '# m\n\n## Acceptance Criteria\n\n- [x] dev/01 status: failed Contradiction.\n\n## Evidence\n'
mkissue "$d" nocommit   '# n\n\n## Acceptance Criteria\n\n- [x] dev/01 do it [E1]\n\n## Evidence\n\n[E1] type: pr\n'
mkissue "$d" noevidence "# e\n\n## Acceptance Criteria\n\n- [x] dev/01 do it commit: $s\n\n## Evidence\n"
mkissue "$d" unknownev  "# u\n\n## Acceptance Criteria\n\n- [x] dev/01 do it commit: $s [E9]\n\n## Evidence\n\n[E1] type: pr\n"
mkissue "$d" selfblock  '# s\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending Loop. blocked-by: dev/01\n\n## Evidence\n'
mkissue "$d" misblock   '# b\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending X. blocked-by: dev/99\n\n## Evidence\n'
( cd "$d" && printf '%b' '# na\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending X.\n\n## Evidence\n' > _b.md \
  && npx ztrack issue create --title na --label type:case --state "In Progress" --body-file _b.md >/dev/null )  # no --assignee
out="$(check_out "$d")"
ok "$(yn "$(has "$out" 'case_missing_assignee')")" Y "a non-canceled case with no assignee fires"
ok "$(yn "$(has "$out" 'checkbox_status_mismatch')")" Y "checkbox/status mismatch fires"
ok "$(yn "$(has "$out" 'checked_ac_missing_commit_hash')")" Y "checked AC missing commit fires"
ok "$(yn "$(has "$out" 'checked_ac_missing_evidence')")" Y "checked AC missing evidence fires"
ok "$(yn "$(has "$out" 'checked_ac_unknown_evidence')")" Y "checked AC unknown evidence fires"
ok "$(yn "$(has "$out" 'ac_self_block')")" Y "AC self-block fires"
ok "$(yn "$(has "$out" 'ac_blocker_missing')")" Y "missing blocker fires"

echo "## basic preset — a blocking CYCLE and a clean PASS"
d="$(new_repo cycle)"
mkissue "$d" c '# c\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending A. blocked-by: dev/02\n- [ ] dev/02 status: pending B. blocked-by: dev/01\n\n## Evidence\n'
ok "$(yn "$(has "$(check_out "$d")" 'ac_block_cycle')")" Y "a blocking cycle fires"
d="$(new_repo clean)"; s="$(sha "$d")"
mkissue "$d" ok "# ok\n\n## Acceptance Criteria\n\n- [x] dev/01 do it commit: $s [E1]\n\n## Evidence\n\n[E1] type: pr\n"
ok "$(chk "$d")" 0 "a fully-cited green issue passes"

echo "## basic preset — --verify-commits catches a cited-but-nonexistent commit"
d="$(new_repo verify)"
mkissue "$d" v '# v\n\n## Acceptance Criteria\n\n- [x] dev/01 do it commit: deadbeef1234 [E1]\n\n## Evidence\n\n[E1] type: pr\n'
vout="$( ( cd "$d" && npx ztrack check --verify-commits 2>&1 ) || true )"
ok "$(yn "$(has "$vout" 'checked_ac_commit_hash_missing')")" Y "a nonexistent cited commit fires under --verify-commits"

echo "## simple-sdlc preset — the SDLC gates fire through the real CLI"
d="$(new_repo sdlc simple-sdlc)"; s="$(sha "$d")"
# active case with NO acceptance criteria; a source marker present so only the AC gate is at issue
mkissue "$d" noacs '# x\n\n## Summary\n\nNeeds a criterion. [1]\n\n## Sources\n\n[1] r\n'
# a DONE case with an unpassed criterion
mkissue "$d" doneunpassed '# y\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending Not done. [1]\n\n## Sources\n\n[1] r\n' Done
# a case missing any [N] source marker
mkissue "$d" nomarker '# z\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending No marker.\n\n## Evidence\n'
out="$(check_out "$d")"
ok "$(yn "$(has "$out" 'case_missing_acceptance_criteria')")" Y "active case with no ACs fires"
ok "$(yn "$(has "$out" 'done_with_unpassed_acceptance_criteria')")" Y "done case with an unpassed AC fires"
ok "$(yn "$(has "$out" 'case_missing_source_marker')")" Y "a case with no [N] source marker fires"

echo "## a CANCELED case is exempt from the assignee / AC gates"
d="$(new_repo canceled simple-sdlc)"
( cd "$d" && printf '%b' '# c\n\n## Summary\n\nDropped. [1]\n\n## Sources\n\n[1] r\n' > _b.md \
  && npx ztrack issue create --title c --label type:case --state Canceled --body-file _b.md >/dev/null )
out="$(check_out "$d")"
ok "$(has "$out" 'case_missing_assignee')" 0 "canceled: no missing-assignee finding"
ok "$(has "$out" 'case_missing_acceptance_criteria')" 0 "canceled: no missing-AC finding"

echo
if [ "$fails" -eq 0 ]; then echo "check-e2e: ALL PASS"; else echo "check-e2e: $fails FAIL"; exit 1; fi
