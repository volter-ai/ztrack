#!/usr/bin/env bash
# Package-manager compatibility matrix: install the packed ztrack under each layout that
# npm's flat node_modules doesn't exercise — pnpm (strict isolated store), yarn classic,
# yarn Berry / PnP, and bun — and run `init` + a green `check`. Catches resolution
# regressions (phantom deps, the `require`/`exports` conditions, PnP) that the npm-based
# fresh-project dry-run can't. pnpm/yarn come via corepack (bundled with Node), pinned.
set -uo pipefail
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tarball="$(cd "$repo_root" && npm pack --pack-destination "$tmp" --silent)"
tar="$tmp/$tarball"

PNPM="corepack pnpm@9.15.4"
YARN1="corepack yarn@1.22.22"
YARN4="corepack yarn@4.5.3"

fails=0
report() { if [ "$1" = 0 ]; then echo "  ok: $2"; else echo "  FAIL: $2 (exit $1)"; fails=$((fails + 1)); fi; }

# Fresh consumer repo at $1 with the packed tarball copied in; echoes the HEAD short sha
# (cited as a real, existing commit so the green check passes commit-existence by default).
new_consumer() {
  mkdir -p "$1"; cp "$tar" "$1/ztrack.tgz"
  git -C "$1" init -q; git -C "$1" config user.email ci@example.com; git -C "$1" config user.name "pm matrix"
  echo "# consumer" > "$1/README.md"; git -C "$1" add README.md; git -C "$1" commit -q -m init
  git -C "$1" rev-parse --short HEAD
}
green_body() { printf '# T\n\n## Acceptance Criteria\n\n- [x] AC-01 do it commit: %s [E1]\n\n## Evidence\n\n[E1] type: pr\n' "$1" > body.md; }

echo "## pnpm (strict isolated store)"
d="$tmp/pnpm"; sha="$(new_consumer "$d")"; cd "$d"; set +e
$PNPM init >/dev/null 2>&1
$PNPM add -D ./ztrack.tgz >/dev/null 2>&1
$PNPM exec ztrack init --team APP --preset basic >/dev/null 2>&1
green_body "$sha"
$PNPM exec ztrack issue create --title T --label type:case --state "In Progress" --assignee t --body-file body.md >/dev/null 2>&1
$PNPM exec ztrack check >/dev/null 2>&1; report $? "pnpm: init + green check"
set -e; cd "$repo_root"

echo "## yarn classic (1.x)"
d="$tmp/yarn1"; sha="$(new_consumer "$d")"; cd "$d"; set +e
printf '{"name":"c","packageManager":"yarn@1.22.22"}\n' > package.json
$YARN1 add -D ./ztrack.tgz >/dev/null 2>&1
$YARN1 ztrack init --team APP --preset basic >/dev/null 2>&1
green_body "$sha"
$YARN1 ztrack issue create --title T --label type:case --state "In Progress" --assignee t --body-file body.md >/dev/null 2>&1
$YARN1 ztrack check >/dev/null 2>&1; report $? "yarn-classic: init + green check"
set -e; cd "$repo_root"

echo "## yarn Berry / PnP (pure-JS markdown backend — no subprocess/helper to resolve)"
d="$tmp/pnp"; sha="$(new_consumer "$d")"; cd "$d"; set +e
printf '{"name":"c","packageManager":"yarn@4.5.3"}\n' > package.json
$YARN4 install >/dev/null 2>&1
$YARN4 add ./ztrack.tgz >/dev/null 2>&1
$YARN4 ztrack init --team APP --preset basic >/dev/null 2>&1
green_body "$sha"
$YARN4 ztrack issue create --title T --label type:case --state "In Progress" --assignee t --body-file body.md >/dev/null 2>&1
$YARN4 ztrack check >/dev/null 2>&1; report $? "yarn-PnP+markdown: init + green check"
set -e; cd "$repo_root"

echo "## bun"
d="$tmp/bun"; sha="$(new_consumer "$d")"; cd "$d"; set +e
printf '{"name":"c"}\n' > package.json
bun add -D ./ztrack.tgz >/dev/null 2>&1
./node_modules/.bin/ztrack init --team APP --preset basic >/dev/null 2>&1
green_body "$sha"
./node_modules/.bin/ztrack issue create --title T --label type:case --state "In Progress" --assignee t --body-file body.md >/dev/null 2>&1
./node_modules/.bin/ztrack check >/dev/null 2>&1; report $? "bun: init + green check"
set -e; cd "$repo_root"

echo
if [ "$fails" -eq 0 ]; then echo "pm-matrix: ALL PASS"; else echo "pm-matrix: $fails FAIL"; exit 1; fi
