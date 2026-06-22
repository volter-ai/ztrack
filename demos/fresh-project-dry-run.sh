#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT

pkg_dir="$tmp_root/pkg"
mkdir -p "$pkg_dir"
tarball_name="$(cd "$repo_root" && npm pack --pack-destination "$pkg_dir" --silent)"
tarball="$pkg_dir/$tarball_name"

new_repo() {
  local name="$1"
  local dir="$tmp_root/$name"
  mkdir -p "$dir"
  cd "$dir"
  git init -q
  git config user.email dry-run@example.com
  git config user.name "ztrack Dry Run"
  echo "# $name" > README.md
  git add README.md
  git commit -q -m "initial commit"
  npm init -y >/dev/null
  npm install "$tarball" >/dev/null
  printf '%s\n' "$dir"
}

mark_first_ac_passed() {
  local preset="$1"
  local commit="$2"
  python3 - "$preset" "$commit" <<'PY'
from pathlib import Path
import sys

preset, commit = sys.argv[1], sys.argv[2]
path = Path("body.md")
text = path.read_text()

if "commit: deadbee" in text and commit != "deadbee":
    path.write_text(text.replace("commit: deadbee", f"commit: {commit}"))
    raise SystemExit(0)

if preset in ("simple-spec", "speckit"):
    ac = "spec/01"
    replacements = [
        (
            "- [ ] spec/01 status: pending Describe one observable acceptance criterion. [1]",
            f"- [x] spec/01 status: passed Describe one observable acceptance criterion. commit: {commit} [E1]",
        ),
        (
            "- [ ] spec/01 status: pending The feature satisfies the primary user story. [1]",
            f"- [x] spec/01 status: passed The feature satisfies the primary user story. commit: {commit} [E1]",
        ),
    ]
else:
    ac = "dev/01"
    replacements = [
        (
            "- [ ] dev/01 status: pending Describe one observable outcome.",
            f"- [x] dev/01 status: passed Describe one observable outcome. commit: {commit} [E1]",
        ),
    ]

for before, after in replacements:
    if before in text:
        text = text.replace(before, after, 1)
        break
else:
    raise SystemExit(f"could not find scaffold AC for {preset}")

text = text.replace(
    "## Evidence\n",
    f"## Evidence\n\n- [E1] type: pr ac: {ac} repo: demo/ztrack number: 1 head: main justification: Fresh-project dry run proof.\n",
    1,
)
path.write_text(text)
PY
}

json_field() {
  python3 - "$1" "$2" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1]))
for part in sys.argv[2].split("."):
    if part.isdigit():
        data = data[int(part)]
    else:
        data = data[part]
print(data)
PY
}

for preset in basic simple-sdlc simple-spec speckit; do
  repo="$(new_repo "preset-$preset")"
  cd "$repo"
  real_sha="$(git rev-parse --short HEAD)"
  npx ztrack init --team APP --preset "$preset" >/dev/null
  npx ztrack issue scaffold --title "Dry $preset" > body.md
  mark_first_ac_passed "$preset" deadbee
  npx ztrack issue create --title "Dry $preset" --label type:case --state "In Progress" --assignee dry-run --body-file body.md >/dev/null

  set +e
  npx ztrack check --json > red.json
  red_exit=$?
  set -e
  red_code="$(json_field red.json findings.0.code)"
  test "$red_exit" -eq 1
  test "$red_code" = "${preset}_checked_ac_commit_hash_missing"

  mark_first_ac_passed "$preset" "$real_sha"
  npx ztrack issue edit APP-1 --body-file body.md >/dev/null
  npx ztrack check --json > green.json
  test "$(json_field green.json summary.status)" = "pass"
  printf '%s red/green ok\n' "$preset"
done

repo="$(new_repo "ci-root")"
cd "$repo"
real_sha="$(git rev-parse --short HEAD)"
npx ztrack init --team APP --preset basic >/dev/null
npx ztrack issue scaffold --title "Root gate" > body.md
mark_first_ac_passed basic "$real_sha"
npx ztrack issue create --title "Root gate" --label type:case --state "In Progress" --assignee dry-run --body-file body.md >/dev/null
npx ztrack export --out .volter/root.json >/dev/null
npx ztrack check --input .volter/root.json --verify-commits --json > root-check.json
test "$(json_field root-check.json summary.status)" = "pass"
printf 'ci root ok\n'

repo="$(new_repo "mcp-loop")"
cd "$repo"
real_sha="$(git rev-parse --short HEAD)"
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tracker_init","arguments":{"team":"APP","preset":"basic"}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tracker_issue_create","arguments":{"title":"MCP dry run","state":"In Progress","assignee":"dry-run","labels":["type:case"],"body":"# MCP dry run\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending Check through MCP.\n\n## Evidence\n"}}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"tracker_evidence_add","arguments":{"issue":"APP-1","type":"pr","ac":"dev/01","repo":"demo/ztrack","number":"1","head":"main","justification":"MCP proof."}}}' \
  "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"tracker_ac_check\",\"arguments\":{\"issue\":\"APP-1\",\"acId\":\"dev/01\",\"commit\":\"$real_sha\",\"evidence\":[\"E1\"]}}}" \
  '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"tracker_check","arguments":{}}}' \
  | npx ztrack mcp serve > mcp.jsonl
python3 - <<'PY'
import json

responses = [json.loads(line) for line in open("mcp.jsonl") if line.strip()]
text = responses[-1]["result"]["content"][0]["text"]
report = json.loads(text)
if report["summary"]["status"] != "pass":
    raise SystemExit(text)
PY
printf 'mcp loop ok\n'

repo="$(new_repo "sdk-api")"
cd "$repo"
npx ztrack init --team APP --preset basic >/dev/null
cp "$repo_root/demos/sdk-api/run.mjs" ./ztrack-sdk-demo.mjs
node ./ztrack-sdk-demo.mjs > sdk.json
test "$(json_field sdk.json listed)" -ge 1
printf 'sdk api ok\n'

autonomous="$tmp_root/autonomous-profile"
node "$repo_root/scripts/setup-ztrack-repo.mjs" \
  --new "$autonomous" \
  --team AUTO \
  --preset simple-sdlc \
  --profile simple-sdlc \
  --install "$tarball" \
  --seed-demo-issues \
  --force > "$tmp_root/autonomous.json"
test -f "$autonomous/profiles/simple-sdlc/scheduler/schedule.json"
test -f "$autonomous/profiles/simple-sdlc/profile.json"
test -f "$autonomous/profiles/simple-sdlc/scheduler/scripts/run.mjs"
test -f "$autonomous/profiles/simple-sdlc/scheduler/scripts/pm-tick.mjs"
test -f "$autonomous/profiles/simple-sdlc/scheduler/scripts/cleanup-pm.mjs"
test -f "$autonomous/profiles/simple-sdlc/scheduler/scripts/recover-develop.mjs"
test -f "$autonomous/profiles/simple-sdlc/scheduler/scripts/recover-review.mjs"
test -f "$autonomous/profiles/simple-sdlc/scripts/run-agent.mjs"
test -f "$autonomous/.agents/skills/ztrack-simple-sdlc-pm/SKILL.md"
test -f "$autonomous/.agents/skills/ztrack-simple-sdlc-develop/SKILL.md"
test -f "$autonomous/.claude/skills/ztrack-simple-sdlc-pm/SKILL.md"
test -f "$autonomous/.claude/skills/ztrack-simple-sdlc-develop/SKILL.md"
cd "$autonomous"
# setup-ztrack-repo git-inits this repo but sets no identity; the commits below need one
# (CI runners have no global git identity, unlike a dev machine).
git config user.email dry-run@example.com
git config user.name "ztrack Dry Run"
npx ztrack-profile-check --repo . --profile simple-sdlc > "$tmp_root/profile-check.json"
cat > "$tmp_root/termfleet" <<'SH'
#!/usr/bin/env bash
# Fake termfleet: capture the launched prompt and RETURN a terminalId (the autonomy
# runner requires one), honoring both --prompt and --prompt-file.
mode=""; prompt=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    new) mode=new; shift;;
    list) mode=list; shift;;
    --prompt) prompt="$2"; shift 2;;
    --prompt-file) prompt="$(cat "$2")"; shift 2;;
    *) shift;;
  esac
done
if [ "$mode" = list ]; then printf '[]\n'; exit 0; fi
printf '%s' "$prompt" > agent-prompt.txt
printf '{"terminalId":"t-1"}\n'
SH
chmod +x "$tmp_root/termfleet"
PATH="$tmp_root:$PATH" TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376" node profiles/simple-sdlc/scheduler/scripts/run.mjs --once
test "$(cat agent-prompt.txt)" = '$ztrack-simple-sdlc-pm'
rm agent-prompt.txt
PATH="$tmp_root:$PATH" TERMFLEET_AGENT=claude TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376" node profiles/simple-sdlc/scheduler/scripts/run.mjs --once
test "$(cat agent-prompt.txt)" = '/ztrack-simple-sdlc-pm'
rm agent-prompt.txt
PATH="$tmp_root:$PATH" ZTRACK_AGENT=develop ZTRACK_ISSUE=AUTO-1 TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376" node profiles/simple-sdlc/scripts/run-agent.mjs
# develop launches with its own skill prompt; the assigned issue flows via the ZTRACK_ISSUE
# env (re-exported by the runner's setup-command / params), not embedded in the prompt text.
grep -q 'ztrack-simple-sdlc-develop' agent-prompt.txt

cat > .gitignore <<'EOF'
node_modules/
agent-prompt.txt
EOF
git add .
git commit -q -m "install autonomous profile"
cat > stale.md <<'EOF'
# Stale develop

## Summary

The recovery dry run needs a stale in-progress issue. [1]

## Acceptance Criteria

- [ ] dev/01 status: pending Recovery can requeue the issue. [1]

## Sources

[1] Requirement:
> The recovery dry run needs a stale in-progress issue.

## Evidence
EOF
npx ztrack issue create --title "Stale develop" --label type:case --state "In Progress" --assignee dry-run --body-file stale.md >/dev/null
npx ztrack issue create --title "Stale review" --label type:case --label ztrack:reviewing --state "In Review" --assignee dry-run --body-file stale.md >/dev/null
git add .
git commit -q -m "seed stale recovery states"
cat > "$tmp_root/termfleet" <<'SH'
#!/usr/bin/env bash
# Fake termfleet (recovery phase): `list` returns no live sessions; `new` captures the
# prompt and returns a terminalId.
mode=""; prompt=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    new) mode=new; shift;;
    list) mode=list; shift;;
    --prompt) prompt="$2"; shift 2;;
    --prompt-file) prompt="$(cat "$2")"; shift 2;;
    *) shift;;
  esac
done
if [ "$mode" = list ]; then printf '[]\n'; exit 0; fi
printf '%s' "$prompt" > agent-prompt.txt
printf '{"terminalId":"t-1"}\n'
SH
chmod +x "$tmp_root/termfleet"
PATH="$tmp_root:$PATH" TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376" node profiles/simple-sdlc/scheduler/scripts/recover-develop.mjs
PATH="$tmp_root:$PATH" TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376" node profiles/simple-sdlc/scheduler/scripts/recover-review.mjs
npx ztrack issue list --json identifier,state,labels > recovery.json
python3 - <<'PY'
import json

rows = {row["identifier"]: row for row in json.load(open("recovery.json"))}
assert rows["AUTO-3"]["state"] == "Ready", rows
assert rows["AUTO-4"]["state"] == "In Review", rows
assert "ztrack:reviewing" not in rows["AUTO-4"].get("labels", []), rows
PY
printf 'autonomous profile setup ok\n'

repo="$(new_repo "require-esm-guard")"
cd "$repo"
real_sha="$(git rev-parse --short HEAD)"
npx ztrack init --team APP --preset basic >/dev/null
npx ztrack issue scaffold --title "Guard" > body.md
mark_first_ac_passed basic "$real_sha"
npx ztrack issue create --title "Guard" --label type:case --state "In Progress" --assignee dry-run --body-file body.md >/dev/null
# The installed preset.cjs does `require('ztrack/preset-kit')`; ztrack is ESM, so without a
# CJS `require` export condition this is `require()` of an ES module — which Node <22.12 and
# Yarn PnP reject. Disabling native require(esm) reproduces that environment; this must pass.
NODE_OPTIONS="--no-experimental-require-module" npx ztrack check --json > require-esm.json
test "$(json_field require-esm.json summary.status)" = "pass"
printf 'require(esm) guard ok (preset loads without native require-esm)\n'

# The library subpaths are ESM (no CJS build by design); a CommonJS caller consumes them
# via dynamic import(). Lock that contract — it must hold even without native require(esm).
cat > cjs-import.cjs <<'JS'
(async () => {
  const check = await import('ztrack/check');
  const sdk = await import('ztrack/sdk');
  if (typeof check.checkTracker !== 'function' || typeof sdk.createTrackerClient !== 'function') {
    throw new Error('ESM subpath not importable from CommonJS');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
JS
NODE_OPTIONS="--no-experimental-require-module" node cjs-import.cjs
printf 'esm-subpath import() guard ok (CommonJS callers can import the library)\n'

printf 'fresh-project dry run complete\n'
