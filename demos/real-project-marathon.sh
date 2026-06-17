#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
minutes="${ZTRACK_REAL_PROJECT_MINUTES:-120}"
max_cycles="${ZTRACK_REAL_PROJECT_MAX_CYCLES:-0}"
tmp_root="${ZTRACK_REAL_PROJECT_WORKDIR:-$(mktemp -d)}"
keep="${ZTRACK_REAL_PROJECT_KEEP:-1}"

cleanup() {
  if [[ "$keep" != "1" ]]; then rm -rf "$tmp_root"; fi
}
trap cleanup EXIT

pkg_dir="$tmp_root/pkg"
app="$tmp_root/atlas-commerce"
clone="$tmp_root/atlas-commerce-clone"
mkdir -p "$pkg_dir" "$app"

deadline=$(( $(date +%s) + minutes * 60 ))
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log="$tmp_root/marathon.log"

note() {
  printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$log"
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

write_case_body() {
  local file="$1"
  local title="$2"
  local source="$3"
  local capability="$4"
  cat > "$file" <<EOF
# $title

## Summary

$source [1]

## Acceptance Criteria

- [ ] dev/01 status: pending Implement the $capability capability. [1]
- [ ] dev/02 status: pending Cover $capability with automated tests. [1]
- [ ] proc/01 status: pending Document operational behavior for $capability. [1]

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
body += f"\n[{evidence}] type: pr ac: {ac} repo: atlas/commerce number: {evidence[1:]} head: main justification: Verified in marathon cycle.\n"
p.write_text(body)
PY
}

tarball_name="$(cd "$repo_root" && npm pack --pack-destination "$pkg_dir" --silent)"
tarball="$pkg_dir/$tarball_name"

cd "$app"
git init -q
git config user.email marathon@example.com
git config user.name "Atlas Commerce"

mkdir -p packages/core/src packages/api/src packages/admin/src docs/runbooks docs/adr test scripts .github/workflows
cat > package.json <<'EOF'
{
  "name": "atlas-commerce",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.js",
    "lint": "node scripts/lint-workspace.mjs",
    "release:check": "npm test && npm run lint && ztrack check",
    "snapshot": "ztrack snapshot export --out .volter/snapshot.json"
  },
  "dependencies": {},
  "devDependencies": {}
}
EOF
cat > README.md <<EOF
# Atlas Commerce

Generated long-running ztrack adoption project.

Started: $started_at
EOF
cat > packages/core/src/catalog.js <<'EOF'
export function createCatalog(seed = []) {
  const items = new Map(seed.map((item) => [item.sku, { ...item }]));
  return {
    upsert(item) {
      if (!item?.sku) throw new Error('sku required');
      const next = { active: true, priceCents: 0, ...item };
      items.set(next.sku, next);
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
cat > packages/api/src/routes.js <<'EOF'
export function createRoutes(catalog) {
  return {
    listProducts() {
      return { status: 200, body: { products: catalog.list() } };
    },
    putProduct(input) {
      return { status: 200, body: { product: catalog.upsert(input) } };
    },
  };
}
EOF
cat > packages/admin/src/render.js <<'EOF'
export function renderTable(rows) {
  return rows.map((row) => Object.values(row).join('\t')).join('\n');
}
EOF
cat > scripts/lint-workspace.mjs <<'EOF'
import { existsSync, readdirSync, readFileSync } from 'node:fs';

for (const dir of ['docs/runbooks', 'docs/adr']) {
  if (!existsSync(dir)) throw new Error(`${dir} missing`);
  const files = readdirSync(dir).filter((file) => file.endsWith('.md'));
  if (!files.length) throw new Error(`${dir} has no markdown files`);
  for (const file of files) {
    if (!readFileSync(`${dir}/${file}`, 'utf8').trim()) throw new Error(`${dir}/${file} empty`);
  }
}
EOF
cat > docs/runbooks/catalog.md <<'EOF'
# Catalog Runbook

Catalog changes are validated by tests and ztrack evidence.
EOF
cat > docs/adr/0001-catalog.md <<'EOF'
# ADR 0001: Catalog Model

Catalog entries are keyed by SKU and audited through ztrack issues.
EOF
cat > test/catalog.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalog } from '../packages/core/src/catalog.js';

test('catalog upserts and lists products', () => {
  const catalog = createCatalog();
  catalog.upsert({ sku: 'SKU-1', name: 'Tea', priceCents: 500 });
  assert.equal(catalog.get('SKU-1').priceCents, 500);
  assert.equal(catalog.list().length, 1);
});
EOF
cat > test/routes.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalog } from '../packages/core/src/catalog.js';
import { createRoutes } from '../packages/api/src/routes.js';

test('routes list products', () => {
  const catalog = createCatalog([{ sku: 'SKU-1', name: 'Tea', priceCents: 500 }]);
  const routes = createRoutes(catalog);
  assert.equal(routes.listProducts().body.products.length, 1);
});
EOF
npm test >/dev/null
npm run lint >/dev/null
git add .
git commit -q -m "bootstrap atlas commerce workspace"

npm install -D "$tarball" >/dev/null
npx ztrack init --team AC --preset simple-sdlc >/dev/null

cat >> .volter/tracker/validation/preset.cjs <<'EOF'

const __atlasBaseCheckSnapshot = module.exports.snapshot.checkSnapshot;
module.exports.snapshot.checkSnapshot = function atlasProjectCheckSnapshot(snapshot, options) {
  const report = __atlasBaseCheckSnapshot(snapshot, options);
  for (const issue of Array.isArray(snapshot && snapshot.cases) ? snapshot.cases : []) {
    const labels = Array.isArray(issue.labels) ? issue.labels.map(String) : [];
    const body = String(issue.body || '');
    const isDone = ['done', 'completed'].includes(String(issue.stateType || issue.state || '').toLowerCase());
    if (labels.includes('area:api') && isDone && !/^##\s+Rollout Plan\s*$/im.test(body)) {
      report.findings.push({
        level: 'error',
        code: 'atlas_api_done_missing_rollout_plan',
        issue: String(issue.identifier || 'unknown'),
        message: 'Completed API cases must include ## Rollout Plan.',
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

note "marathon workspace ready: $app"
cycle=0
while [[ "$(date +%s)" -lt "$deadline" ]]; do
  if [[ "$max_cycles" != "0" && "$cycle" -ge "$max_cycles" ]]; then
    break
  fi
  cycle=$((cycle + 1))

  capability="capability-$cycle"
  area="core"
  if (( cycle % 3 == 0 )); then area="api"; fi
  if (( cycle % 5 == 0 )); then area="admin"; fi

  feature_file="packages/$area/src/${capability}.js"
  test_file="test/${capability}.test.js"
  runbook_file="docs/runbooks/${capability}.md"
  adr_file="docs/adr/$(printf '%04d' "$((cycle + 1))")-${capability}.md"
  mkdir -p "$(dirname "$feature_file")"
  cat > "$feature_file" <<EOF
export function ${capability//-/_}Record(input = {}) {
  const id = String(input.id || '$capability');
  const enabled = input.enabled !== false;
  const score = Number(input.score || $cycle);
  return { id, enabled, score, label: '${capability}' };
}

export function ${capability//-/_}Summary(records = []) {
  return {
    total: records.length,
    enabled: records.filter((record) => record.enabled).length,
    score: records.reduce((sum, record) => sum + Number(record.score || 0), 0),
  };
}
EOF
  cat > "$test_file" <<EOF
import assert from 'node:assert/strict';
import test from 'node:test';
import { ${capability//-/_}Record, ${capability//-/_}Summary } from '../$feature_file';

test('$capability record and summary', () => {
  const first = ${capability//-/_}Record({ id: 'A', score: 2 });
  const second = ${capability//-/_}Record({ id: 'B', enabled: false, score: 3 });
  assert.equal(first.label, '$capability');
  assert.deepEqual(${capability//-/_}Summary([first, second]), { total: 2, enabled: 1, score: 5 });
});
EOF
  cat > "$runbook_file" <<EOF
# $capability Runbook

## Rollout

- Enable the $capability flag for internal tenants.
- Watch generated score and enabled counts.
- Roll back by disabling the flag.
EOF
  cat > "$adr_file" <<EOF
# ADR $cycle: $capability

The $area package owns $capability because the behavior is local to that layer.
EOF

  npm test >/dev/null
  npm run lint >/dev/null
  git add "$feature_file" "$test_file" "$runbook_file" "$adr_file"
  git commit -q -m "cycle $cycle implement $capability in $area"
  feature_sha="$(git rev-parse --short HEAD)"

  body_file="$capability.md"
  write_case_body "$body_file" "Deliver $capability" \
    "The $area team needs $capability to support the staged commerce rollout." \
    "$capability"
  npx ztrack issue create --title "Deliver $capability" --label type:case --label "area:$area" --state "In Progress" --assignee "dev-$area" --body-file "$body_file" >/dev/null
  issue_id="AC-$cycle"

  npx ztrack check --json > "planning-$cycle.json"
  test "$(json_field "planning-$cycle.json" summary.status)" = "pass"

  pass_ac "$body_file" dev/01 "Implement the $capability capability." "$feature_sha" E1
  pass_ac "$body_file" dev/02 "Cover $capability with automated tests." "$feature_sha" E2
  npx ztrack issue edit "$issue_id" --body-file "$body_file" --state Done >/dev/null
  set +e
  npx ztrack check --json > "done-red-$cycle.json"
  done_exit=$?
  set -e
  test "$done_exit" -eq 1

  pass_ac "$body_file" proc/01 "Document operational behavior for $capability." "$feature_sha" E3
  if [[ "$area" == "api" ]]; then
    npx ztrack issue edit "$issue_id" --body-file "$body_file" >/dev/null
    set +e
    npx ztrack check --json > "rollout-red-$cycle.json"
    rollout_exit=$?
    set -e
    test "$rollout_exit" -eq 1
    python3 - "$body_file" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text() + "\n## Rollout Plan\n\n- Enable behind a flag.\n- Monitor API errors.\n- Roll back by disabling the flag.\n")
PY
  fi

  if (( cycle % 7 == 0 )); then
    python3 - "$body_file" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('commit:', 'commit: deadbee # bad ', 1))
PY
    npx ztrack issue edit "$issue_id" --body-file "$body_file" >/dev/null
    set +e
    npx ztrack check --json > "sha-red-$cycle.json"
    sha_exit=$?
    set -e
    test "$sha_exit" -eq 1
    python3 - "$body_file" "$feature_sha" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
p.write_text(p.read_text().replace('commit: deadbee # bad ', 'commit: ', 1))
PY
  fi

  npx ztrack issue edit "$issue_id" --body-file "$body_file" >/dev/null
  npx ztrack check --json > "green-$cycle.json"
  test "$(json_field "green-$cycle.json" summary.status)" = "pass"

  if (( cycle % 4 == 0 )); then
    npx ztrack snapshot export --out .volter/snapshot.json >/dev/null
    npx ztrack check --input .volter/snapshot.json --verify-commits --json > "snapshot-$cycle.json"
    test "$(json_field "snapshot-$cycle.json" summary.status)" = "pass"
  fi

  if (( cycle % 6 == 0 )); then
    cat > sdk-cycle.mjs <<'EOF'
import { createTrackerClient } from 'ztrack';
const client = createTrackerClient();
const issues = await client.issue.list({ label: 'type:case', limit: 500, json: 'identifier,title,state' });
if (!Array.isArray(issues) || issues.length === 0) throw new Error('no ztrack cases');
console.log(JSON.stringify({ cases: issues.length }));
EOF
    node sdk-cycle.mjs > "sdk-$cycle.json"
    test "$(json_field "sdk-$cycle.json" cases)" -ge "$cycle"
  fi

  if (( cycle % 8 == 0 )); then
    printf '%s\n' \
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tracker_check","arguments":{}}}' \
      | npx ztrack mcp serve > "mcp-$cycle.jsonl"
    python3 - "$cycle" <<'PY'
import json
import sys
lines = [json.loads(line) for line in open(f"mcp-{sys.argv[1]}.jsonl") if line.strip()]
report = json.loads(lines[-1]["result"]["content"][0]["text"])
if report["summary"]["status"] != "pass":
    raise SystemExit(report)
PY
  fi

  if (( cycle % 10 == 0 )); then
    rm -rf "$clone"
    npx ztrack snapshot export --out .volter/snapshot.json >/dev/null
    git add .gitignore .github/workflows/ztrack.yml .volter/tracker-config.json .volter/tracker/validation/preset.cjs .volter/snapshot.json package.json package-lock.json packages test docs scripts README.md
    git diff --cached --quiet || git commit -q -m "cycle $cycle adopt verified $capability"
    git clone -q "$app" "$clone"
    (cd "$clone" && npm ci >/dev/null && npm test >/dev/null && npm run lint >/dev/null && npx ztrack check --input .volter/snapshot.json --verify-commits --json > clone-check.json && test "$(json_field clone-check.json summary.status)" = "pass")
  fi

  note "cycle $cycle complete area=$area issue=$issue_id"
done

npx ztrack snapshot export --out .volter/snapshot.json >/dev/null
npx ztrack check --input .volter/snapshot.json --verify-commits --json > final-snapshot.json
test "$(json_field final-snapshot.json summary.status)" = "pass"
git add .gitignore .github/workflows/ztrack.yml .volter/tracker-config.json .volter/tracker/validation/preset.cjs .volter/snapshot.json package.json package-lock.json packages test docs scripts README.md
git diff --cached --quiet || git commit -q -m "complete marathon verified lifecycle"

note "marathon complete cycles=$cycle app=$app"
printf 'real project marathon complete\n'
printf 'workdir: %s\n' "$tmp_root"
printf 'app: %s\n' "$app"
