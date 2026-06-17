#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT

pkg_dir="$tmp_root/pkg"
app="$tmp_root/northwind-ops"
clone="$tmp_root/northwind-ops-clone"
mkdir -p "$pkg_dir" "$app"

tarball_name="$(cd "$repo_root" && npm pack --pack-destination "$pkg_dir" --silent)"
tarball="$pkg_dir/$tarball_name"

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

write_issue() {
  local path="$1"
  local title="$2"
  local source="$3"
  local ac1="$4"
  local ac2="$5"
  local ac3="$6"
  cat > "$path" <<EOF
# $title

## Summary

$source [1]

## Acceptance Criteria

- [ ] dev/01 status: pending $ac1 [1]
- [ ] dev/02 status: pending $ac2 [1]
- [ ] proc/01 status: pending $ac3 [1]

## Sources

[1] Requirement:
$source

## Evidence
EOF
}

pass_ac() {
  local file="$1"
  local ac="$2"
  local text="$3"
  local sha="$4"
  local evidence="$5"
  python3 - "$file" "$ac" "$text" "$sha" "$evidence" <<'PY'
from pathlib import Path
import sys

path, ac, text, sha, evidence = sys.argv[1:]
p = Path(path)
body = p.read_text()
body = body.replace(
    f"- [ ] {ac} status: pending {text} [1]",
    f"- [x] {ac} status: passed {text} commit: {sha} [{evidence}]",
)
body += f"\n[{evidence}] type: pr ac: {ac} repo: northwind/ops number: {evidence[1:]} head: main justification: Verified by tests, code review, and release notes.\n"
p.write_text(body)
PY
}

append_rollout_plan() {
  local file="$1"
  python3 - "$file" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
p.write_text(p.read_text() + """

## Rollout Plan

- Deploy behind the inventory-write feature flag.
- Monitor reservation conflict rate for one business day.
- Roll back by disabling the flag; data writes are idempotent.
""")
PY
}

cd "$app"
git init -q
git config user.email cycle@example.com
git config user.name "Northwind Ops"

mkdir -p packages/inventory/src packages/api/src apps/admin/src test docs/adr docs/runbooks .github/workflows scripts
cat > package.json <<'EOF'
{
  "name": "northwind-ops",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "node --test test/*.test.js",
    "lint": "node scripts/lint-docs.mjs",
    "release:check": "npm test && npm run lint && ztrack check",
    "snapshot": "ztrack snapshot export --out .volter/snapshot.json"
  },
  "dependencies": {},
  "devDependencies": {}
}
EOF
cat > README.md <<'EOF'
# Northwind Ops

Inventory reservation workspace used to exercise a realistic ztrack adoption
cycle: planning, implementation, review, rework, release evidence, CI snapshot,
SDK, MCP, and fresh-clone validation.
EOF
cat > packages/inventory/src/store.js <<'EOF'
export function createInventoryStore(seed = []) {
  const items = new Map();
  for (const item of seed) {
    items.set(item.sku, { sku: item.sku, name: item.name, onHand: item.onHand, reserved: item.reserved || 0 });
  }

  return {
    upsert(item) {
      if (!item?.sku) throw new Error('sku required');
      const current = items.get(item.sku) || { sku: item.sku, name: item.name || item.sku, onHand: 0, reserved: 0 };
      const next = { ...current, ...item, reserved: current.reserved };
      items.set(item.sku, next);
      return { ...next };
    },
    get(sku) {
      const item = items.get(String(sku));
      return item ? { ...item } : null;
    },
    list() {
      return [...items.values()].map((item) => ({ ...item }));
    },
  };
}
EOF
cat > packages/api/src/handlers.js <<'EOF'
export function createInventoryHandlers(store) {
  return {
    listInventory() {
      return { status: 200, body: { items: store.list() } };
    },
    putInventory(input) {
      return { status: 200, body: { item: store.upsert(input) } };
    },
  };
}
EOF
cat > apps/admin/src/render.js <<'EOF'
export function renderInventoryTable(items) {
  return items.map((item) => `${item.sku}\t${item.name}\t${item.onHand}`).join('\n');
}
EOF
cat > scripts/lint-docs.mjs <<'EOF'
import { existsSync, readFileSync } from 'node:fs';

for (const path of ['docs/runbooks/inventory-rollout.md', 'docs/adr/0001-inventory-reservations.md']) {
  if (!existsSync(path)) throw new Error(`${path} missing`);
  if (!readFileSync(path, 'utf8').trim()) throw new Error(`${path} empty`);
}
EOF
cat > docs/runbooks/inventory-rollout.md <<'EOF'
# Inventory Rollout

Roll out inventory writes behind a feature flag.
EOF
cat > docs/adr/0001-inventory-reservations.md <<'EOF'
# ADR 0001: Inventory Reservations

Reservations are held inside the inventory store before checkout capture.
EOF
cat > test/inventory.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInventoryStore } from '../packages/inventory/src/store.js';

test('upserts and lists inventory', () => {
  const store = createInventoryStore();
  store.upsert({ sku: 'SKU-1', name: 'Tea', onHand: 10 });
  assert.equal(store.get('SKU-1').onHand, 10);
  assert.equal(store.list().length, 1);
});
EOF
cat > test/api.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInventoryStore } from '../packages/inventory/src/store.js';
import { createInventoryHandlers } from '../packages/api/src/handlers.js';

test('lists inventory through handlers', () => {
  const store = createInventoryStore([{ sku: 'SKU-1', name: 'Tea', onHand: 10 }]);
  const api = createInventoryHandlers(store);
  assert.equal(api.listInventory().body.items.length, 1);
});
EOF
npm test >/dev/null
npm run lint >/dev/null
git add .
git commit -q -m "bootstrap inventory workspace"

python3 - <<'PY'
from pathlib import Path
p = Path('packages/inventory/src/store.js')
s = p.read_text()
s = s.replace("    list() {", "    reserve(sku, quantity) {\n      const item = items.get(String(sku));\n      if (!item) return { ok: false, reason: 'missing' };\n      if (quantity <= 0) return { ok: false, reason: 'quantity' };\n      if (item.onHand - item.reserved < quantity) return { ok: false, reason: 'insufficient' };\n      item.reserved += quantity;\n      return { ok: true, item: { ...item } };\n    },\n    release(sku, quantity) {\n      const item = items.get(String(sku));\n      if (!item) return false;\n      item.reserved = Math.max(0, item.reserved - quantity);\n      return true;\n    },\n    list() {")
p.write_text(s)
p = Path('test/inventory.test.js')
s = s.replace("assert.equal(store.list().length, 1);", "assert.equal(store.list().length, 1);\n  assert.deepEqual(store.reserve('SKU-1', 3).ok, true);\n  assert.equal(store.get('SKU-1').reserved, 3);\n  assert.equal(store.reserve('SKU-1', 99).reason, 'insufficient');")
p.write_text(s)
PY
npm test >/dev/null
git add packages/inventory/src/store.js test/inventory.test.js
git commit -q -m "add inventory reservation lifecycle"
reserve_sha="$(git rev-parse --short HEAD)"

python3 - <<'PY'
from pathlib import Path
p = Path('packages/api/src/handlers.js')
s = p.read_text()
s = s.replace("    putInventory(input) {\n      return { status: 200, body: { item: store.upsert(input) } };\n    },", "    putInventory(input) {\n      return { status: 200, body: { item: store.upsert(input) } };\n    },\n    reserveInventory(input) {\n      const result = store.reserve(input.sku, Number(input.quantity || 0));\n      return result.ok ? { status: 200, body: result } : { status: 409, body: result };\n    },")
p.write_text(s)
p = Path('test/api.test.js')
s = s.replace("assert.equal(api.listInventory().body.items.length, 1);", "assert.equal(api.listInventory().body.items.length, 1);\n  assert.equal(api.reserveInventory({ sku: 'SKU-1', quantity: 2 }).status, 200);\n  assert.equal(api.reserveInventory({ sku: 'SKU-1', quantity: 99 }).status, 409);")
p.write_text(s)
PY
npm test >/dev/null
git add packages/api/src/handlers.js test/api.test.js
git commit -q -m "expose reservation API conflict handling"
api_sha="$(git rev-parse --short HEAD)"

python3 - <<'PY'
from pathlib import Path
p = Path('apps/admin/src/render.js')
s = p.read_text()
s += "\n\nexport function renderReservationSummary(items) {\n  return items.map((item) => `${item.sku}: ${item.reserved}/${item.onHand}`).join('\\n');\n}\n"
p.write_text(s)
Path('test/admin.test.js').write_text("""import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { renderReservationSummary } from '../apps/admin/src/render.js';\n\ntest('renders reservation summary', () => {\n  assert.equal(renderReservationSummary([{ sku: 'SKU-1', reserved: 2, onHand: 10 }]), 'SKU-1: 2/10');\n});\n""")
PY
npm test >/dev/null
git add apps/admin/src/render.js test/admin.test.js
git commit -q -m "add admin reservation summary"
admin_sha="$(git rev-parse --short HEAD)"

python3 - <<'PY'
from pathlib import Path
Path('docs/runbooks/inventory-rollout.md').write_text("""# Inventory Rollout\n\nRoll out inventory writes behind a feature flag.\n\n## Reservation Endpoint\n\nMonitor 409 conflict rate and reserved/on-hand ratio during rollout.\n""")
Path('docs/adr/0001-inventory-reservations.md').write_text("""# ADR 0001: Inventory Reservations\n\nReservations are held inside the inventory store before checkout capture.\n\n## Decision\n\nReservation conflicts return 409 and do not mutate stock.\n""")
PY
npm run lint >/dev/null
git add docs
git commit -q -m "document reservation rollout"
docs_sha="$(git rev-parse --short HEAD)"

npm install -D "$tarball" >/dev/null
npx ztrack init --team INV --preset simple-sdlc >/dev/null

# Project-specific policy: completed API cases must include a Rollout Plan.
cat >> .volter/tracker/validation/preset.cjs <<'EOF'

const __ztrackBaseCheckSnapshot = module.exports.snapshot.checkSnapshot;
module.exports.snapshot.checkSnapshot = function projectCheckSnapshot(snapshot, options) {
  const report = __ztrackBaseCheckSnapshot(snapshot, options);
  for (const issue of Array.isArray(snapshot && snapshot.cases) ? snapshot.cases : []) {
    const labels = Array.isArray(issue.labels) ? issue.labels.map(String) : [];
    const isDone = ['completed', 'done'].includes(String(issue.stateType || issue.state || '').toLowerCase());
    if (labels.includes('area:api') && isDone && !/^##\s+Rollout Plan\s*$/im.test(String(issue.body || ''))) {
      report.findings.push({
        level: 'error',
        code: 'northwind_api_done_missing_rollout_plan',
        issue: String(issue.identifier || 'unknown'),
        message: 'Done API cases must include ## Rollout Plan.',
      });
    }
  }
  const errors = report.findings.filter((finding) => finding.level === 'error').length;
  const warnings = report.findings.length - errors;
  report.valid = errors === 0;
  report.summary = {
    ...report.summary,
    errors,
    warnings,
    status: errors > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass',
    findingCounts: Object.fromEntries([...new Set(report.findings.map((finding) => finding.code))].map((code) => [code, report.findings.filter((finding) => finding.code === code).length])),
  };
  return report;
};
EOF

write_issue inventory.md "Reserve inventory units" \
  "Warehouse operators need reservations to prevent overselling during checkout." \
  "Store reserves available units." \
  "Store rejects over-reservation without mutation." \
  "Tests cover reserve and release behavior."
npx ztrack issue create --title "Reserve inventory units" --label type:case --label area:inventory --state "In Progress" --assignee dev-a --body-file inventory.md >/dev/null

write_issue api.md "Expose reservation API" \
  "Checkout callers need an API response that distinguishes success from stock conflicts." \
  "API returns success for available reservations." \
  "API returns conflict for insufficient stock." \
  "Rollout plan covers monitoring and rollback."
npx ztrack issue create --title "Expose reservation API" --label type:case --label area:api --state "In Progress" --assignee dev-b --body-file api.md >/dev/null

write_issue admin.md "Show reservations in admin" \
  "Operations needs a quick way to inspect reserved inventory from the admin surface." \
  "Admin summary renders reserved and on-hand counts." \
  "Summary works with multiple SKUs." \
  "Docs identify who owns the admin view."
npx ztrack issue create --title "Show reservations in admin" --label type:case --label area:admin --state "In Progress" --assignee dev-c --body-file admin.md >/dev/null

write_issue docs.md "Document inventory rollout" \
  "Release managers need rollout instructions before enabling reservation writes." \
  "Runbook explains monitoring." \
  "ADR records conflict semantics." \
  "Release notes link to the runbook."
npx ztrack issue create --title "Document inventory rollout" --label type:case --label area:docs --state "In Progress" --assignee tech-writer --body-file docs.md >/dev/null

# Planning state: sourced, assigned, and pending work should be valid.
npx ztrack check --json > planning.json
test "$(json_field planning.json summary.status)" = "pass"

pass_ac inventory.md dev/01 "Store reserves available units." "$reserve_sha" E1
pass_ac inventory.md dev/02 "Store rejects over-reservation without mutation." "$reserve_sha" E2
npx ztrack issue edit INV-1 --body-file inventory.md --state Done >/dev/null
set +e
npx ztrack check --json > review-red.json
review_exit=$?
set -e
test "$review_exit" -eq 1
test "$(json_field review-red.json findings.0.code)" = "simple-sdlc_done_with_unpassed_acceptance_criteria"
pass_ac inventory.md proc/01 "Tests cover reserve and release behavior." "$reserve_sha" E3
npx ztrack issue edit INV-1 --body-file inventory.md >/dev/null
npx ztrack check --json > review-green.json
test "$(json_field review-green.json summary.status)" = "pass"

pass_ac api.md dev/01 "API returns success for available reservations." "$api_sha" E1
pass_ac api.md dev/02 "API returns conflict for insufficient stock." "$api_sha" E2
pass_ac api.md proc/01 "Rollout plan covers monitoring and rollback." "$docs_sha" E3
npx ztrack issue edit INV-2 --body-file api.md --state Done >/dev/null
set +e
npx ztrack check --json > rollout-red.json
rollout_exit=$?
set -e
test "$rollout_exit" -eq 1
test "$(json_field rollout-red.json findings.0.code)" = "northwind_api_done_missing_rollout_plan"
append_rollout_plan api.md
npx ztrack issue edit INV-2 --body-file api.md >/dev/null
npx ztrack check --json > rollout-green.json
test "$(json_field rollout-green.json summary.status)" = "pass"

pass_ac admin.md dev/01 "Admin summary renders reserved and on-hand counts." "$admin_sha" E1
pass_ac admin.md dev/02 "Summary works with multiple SKUs." deadbee E2
pass_ac admin.md proc/01 "Docs identify who owns the admin view." "$docs_sha" E3
npx ztrack issue edit INV-3 --body-file admin.md >/dev/null
set +e
npx ztrack check --json > bad-sha-red.json
sha_exit=$?
set -e
test "$sha_exit" -eq 1
test "$(json_field bad-sha-red.json findings.0.code)" = "simple-sdlc_checked_ac_commit_hash_missing"
python3 - "$admin_sha" <<'PY'
from pathlib import Path
import sys
p = Path('admin.md')
p.write_text(p.read_text().replace('commit: deadbee', f'commit: {sys.argv[1]}'))
PY
npx ztrack issue edit INV-3 --body-file admin.md >/dev/null

pass_ac docs.md dev/01 "Runbook explains monitoring." "$docs_sha" E1
pass_ac docs.md dev/02 "ADR records conflict semantics." "$docs_sha" E2
pass_ac docs.md proc/01 "Release notes link to the runbook." "$docs_sha" E3
npx ztrack issue edit INV-4 --body-file docs.md --state Done >/dev/null
npx ztrack check --json > final-check.json
test "$(json_field final-check.json summary.status)" = "pass"
test "$(json_field final-check.json summary.cases)" -eq 4

npx ztrack snapshot export --out .volter/snapshot.json >/dev/null
npx ztrack check --input .volter/snapshot.json --verify-commits --json > snapshot-check.json
test "$(json_field snapshot-check.json summary.status)" = "pass"

mkdir -p .github/workflows
cat > .github/workflows/ztrack.yml <<'EOF'
name: ztrack

on:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: volter-ai/ztrack@v0
        with:
          snapshot: .volter/snapshot.json
EOF

cat > sdk-cycle.mjs <<'EOF'
import { createTrackerClient } from 'ztrack';

const client = createTrackerClient();
const cases = await client.issue.list({ label: 'type:case', limit: 20, json: 'identifier,title,state,labels' });
if (!Array.isArray(cases) || cases.length !== 4) throw new Error(`expected 4 cases, got ${Array.isArray(cases) ? cases.length : 'non-array'}`);
const api = cases.find((issue) => issue.identifier === 'INV-2');
const viewed = await client.issue.view('INV-2', { json: 'identifier,title,body' });
if (!api || !String(viewed.body || '').includes('## Rollout Plan')) throw new Error('API rollout plan not visible through SDK');
console.log(JSON.stringify({ cases: cases.length, api: api.identifier }));
EOF
node sdk-cycle.mjs > sdk-cycle.json
test "$(json_field sdk-cycle.json cases)" -eq 4

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tracker_issue_view","arguments":{"issue":"INV-2"}}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"tracker_check","arguments":{}}}' \
  | npx ztrack mcp serve > mcp-cycle.jsonl
python3 - <<'PY'
import json
responses = [json.loads(line) for line in open("mcp-cycle.jsonl") if line.strip()]
if not any(tool["name"] == "tracker_check" for tool in responses[1]["result"]["tools"]):
    raise SystemExit("tracker_check missing")
view = json.loads(responses[2]["result"]["content"][0]["text"])
if "Rollout Plan" not in view.get("body", ""):
    raise SystemExit("MCP issue view did not expose rollout plan")
report = json.loads(responses[-1]["result"]["content"][0]["text"])
if report["summary"]["status"] != "pass":
    raise SystemExit(report)
PY

git add .gitignore .github/workflows/ztrack.yml .volter/tracker-config.json .volter/tracker/validation/preset.cjs .volter/snapshot.json package.json package-lock.json packages apps test docs scripts README.md
git commit -q -m "adopt ztrack for inventory release lifecycle"

status="$(git status --short --ignored=no)"
if printf '%s\n' "$status" | rg '^\?\? \.volter/tracker/' >/dev/null; then
  printf 'unexpected ztrack local state:\n%s\n' "$status" >&2
  exit 1
fi

git clone -q "$app" "$clone"
cd "$clone"
npm ci >/dev/null
npm test >/dev/null
npm run lint >/dev/null
npx ztrack check --input .volter/snapshot.json --verify-commits --json > clone-check.json
test "$(json_field clone-check.json summary.status)" = "pass"

printf 'real project cycle ok\n'
printf 'app: %s\n' "$app"
printf 'clone: %s\n' "$clone"
