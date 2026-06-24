#!/usr/bin/env bash
# Local red→green on the `default` preset: a passed AC that cites a fabricated commit is RED
# (evidence_commit_not_found under --verify-commits); swapping in the repo's real HEAD makes it
# GREEN. Runs against the source CLI when available, else the published `ztrack`.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT

# Consume the real packed CLI (the shipped path), exactly like the other gated demos.
tarball="$(cd "$repo_root" && npm pack --pack-destination "$tmp" --silent)"
ztrack=(npx ztrack)

cd "$tmp"
git init -q
git config user.email demo@example.com
git config user.name "ztrack Demo"

echo "ok" > app.txt
git add app.txt
git commit -q -m "demo commit"
real_sha="$(git rev-parse HEAD)"

npm init -y >/dev/null
npm install "$tmp/$tarball" >/dev/null
"${ztrack[@]}" init --team APP --preset default >/dev/null

# default grammar: a passed AC with image+commit evidence and a proof. The commit starts
# fabricated (red), then is rewritten to the real HEAD (green).
body() {
  printf '# APP-1: Protect API endpoint\n\nSummary: Guard the API endpoint.\nStatus: in-progress\nAssignee: demo\n\n## Acceptance Criteria\n\n- [x] dev/01 v1 Describe one observable outcome.\n  - status: passed\n  - evidence ev1: commit=%s acv=1\n  - proof: "ev1 demonstrates it" -> ev1\n' "$1" > body.md
}

body deadbeef
"${ztrack[@]}" issue create \
  --title "Protect API endpoint" \
  --label type:case \
  --state in-progress \
  --assignee demo \
  --body-file body.md >/dev/null 2>/dev/null

set +e
"${ztrack[@]}" check --verify-commits --json > red.json
red_exit=$?
set -e

body "$real_sha"
"${ztrack[@]}" issue edit APP-1 --body-file body.md >/dev/null

set +e
"${ztrack[@]}" check --verify-commits --json > green.json
green_exit=$?
set -e

red_code="$(python3 - <<'PY'
import json
print(json.load(open("red.json"))["findings"][0]["code"])
PY
)"
green_status="$(python3 - <<'PY'
import json
print(json.load(open("green.json"))["summary"]["status"])
PY
)"

printf 'red exit: %s\n' "$red_exit"
printf 'red finding: %s\n' "$red_code"
printf 'green exit: %s\n' "$green_exit"
printf 'green status: %s\n' "$green_status"

test "$red_exit" -eq 1
test "$red_code" = "evidence_commit_not_found"
test "$green_exit" -eq 0
test "$green_status" = "pass"
