#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT

pkg_dir="$tmp_root/pkg"
app="$tmp_root/taskflow-kit"
clone="$tmp_root/taskflow-kit-clone"
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

# default grammar: one passed dev AC (image+commit evidence + proof) and one still-pending
# dev AC. State `in-review` is GREEN only once every AC is passed, so this body starts the
# issue in-review-blocked until dev/02 is filled in.
write_body() {
  local path="$1"
  local title="$2"
  local id="$3"
  local ac1="$4"
  local ac2="$5"
  local sha="$6"
  local source="$7"
  cat > "$path" <<EOF
# $id: $title

Summary: $source
Status: in-progress
Assignee: maintainer

## Acceptance Criteria

- [x] dev/01 v1 $ac1
  - status: passed
  - evidence E1: commit=$sha acv=1
  - proof: "E1 demonstrates dev/01" -> E1
- [ ] dev/02 v1 $ac2
  - status: pending
EOF
}

cd "$app"
git init -q
git config user.email cycle@example.com
git config user.name "ztrack Smoke"
git checkout -q -b main 2>/dev/null || git branch -q -M main

mkdir -p src test docs examples scripts
cat > package.json <<'EOF'
{
  "name": "taskflow-kit",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.js",
    "check": "npm test && ztrack check",
    "export": "ztrack export --out .volter/root.json"
  },
  "dependencies": {},
  "devDependencies": {}
}
EOF
cat > src/store.js <<'EOF'
export function createTaskStore(seed = []) {
  let nextId = 1;
  const tasks = [];
  for (const item of seed) addTask(item.title, item);

  function addTask(title, options = {}) {
    const clean = String(title || '').trim();
    if (!clean) throw new Error('title required');
    const task = {
      id: String(nextId++),
      title: clean,
      status: options.status || 'todo',
      tags: [...(options.tags || [])],
      createdAt: options.createdAt || '2026-01-01T00:00:00.000Z',
    };
    tasks.push(task);
    return { ...task, tags: [...task.tags] };
  }

  return {
    addTask,
    listTasks(filter = {}) {
      return tasks
        .filter((task) => !filter.status || task.status === filter.status)
        .filter((task) => !filter.tag || task.tags.includes(filter.tag))
        .map((task) => ({ ...task, tags: [...task.tags] }));
    },
    completeTask(id) {
      const task = tasks.find((item) => item.id === String(id));
      if (!task) return false;
      task.status = 'done';
      return true;
    },
  };
}
EOF
cat > src/report.js <<'EOF'
export function summarizeTasks(tasks) {
  const summary = { total: tasks.length, todo: 0, done: 0, tags: {} };
  for (const task of tasks) {
    if (task.status === 'done') summary.done += 1;
    else summary.todo += 1;
    for (const tag of task.tags || []) summary.tags[tag] = (summary.tags[tag] || 0) + 1;
  }
  return summary;
}
EOF
cat > src/index.js <<'EOF'
export { createTaskStore } from './store.js';
export { summarizeTasks } from './report.js';
EOF
cat > test/store.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskStore } from '../src/store.js';

test('creates, filters, and completes tasks', () => {
  const store = createTaskStore();
  const first = store.addTask('Ship docs', { tags: ['docs'] });
  store.addTask('Fix bug', { tags: ['bug'] });
  assert.equal(store.listTasks().length, 2);
  assert.equal(store.listTasks({ tag: 'docs' })[0].id, first.id);
  assert.equal(store.completeTask(first.id), true);
  assert.equal(store.listTasks({ status: 'done' }).length, 1);
});
EOF
cat > test/report.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeTasks } from '../src/report.js';

test('summarizes task status and tags', () => {
  const summary = summarizeTasks([
    { status: 'todo', tags: ['docs'] },
    { status: 'done', tags: ['docs', 'bug'] },
  ]);
  assert.deepEqual(summary, { total: 2, todo: 1, done: 1, tags: { docs: 2, bug: 1 } });
});
EOF
cat > README.md <<'EOF'
# taskflow-kit

Small task store used by the ztrack full development cycle demo.
EOF
cat > docs/USAGE.md <<'EOF'
# Usage

Create a task store, add tasks, filter by tag/status, and summarize reports.
EOF
cat > examples/basic.mjs <<'EOF'
import { createTaskStore, summarizeTasks } from '../src/index.js';

const store = createTaskStore();
store.addTask('Write cookbook', { tags: ['docs'] });
console.log(summarizeTasks(store.listTasks()));
EOF
npm test >/dev/null
git add .
git commit -q -m "initial taskflow kit"

# A realistic adopter already has several commits before ztrack arrives.
python3 - <<'PY'
from pathlib import Path
p = Path("src/store.js")
s = p.read_text()
s = s.replace("completeTask(id) {", "renameTask(id, title) {\n      const task = tasks.find((item) => item.id === String(id));\n      if (!task) return false;\n      const clean = String(title || '').trim();\n      if (!clean) throw new Error('title required');\n      task.title = clean;\n      return true;\n    },\n    completeTask(id) {")
p.write_text(s)
p = Path("test/store.test.js")
s = p.read_text()
s = s.replace("assert.equal(store.completeTask(first.id), true);", "assert.equal(store.renameTask(first.id, 'Ship better docs'), true);\n  assert.equal(store.listTasks({ tag: 'docs' })[0].title, 'Ship better docs');\n  assert.equal(store.completeTask(first.id), true);")
p.write_text(s)
PY
npm test >/dev/null
git add src/store.js test/store.test.js
git commit -q -m "add task rename support"
rename_sha="$(git rev-parse --short HEAD)"

python3 - <<'PY'
from pathlib import Path
p = Path("src/report.js")
s = p.read_text()
s = s.replace("return summary;", "summary.completionRate = summary.total === 0 ? 0 : summary.done / summary.total;\n  return summary;")
p.write_text(s)
p = Path("test/report.test.js")
s = p.read_text()
s = s.replace("assert.deepEqual(summary, { total: 2, todo: 1, done: 1, tags: { docs: 2, bug: 1 } });", "assert.deepEqual(summary, { total: 2, todo: 1, done: 1, tags: { docs: 2, bug: 1 }, completionRate: 0.5 });")
p.write_text(s)
PY
npm test >/dev/null
git add src/report.js test/report.test.js
git commit -q -m "add completion rate reporting"
report_sha="$(git rev-parse --short HEAD)"

python3 - <<'PY'
from pathlib import Path
p = Path("docs/USAGE.md")
p.write_text(p.read_text() + "\n\n## Reporting\n\nUse `summarizeTasks()` to compute totals, tag counts, and completion rate.\n")
PY
git add docs/USAGE.md
git commit -q -m "document reporting"
docs_sha="$(git rev-parse --short HEAD)"

npm install -D "$tarball" >/dev/null
npx ztrack init --team OSS --preset default >/dev/null

write_body rename.md \
  "Rename existing tasks" OSS-1 \
  "Users can rename an existing task while preserving id and tags." \
  "Renaming rejects blank titles." \
  "$rename_sha" \
  "Task maintainers need to correct task titles after import."
npx ztrack issue create --title "Rename existing tasks" --label type:case --label area:store --state in-progress --assignee maintainer --body-file rename.md >/dev/null

write_body report.md \
  "Report completion rate" OSS-2 \
  "Reports include total, status counts, tag counts, and completion rate." \
  "Documentation explains the reporting fields." \
  "$report_sha" \
  "Project dashboards need a completion-rate summary."
npx ztrack issue create --title "Report completion rate" --label type:case --label area:reporting --state in-progress --assignee maintainer --body-file report.md >/dev/null

write_body docs.md \
  "Document reporting API" OSS-3 \
  "Usage docs describe reporting helpers." \
  "Examples show the reporting helper." \
  "$docs_sha" \
  "New OSS users need examples for the reporting API."
npx ztrack issue create --title "Document reporting API" --label type:case --label area:docs --state in-progress --assignee maintainer --body-file docs.md >/dev/null

# Review gate: a maintainer tries to advance an issue to in-review while one AC is still
# pending. The default lifecycle blocks in-review until every AC is passed.
python3 <<'PY'
from pathlib import Path
p = Path("rename.md")
p.write_text(p.read_text().replace("Status: in-progress", "Status: in-review"))
PY
npx ztrack issue edit OSS-1 --state in-review --body-file rename.md >/dev/null
set +e
npx ztrack check --json > done-red.json
done_red_exit=$?
set -e
test "$done_red_exit" -eq 1
codes="$(python3 -c 'import json;print(" ".join(f["code"] for f in json.load(open("done-red.json"))["findings"]))')"
printf '%s' "$codes" | grep -q "review_requires_all_acs_passed"
# Resolve by passing dev/02 (evidence + proof, cited at the rename commit) and dropping back to
# in-progress: with every AC passed the issue is clean again (no PR/merge brittleness — the
# committed root re-checks cleanly from any fresh clone).
python3 - "$rename_sha" <<'PY'
from pathlib import Path
import sys

sha = sys.argv[1]
p = Path("rename.md")
text = p.read_text()
text = text.replace("Status: in-review", "Status: in-progress")
text = text.replace(
    "- [ ] dev/02 v1 Renaming rejects blank titles.\n  - status: pending\n",
    "- [x] dev/02 v1 Renaming rejects blank titles.\n  - status: passed\n"
    f"  - evidence E2: commit={sha} acv=1\n"
    "  - proof: \"E2 demonstrates dev/02\" -> E2\n",
)
p.write_text(text)
PY
npx ztrack issue edit OSS-1 --state in-progress --body-file rename.md >/dev/null
npx ztrack check --json > done-green.json
test "$(json_field done-green.json summary.status)" = "pass"

# A realistic red proof: one issue cites a fabricated commit, then gets fixed.
write_body broken.md \
  "Reject empty task titles" OSS-4 \
  "The store rejects empty task titles." \
  "The error message stays stable for callers." \
  "deadbee" \
  "Imported data can contain blank task titles."
npx ztrack issue create --title "Reject empty task titles" --label type:bug --label area:store --state in-progress --assignee maintainer --body-file broken.md >/dev/null

set +e
npx ztrack check --verify-commits --json > red.json
red_exit=$?
set -e
test "$red_exit" -eq 1
codes="$(python3 -c 'import json;print(" ".join(f["code"] for f in json.load(open("red.json"))["findings"]))')"
printf '%s' "$codes" | grep -q "evidence_commit_not_found"

python3 - "$rename_sha" <<'PY'
from pathlib import Path
import sys
p = Path("broken.md")
p.write_text(p.read_text().replace("deadbee", sys.argv[1]))
PY
npx ztrack issue edit OSS-4 --body-file broken.md >/dev/null
npx ztrack check --verify-commits --json > green.json
test "$(json_field green.json summary.status)" = "pass"
test "$(json_field green.json summary.issues)" -eq 4

npx ztrack issue list --label type:case --limit 10 --json identifier,title,state > issue-list.json
test "$(python3 - <<'PY'
import json
print(len(json.load(open("issue-list.json"))))
PY
)" -ge 3

npx ztrack export --out .volter/root.json >/dev/null
npx ztrack check --input .volter/root.json --verify-commits --json > root-check.json
test "$(json_field root-check.json summary.status)" = "pass"

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
          root: .volter/root.json
EOF

cat > sdk-cycle.mjs <<'EOF'
import { createTrackerClient } from 'ztrack';

const client = createTrackerClient();
const openCases = await client.issue.list({ label: 'type:case', limit: 20, json: 'identifier,title,state' });
if (!Array.isArray(openCases) || openCases.length < 3) {
  throw new Error(`expected at least 3 cases, got ${Array.isArray(openCases) ? openCases.length : 'non-array'}`);
}
const first = await client.issue.view(openCases[0].identifier, { json: 'identifier,title,body' });
if (!String(first.body || '').includes('## Acceptance Criteria')) {
  throw new Error('SDK view did not include issue body');
}
console.log(JSON.stringify({ cases: openCases.length, first: first.identifier }));
EOF
node sdk-cycle.mjs > sdk-cycle.json
test "$(json_field sdk-cycle.json cases)" -ge 3

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tracker_issue_list","arguments":{"limit":10}}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"tracker_check","arguments":{}}}' \
  | npx ztrack mcp serve > mcp-cycle.jsonl
python3 - <<'PY'
import json
responses = [json.loads(line) for line in open("mcp-cycle.jsonl") if line.strip()]
tools = responses[1]["result"]["tools"]
if not any(tool["name"] == "tracker_check" for tool in tools):
    raise SystemExit("tracker_check missing from tools/list")
report = json.loads(responses[-1]["result"]["content"][0]["text"])
if report["summary"]["status"] != "pass":
    raise SystemExit(report)
PY

cat > .gitignore.local <<'EOF'
red.json
green.json
issue-list.json
root-check.json
mcp-cycle.jsonl
sdk-cycle.json
sdk-cycle.mjs
*.md.tmp
EOF

git add .gitignore .github/workflows/ztrack.yml .volter/tracker-config.json .volter/tracker/validation .volter/root.json package.json package-lock.json src test docs examples README.md
git commit -q -m "adopt ztrack with verified task evidence"

status="$(git status --short --ignored=no)"
if printf '%s\n' "$status" | grep -E '^\?\? \.volter/tracker/validation/' >/dev/null; then
  printf 'unexpected untracked ztrack local state:\n%s\n' "$status" >&2
  exit 1
fi

git clone -q "$app" "$clone"
cd "$clone"
npm ci >/dev/null
npm test >/dev/null
npx ztrack check --input .volter/root.json --verify-commits --json > clone-check.json
test "$(json_field clone-check.json summary.status)" = "pass"

printf 'full dev cycle ok\n'
printf 'app: %s\n' "$app"
printf 'clone: %s\n' "$clone"
