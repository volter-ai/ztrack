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

target="$tmp_root/autonomous-app"
node "$repo_root/scripts/setup-ztrack-repo.mjs" \
  --new "$target" \
  --team DEMO \
  --preset simple-sdlc \
  --profile simple-sdlc \
  --install "$tarball" \
  --seed-demo-issues \
  --force > "$tmp_root/setup.json"

python3 - "$tmp_root/setup.json" "$target" <<'PY'
import json
import pathlib
import sys

setup = json.load(open(sys.argv[1]))
target = pathlib.Path(sys.argv[2])

assert setup["preset"] == "simple-sdlc", setup
assert setup["profile"] == "simple-sdlc", setup

required = [
    "profiles/simple-sdlc/profile.json",
    "profiles/simple-sdlc/README.md",
    "profiles/simple-sdlc/scheduler/schedule.json",
    "profiles/simple-sdlc/scheduler/scripts/run.mjs",
    "profiles/simple-sdlc/scheduler/scripts/pm-tick.mjs",
    "profiles/simple-sdlc/scheduler/scripts/cleanup-pm.mjs",
    "profiles/simple-sdlc/scheduler/scripts/recover-develop.mjs",
    "profiles/simple-sdlc/scheduler/scripts/recover-review.mjs",
    "profiles/simple-sdlc/scripts/run-agent.mjs",
    ".agents/skills/ztrack-simple-sdlc-pm/SKILL.md",
    ".agents/skills/ztrack-simple-sdlc-draft/SKILL.md",
    ".agents/skills/ztrack-simple-sdlc-develop/SKILL.md",
    ".agents/skills/ztrack-simple-sdlc-review/SKILL.md",
    ".claude/skills/ztrack-simple-sdlc-pm/SKILL.md",
    ".claude/skills/ztrack-simple-sdlc-draft/SKILL.md",
    ".claude/skills/ztrack-simple-sdlc-develop/SKILL.md",
    ".claude/skills/ztrack-simple-sdlc-review/SKILL.md",
    "profiles/simple-sdlc/skills/pm/SKILL.md",
    "profiles/simple-sdlc/skills/draft/SKILL.md",
    "profiles/simple-sdlc/skills/develop/SKILL.md",
    "profiles/simple-sdlc/skills/review/SKILL.md",
    "profiles/simple-sdlc/standards/workflow.md",
    "profiles/simple-sdlc/standards/issue-and-evidence.md",
    "profiles/simple-sdlc/standards/risk-and-review.md",
]
for relative in required:
    assert (target / relative).exists(), relative

PY

cd "$target"
npx ztrack-profile-check --repo . --profile simple-sdlc > "$tmp_root/profile-check.json"
npx ztrack check --json > "$tmp_root/check.json"
python3 - "$tmp_root/check.json" <<'PY'
import json
import sys

report = json.load(open(sys.argv[1]))
assert report["summary"]["status"] == "pass", report
PY

cat > "$tmp_root/termfleet" <<'SH'
#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do [ "$1" = "--prompt" ] && { printf '%s' "$2" > agent-prompt.txt; exit 0; }; shift; done
SH
chmod +x "$tmp_root/termfleet"
PATH="$tmp_root:$PATH" TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376" node profiles/simple-sdlc/scheduler/scripts/run.mjs --once
test "$(cat agent-prompt.txt)" = '$ztrack-simple-sdlc-pm'
rm agent-prompt.txt
PATH="$tmp_root:$PATH" TERMFLEET_AGENT=claude TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376" node profiles/simple-sdlc/scheduler/scripts/run.mjs --once
test "$(cat agent-prompt.txt)" = '/ztrack-simple-sdlc-pm'
rm agent-prompt.txt
PATH="$tmp_root:$PATH" ZTRACK_AGENT=develop ZTRACK_ISSUE=DEMO-1 TERMFLEET_PROVIDER_URL="http://127.0.0.1:7376" node profiles/simple-sdlc/scripts/run-agent.mjs
grep -q 'Assigned issue: DEMO-1' agent-prompt.txt

printf 'autonomous profile setup ok\n'
