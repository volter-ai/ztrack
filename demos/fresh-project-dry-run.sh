#!/usr/bin/env bash
# Fresh-project dry run: a real consumer installs the packed ztrack and runs the core adoption
# path on the `default` preset — init → create → red→green check → export + committed-root
# re-check — plus the package/ESM resolution guards (the library subpaths are ESM; CommonJS
# callers consume them via dynamic import()). Deterministic; CI gate.
#
# NOTE: this gate covers the core adoption path; the MCP `tracker_patch` flow has its own
# coverage, and the autonomy-profile subsystem was removed entirely (it was flag-preset-era
# legacy coupled to the deleted generic model).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="$(mktemp -d)"; trap 'rm -rf "$tmp_root"' EXIT
pkg_dir="$tmp_root/pkg"; mkdir -p "$pkg_dir"
tarball="$pkg_dir/$(cd "$repo_root" && npm pack --pack-destination "$pkg_dir" --silent)"

new_repo() {
  local dir="$tmp_root/$1"; mkdir -p "$dir"; cd "$dir"
  git init -q; git config user.email dry-run@example.com; git config user.name "ztrack Dry Run"
  echo "# $1" > README.md; git add README.md; git commit -q -m "initial commit"
  npm init -y >/dev/null; npm install "$tarball" >/dev/null
  printf '%s\n' "$dir"
}
json_field() { node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));let v=d;for(const p of process.argv[2].split('.'))v=v[/^[0-9]+$/.test(p)?+p:p];console.log(v)" "$1" "$2"; }
body() { printf '## Acceptance Criteria\n\n- [x] dev/01 v1 do it\n  - status: passed\n  - evidence ev1: commit=%s acv=1\n  - proof: "ev1 demonstrates it" -> ev1\n' "$1" > body.md; }

# ── default preset: red→green through the real packed CLI ───────────────────
repo="$(new_repo preset-default)"; cd "$repo"
sha="$(git rev-parse HEAD)"
npx ztrack init --team APP --preset default >/dev/null
body deadbeef
npx ztrack issue create --title "Dry default" --label type:case --state ready --assignee dry-run --body-file body.md >/dev/null
set +e; npx ztrack check --json > red.json; red_exit=$?; set -e
test "$red_exit" -eq 1
test "$(json_field red.json findings.0.code)" = "evidence_commit_not_found"
body "$sha"
npx ztrack issue edit APP-1 --body-file body.md >/dev/null
npx ztrack check --json > green.json
test "$(json_field green.json summary.status)" = "pass"
printf 'default red/green ok\n'

# ── committed validated root: export + re-check --input ─────────────────────
npx ztrack export --out .volter/root.json >/dev/null
npx ztrack check --input .volter/root.json --json > root-check.json
test "$(json_field root-check.json summary.status)" = "pass"
printf 'ci root ok\n'

# ── ESM-subpath import() guard: library subpaths are ESM (no CJS build); a CommonJS caller
#    consumes them via dynamic import(). Lock that contract through the installed package. ──
repo="$(new_repo cjs-import)"; cd "$repo"
cat > cjs-import.cjs <<'JS'
(async () => {
  const check = await import('ztrack/check');
  const sdk = await import('ztrack/sdk');
  if (typeof check.checkTracker !== 'function' || typeof sdk.createTrackerClient !== 'function') {
    throw new Error('ESM subpath not importable from CommonJS');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
JS
node cjs-import.cjs
printf 'esm-subpath import() guard ok (CommonJS callers can import the library)\n'

# ── package.json export guard: tooling commonly reads a dep's package.json, so it must be
#    exported (`"./package.json": "./package.json"`). ────────────────────────
node -e "if (typeof require('ztrack/package.json').version !== 'string') process.exit(1)"
printf 'package.json export guard ok\n'

printf 'fresh-project dry run complete\n'
