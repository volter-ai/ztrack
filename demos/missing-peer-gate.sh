#!/usr/bin/env bash
# ZTB-27 dev/02: real (non-mocked) CI coverage for #13's optional-peer behavior. Complements
# src/sync/github/twinRuntime.test.ts (which proves the same contract with an injectable mock)
# with an end-to-end proof through the actual packed+installed CLI, running under plain node —
# no bun, no gh auth, no live GitHub network call. Deterministic; a CI/publish gate.
#
# Two consumer projects:
#   1. peers ABSENT  — `ztrack sync github` must fail closed with MISSING_TWIN_MESSAGE (never a
#      raw MODULE_NOT_FOUND resolution crash), and every other command must keep working.
#   2. peers PRESENT (real npm packages) but run under node/npx — `@volter-ai-dev/twin-github`
#      ships TypeScript source only, so node's ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
#      fires; ztrack must surface NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE (the bun-hint), not the
#      "npm install" hint again (that would be actively wrong — the peers ARE installed).
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tarball="$tmp/$(cd "$repo_root" && npm pack --pack-destination "$tmp" --silent)"

fails=0
ok() { if [ "$1" = "$2" ]; then echo "  ok: $3"; else echo "  FAIL: $3 (got '$1' want '$2')"; fails=$((fails + 1)); fi; }
yn() { [ "$1" -ge 1 ] && echo Y || echo N; }
has() { printf '%s' "$1" | grep -c -F "$2" || true; }

# Fresh consumer at $tmp/$1: npm-init, install the tarball (+ any extra packages in "$2"), then
# `ztrack init` — a plain command that never touches twin, so it works identically whether the
# optional peers are installed or not. Echoes the project dir.
new_consumer() {
  local dir="$tmp/$1"; mkdir -p "$dir"
  ( cd "$dir" \
    && npm init -y >/dev/null 2>&1 \
    && npm install "$tarball" ${2:-} --no-save >/dev/null 2>&1 \
    && npx ztrack init --team APP --preset default >/dev/null 2>&1 )
  printf '%s' "$dir"
}

echo "## peers ABSENT — sync github fails closed with the install hint; everything else still works"
d="$(new_consumer no-peers)"
out="$( cd "$d" && npx ztrack sync github --repo test-owner/test-repo --pull 2>&1 )"; rc=$?
ok "$rc" "1" "sync github exits nonzero when the optional peers are absent"
ok "$(yn "$(has "$out" 'requires the optional sync packages')")" Y "surfaces MISSING_TWIN_MESSAGE's install hint"
ok "$(yn "$(has "$out" 'MODULE_NOT_FOUND')")" N "no raw MODULE_NOT_FOUND leaks to the user"

help_rc="$( ( cd "$d" && npx ztrack --help >/dev/null 2>&1 ); echo $? )"
ok "$help_rc" "0" "ztrack --help still works with peers absent (the CLI doesn't crash at startup)"

check_out="$( cd "$d" && npx ztrack check 2>&1 )"
ok "$(yn "$(has "$check_out" 'MODULE_NOT_FOUND')")" N "ztrack check doesn't crash on twin resolution either"

echo
echo "## peers PRESENT (real npm packages), run under plain node/npx — the bun-hint path"
d2="$(new_consumer with-peers '@volter-ai-dev/twin @volter-ai-dev/twin-github')"
out2="$( cd "$d2" && npx ztrack sync github --repo test-owner/test-repo --pull 2>&1 )"; rc2=$?
ok "$rc2" "1" "sync github still exits nonzero under node even with the peers installed"
ok "$(yn "$(has "$out2" 'Run the command under bun instead')")" Y "surfaces NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE's bun hint"
ok "$(yn "$(has "$out2" 'npm install -D @volter-ai-dev/twin @volter-ai-dev/twin-github')")" N "does not wrongly re-suggest npm install (the peers ARE installed)"

echo
if [ "$fails" -eq 0 ]; then echo "missing-peer-gate: ALL PASS"; else echo "missing-peer-gate: $fails FAIL"; exit 1; fi
