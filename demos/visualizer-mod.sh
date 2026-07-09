#!/usr/bin/env bash
# demos/visualizer-mod.sh — VIZ-10: a MODDED board, DOM-rendered and CI-gated.
#
# The dashboard analog of `demos/real-project-cycle.sh`'s custom-rule demo — but a stronger
# evidence bar. real-project-cycle.sh proves a project-specific CHECK rule fires through the real
# CLI (a findings-code string in JSON). This demo proves a project-specific DASHBOARD renders
# through the real client — you cannot `curl /` and see a React board; only running the actual
# served bundle in a DOM runtime can, so that's what `demos/visualizer-mod/dom-check.mjs` does.
#
# It packs the current checkout, installs it into a fresh temp repo, and:
#   1. edits the INSTALLED `.volter/tracker/validation/preset.mts` — adds a new issue status to
#      the schema enum AND to the visualizer's `statusOrder`, and changes `acUnitLabel`,
#   2. drops a repo-local `theme.css` token override (the VIZ-6 seam),
#   3. installs the shipped VIZ-16 boilerplate example code panel, VERBATIM, as the repo's own
#      `extension.tsx` (the VIZ-13 seam),
#   4. boots the real visualizer server and hands off to `dom-check.mjs`, which asserts the
#      RENDERED difference — the new status column, the modded AC-unit label, and the custom
#      panel's own heading/content — via the DOM-runtime harness (payload + bundle checks stand
#      in as its named fallback, not a substitute; see that file's header).
#
# Deterministic, no live agent; CI + publish gate (see .github/workflows/ci.yml, publish.yml).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="$(mktemp -d)"
port=$((8900 + ($$ % 400)))
server_pid=""

cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" >/dev/null 2>&1 || true; wait "$server_pid" 2>/dev/null || true; fi
  rm -rf "$tmp_root"
}
trap cleanup EXIT

pkg_dir="$tmp_root/pkg"; app="$tmp_root/app"
mkdir -p "$pkg_dir" "$app"
tarball="$pkg_dir/$(cd "$repo_root" && npm pack --pack-destination "$pkg_dir" --silent)"

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

# ── set up the fixture repo: a fresh git repo with ztrack packed + installed ─────────────────
cd "$app"
git init -q
git config user.email vizmod@example.com
git config user.name "visualizer mod demo"
git checkout -q -b main 2>/dev/null || git branch -q -M main
echo "# viz-mod fixture" > README.md
git add README.md
git commit -q -m "initial commit"
npm init -y >/dev/null
npm install "$tarball" >/dev/null
npx ztrack init --team MOD --preset default >/dev/null

# ── 1. edit the INSTALLED preset.mts: a new status on the schema enum AND the visualizer block,
#    plus a changed acUnitLabel. `ztrack init` installs `boilerplates/presets/simple-sdlc.ts`
#    VERBATIM (src/presetCatalog.ts's `presetTemplate`/`installPreset`) — so these are known,
#    exact substrings of the installed file, not a template. ─────────────────────────────────
new_status="mod-review"
ac_unit_label="Mod ACs"
preset_path=".volter/tracker/validation/preset.mts"
python3 - "$preset_path" "$new_status" "$ac_unit_label" <<'PY'
from pathlib import Path
import sys

path, new_status, ac_unit_label = sys.argv[1:]
p = Path(path)
text = p.read_text()

old_enum = "export const DefaultIssueStatusSchema = z.enum(['draft', 'ready', 'in-progress', 'in-review', 'done']);"
new_enum = f"export const DefaultIssueStatusSchema = z.enum(['draft', 'ready', 'in-progress', 'in-review', '{new_status}', 'done']);"
assert old_enum in text, "installed preset.mts: DefaultIssueStatusSchema line not found verbatim -- preset shape drifted"
text = text.replace(old_enum, new_enum)

old_order = "  statusOrder: ['draft', 'ready', 'in-progress', 'in-review', 'done'], // must equal DefaultIssueStatusSchema above"
new_order = f"  statusOrder: ['draft', 'ready', 'in-progress', 'in-review', '{new_status}', 'done'], // must equal DefaultIssueStatusSchema above"
assert old_order in text, "installed preset.mts: statusOrder line not found verbatim -- preset shape drifted"
text = text.replace(old_order, new_order)

old_label = "  acUnitLabel: 'Dev ACs',"
new_label = f"  acUnitLabel: '{ac_unit_label}',"
assert old_label in text, "installed preset.mts: acUnitLabel line not found verbatim -- preset shape drifted"
text = text.replace(old_label, new_label)

p.write_text(text)
PY
grep -q "'${new_status}'" "$preset_path"
grep -q "acUnitLabel: '${ac_unit_label}'" "$preset_path"
printf 'preset.mts modded: status enum + visualizer.statusOrder + acUnitLabel ok\n'

# ── 2. drop a repo-local theme.css token override (the VIZ-6 seam) ──────────────────────────
mkdir -p .volter/tracker/visualizer
theme_css_path=".volter/tracker/visualizer/theme.css"
cat > "$theme_css_path" <<'EOF'
/* demos/visualizer-mod.sh -- a repo-local theme token override. */
:root { --accent: #ff6600; }
EOF

# ── 3. install the shipped VIZ-16 boilerplate example code panel VERBATIM -- proving the shipped
#    boilerplate works end to end, not a bespoke rewrite. ────────────────────────────────────
cp "$repo_root/boilerplates/visualizer/extension.tsx" .volter/tracker/visualizer/extension.tsx

# ── seed two issues: one exercises the modded AC-unit label + the boilerplate's "Proof coverage"
#    panel (a BACKED claim: real evidence + a proof that cites it); the other carries only the
#    brand new status, to populate that column. ──────────────────────────────────────────────
sha="$(git rev-parse HEAD)"
cat > panel.md <<EOF
Summary: Demonstrates the modded AC-unit label and the VIZ-16 boilerplate's Proof coverage panel.

## Acceptance Criteria

- [x] dev/01 v1 Show a backed claim in the boilerplate's Proof coverage panel.
  - status: passed
  - evidence ev1: commit=$sha acv=1
  - proof: "the initial commit backs this AC" -> ev1
EOF
npx ztrack issue create --title "Show the modded board" --label type:case --state in-progress --assignee demo --body-file panel.md >/dev/null

cat > status.md <<'EOF'
Summary: Populates the new mod-review status column.
EOF
npx ztrack issue create --title "New status column fixture" --label type:case --state "$new_status" --assignee demo --body-file status.md >/dev/null

# ── sanity: check still stays green after the mod. The new status is deliberately absent from
#    simple-sdlc.ts's own STATE_RANK map (see the rationale note at the bottom of this script), so
#    the ready/in-review lifecycle gates never fire for it -- silently skipped, not a red flag. ──
npx ztrack check --json > check.json
test "$(json_field check.json summary.status)" = "pass"
test "$(json_field check.json summary.issues)" -eq 2
printf 'ztrack check: green with the modded preset (2 issues, new status included)\n'

# ── boot the real visualizer server against this fixture; `exec` in the subshell so its PID IS
#    the bun process's PID (no orphaned child left behind when we kill it in cleanup). ──────────
( cd "$repo_root/visualizer" && PORT="$port" PROJECT_DIR="$app" exec bun run server.ts ) >/dev/null 2>&1 &
server_pid=$!

up=0
for _ in $(seq 1 25); do
  if bun -e "try { process.exit((await fetch('http://127.0.0.1:$port/')).status === 200 ? 0 : 1); } catch { process.exit(1); }" >/dev/null 2>&1; then up=1; break; fi
  sleep 0.8
done
test "$up" -eq 1
printf 'visualizer server up on :%s\n' "$port"

# ── hand off to the single assertion harness: theme.css FLOOR, payload/bundle fallback, and the
#    DOM-runtime checks for the new status column, the modded AC-unit label, and the custom
#    panel's own heading/content. See demos/visualizer-mod/dom-check.mjs for why each of these is
#    checked the way it is (in particular: why the theme check is a floor, not a computed style,
#    and why only a real DOM runtime -- not curl -- can see the rest). ──────────────────────────
issue_id="MOD-1"
panel_heading="Proof coverage"
panel_content="1 evidence entry, 1 cited by its proof"
set +e
( cd "$repo_root" && bun run demos/visualizer-mod/dom-check.mjs "$port" "$new_status" "$ac_unit_label" "$panel_heading" "$panel_content" "$issue_id" "$app/$theme_css_path" )
dom_check_exit=$?
set -e
test "$dom_check_exit" -eq 0

printf '\nvisualizer-mod ok\n'
printf 'app: %s\n' "$app"

# ── rationale note (not executed) ────────────────────────────────────────────────────────────
# The new "mod-review" status is added to DefaultIssueStatusSchema + statusOrder only -- it is
# deliberately NOT added to simple-sdlc.ts's own STATE_RANK map (the lifecycle-gate ranking used
# by ready_requires_dev_ac / review_requires_all_acs_passed). STATE_RANK is a plain runtime
# object; STATE_RANK[issue.status] for an unranked status is `undefined`, and every comparison
# against it (`undefined >= N`) evaluates to `false` in JS -- so those two gates simply never fire
# for an issue in this status (silently skipped, not a false-positive red). Extending STATE_RANK
# itself is a judgment call about where the new status sits in the PROCESS (out of scope for a
# dashboard-rendering demo); leaving it out keeps this script's edits exactly the three the task
# calls for: the schema enum, the visualizer block, and acUnitLabel.
