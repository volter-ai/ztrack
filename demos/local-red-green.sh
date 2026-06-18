#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT

if command -v bun >/dev/null 2>&1 && [[ -f "$repo_root/src/cli.ts" ]]; then
  ztrack=(bun run "$repo_root/src/cli.ts")
else
  ztrack=(npx ztrack)
fi

cd "$tmp"
git init -q
git config user.email demo@example.com
git config user.name "ztrack Demo"

echo "ok" > app.txt
git add app.txt
git commit -q -m "demo commit"
real_sha="$(git rev-parse --short HEAD)"

"${ztrack[@]}" init --team APP --preset basic >/dev/null
"${ztrack[@]}" issue scaffold --title "Protect API endpoint" > body.md

python3 - <<'PY'
from pathlib import Path

path = Path("body.md")
text = path.read_text()
text = text.replace(
    "- [ ] dev/01 status: pending Describe one observable outcome.",
    "- [x] dev/01 status: passed Describe one observable outcome. commit: deadbee [E1]",
)
text = text.replace(
    "## Evidence\n",
    "## Evidence\n\n"
    "- [E1] type: pr ac: dev/01 repo: demo/ztrack number: 1 head: main justification: Demo proof.\n",
)
path.write_text(text)
PY

"${ztrack[@]}" issue create \
  --title "Protect API endpoint" \
  --label type:case \
  --state "In Progress" \
  --assignee demo \
  --body-file body.md >/dev/null 2>/dev/null

set +e
"${ztrack[@]}" check --json > red.json
red_exit=$?
set -e

python3 - "$real_sha" <<'PY'
from pathlib import Path
import sys

real_sha = sys.argv[1]
path = Path("body.md")
path.write_text(path.read_text().replace("commit: deadbee", f"commit: {real_sha}"))
PY

"${ztrack[@]}" issue edit APP-1 --body-file body.md >/dev/null

set +e
"${ztrack[@]}" check --json > green.json
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
test "$red_code" = "basic_checked_ac_commit_hash_missing"
test "$green_exit" -eq 0
test "$green_status" = "pass"
