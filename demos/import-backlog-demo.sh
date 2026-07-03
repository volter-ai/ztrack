#!/usr/bin/env bash
# ZTB-14 dev/34: a REAL packed+installed CLI walkthrough of `ztrack import` — npm pack -> npm
# install the tarball -> dry-run -> import -> check -> ac patch, plus a second run over a whole
# folder. Same shipped path as demos/check-e2e.sh (the standalone `default` preset the installed
# CLI writes as preset.mts). Not part of the mandatory CI verify list (see demos/README.md); this
# is the transcript-producing demo cited in the ZTB-14 final report.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tarball="$(cd "$repo_root" && npm pack --pack-destination "$tmp" --silent)"

fails=0
ok() { if [ "$1" = "$2" ]; then echo "  ok: $3"; else echo "  FAIL: $3 (got '$1' want '$2')"; fails=$((fails+1)); fi; }

d="$tmp/proj"; mkdir -p "$d"
( cd "$d"
  git init -q; git config user.email ci@x.com; git config user.name "import demo"
  echo "# import demo" > README.md; git add README.md; git commit -q -m init
  npm init -y >/dev/null; npm install "$tmp/$tarball" >/dev/null
  npx ztrack init --team APP >/dev/null
)

echo "## 1. a messy, freeform backlog file"
cat > "$d/backlog.md" <<'EOF'
# Team backlog

Assorted notes before this quarter's push.

## Improve onboarding flow

New users get lost during signup. We should tighten the happy path.

- [ ] Add a welcome email
- [ ] Track drop-off with an event
- [x] Write the onboarding doc

## Speed up CI

Builds take too long.

- [ ] Cache node_modules between runs
EOF
echo "--- backlog.md (before) ---"
cat "$d/backlog.md"

echo
echo "## 2. ztrack import --dry-run (preview only — writes nothing)"
( cd "$d" && npx ztrack import backlog.md --dry-run )
after_dry="$(cat "$d/backlog.md")"
before_dry="$(cat <<'EOF'
# Team backlog

Assorted notes before this quarter's push.

## Improve onboarding flow

New users get lost during signup. We should tighten the happy path.

- [ ] Add a welcome email
- [ ] Track drop-off with an event
- [x] Write the onboarding doc

## Speed up CI

Builds take too long.

- [ ] Cache node_modules between runs
EOF
)"
ok "$([ "$after_dry" = "$before_dry" ] && echo same || echo different)" same "--dry-run wrote nothing"

echo
echo "## 3. ztrack import (materialize in place) + --register"
( cd "$d" && npx ztrack import backlog.md --register )
echo "--- backlog.md (after) ---"
cat "$d/backlog.md"
echo "--- tracker-config.json ---"
cat "$d/.volter/tracker-config.json"

echo
echo "## 4. add assignees (a document source's assignee is edited in the file directly — docs/SOURCES.md) then ztrack check"
sed -i.bak -E 's/^(#+ APP-[0-9]+.*)$/\1\
\
assignee: me/' "$d/backlog.md" && rm -f "$d/backlog.md.bak"
check_out="$( cd "$d" && npx ztrack check 2>&1 )" && check_code=0 || check_code=$?
echo "$check_out"
ok "$check_code" 0 "ztrack check is green after import + register + assignee"

echo
echo "## 5. ztrack issue list — the expected hierarchy"
( cd "$d" && npx ztrack issue list --json identifier,title,parent )

echo
echo "## 6. ztrack ac patch on an imported AC — splice-writes correctly, check stays green"
sha="$( cd "$d" && git add -A && git commit -q -m 'assign owners' && git rev-parse HEAD )"
patch_out="$( cd "$d" && npx ztrack ac patch APP-2 dev/01 --json "{\"checked\":true,\"status\":\"passed\",\"evidence\":[{\"id\":\"ev1\",\"commit\":\"$sha\",\"acVersion\":1}],\"proof\":{\"explanation\":\"the seed commit adds the welcome email\",\"evidenceRefs\":[\"ev1\"]}}" )"
echo "$patch_out"
echo "--- backlog.md (after ac patch) ---"
cat "$d/backlog.md"
recheck_code=0; ( cd "$d" && npx ztrack check >/dev/null 2>&1 ) || recheck_code=$?
ok "$recheck_code" 0 "ztrack check stays green after ac patch"

echo
echo "## 7. a FOLDER import — each file its own document source, default excludes, --register"
mkdir -p "$d/notes/node_modules" "$d/notes/.volter"
cat > "$d/notes/harden-auth.md" <<'EOF'
## Harden auth

- [x] Add rate limiting
- [ ] Add audit logging
EOF
cat > "$d/notes/nothing-here.md" <<'EOF'
Just some scratch prose, no headings, no checkboxes, no TODO: markers.
EOF
cat > "$d/notes/node_modules/skip-me.md" <<'EOF'
## Should never be imported

- [ ] lives under node_modules
EOF
cat > "$d/notes/.volter/skip-me-too.md" <<'EOF'
## Should also never be imported

- [ ] lives under .volter
EOF
( cd "$d" && npx ztrack import notes --register )
folder_out="$( cd "$d" && npx ztrack import notes 2>&1 )"
echo "$folder_out"
ok "$(printf '%s' "$folder_out" | grep -c 'no-op (already canonical)')" 1 "re-importing the folder is a whole-batch no-op (excluded files never even appear)"

echo
if [ "$fails" -eq 0 ]; then echo "import-backlog-demo: ALL PASS"; else echo "import-backlog-demo: $fails FAILURE(S)"; exit 1; fi
