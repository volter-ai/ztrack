#!/usr/bin/env bash
# ZTB-27 dev/02: real (non-mocked) CI coverage for #13's optional-peer behavior. Complements
# src/sync/github/twinRuntime.test.ts (which proves the same contract with an injectable mock)
# with an end-to-end proof through the actual packed+installed CLI, running under plain node —
# no bun, no gh auth, no live GitHub network call. Deterministic; a CI/publish gate.
#
# Two consumer projects:
#   1. peers ABSENT  — `ztrack sync github` must fail closed with MISSING_TWIN_MESSAGE (never a
#      raw MODULE_NOT_FOUND resolution crash), and every other command must keep working. ZTB-31
#      dev/01 adds the sibling WORLD seam here too: the public `ztrack/world-annotations` subpath
#      export (src/worldTwinRuntime.ts:25's MISSING_WORLD_TWIN_MESSAGE) must fail the same way —
#      no CLI command path touches the world adapters, so this is a plain node ESM script calling
#      the subpath directly, mirroring src/worldTwinRuntime.test.ts's shape.
#   2. peers PRESENT (real npm packages) but run under node/npx — `@volter-ai-dev/twin-github`
#      ships TypeScript source only, so node's ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
#      fires; ztrack must surface NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE (the bun-hint), not the
#      "npm install" hint again (that would be actively wrong — the peers ARE installed).
#      `@volter-ai-dev/twin` (unlike -github) ships a COMPILED JS build, so the WORLD seam has no
#      bun-hint case here: the world-annotations subpath must simply resolve and load the peer
#      cleanly under plain node. The peers are pinned to the range this repo's own package.json
#      declares in `peerDependencies` (read at runtime, not copied) so a future twin 0.2.x publish
#      can't silently change what this gate installs and tests.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tarball="$tmp/$(cd "$repo_root" && npm pack --pack-destination "$tmp" --silent)"
twin_range="$(node -p "require('$repo_root/package.json').peerDependencies['@volter-ai-dev/twin']")"
twin_github_range="$(node -p "require('$repo_root/package.json').peerDependencies['@volter-ai-dev/twin-github']")"

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

# Writes a plain node ESM script at $1/probe-world.mjs that imports the packed
# `ztrack/world-annotations` subpath and calls listAnnotations (same call shape as
# src/worldTwinRuntime.test.ts:50) against a path that doesn't exist — the adapter loads twin
# BEFORE touching any path, so the outcome only depends on whether the peer is installed.
write_world_probe() {
  cat > "$1/probe-world.mjs" <<'EOF'
import { listAnnotations } from 'ztrack/world-annotations';
try {
  await listAnnotations('slack', '/does/not/matter');
  process.stdout.write('RESULT: resolved\n');
} catch (e) {
  process.stdout.write(`RESULT: rejected: ${e && e.message ? e.message : String(e)}\n`);
}
EOF
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

write_world_probe "$d"
world_out="$( cd "$d" && node probe-world.mjs 2>&1 )"
ok "$(yn "$(has "$world_out" 'npm install -D @volter-ai-dev/twin')")" Y "world-annotations subpath fails closed with MISSING_WORLD_TWIN_MESSAGE's install hint"
ok "$(yn "$(has "$world_out" 'MODULE_NOT_FOUND')")" N "world-annotations subpath never leaks a raw MODULE_NOT_FOUND/ERR_MODULE_NOT_FOUND"

echo
echo "## peers PRESENT (real npm packages, pinned to this repo's declared peerDependencies range), run under plain node/npx — the bun-hint path"
d2="$(new_consumer with-peers "@volter-ai-dev/twin@$twin_range @volter-ai-dev/twin-github@$twin_github_range")"
out2="$( cd "$d2" && npx ztrack sync github --repo test-owner/test-repo --pull 2>&1 )"; rc2=$?
ok "$rc2" "1" "sync github still exits nonzero under node even with the peers installed"
ok "$(yn "$(has "$out2" 'Run the command under bun instead')")" Y "surfaces NODE_CANNOT_LOAD_TWIN_GITHUB_MESSAGE's bun hint"
ok "$(yn "$(has "$out2" 'npm install -D @volter-ai-dev/twin @volter-ai-dev/twin-github')")" N "does not wrongly re-suggest npm install (the peers ARE installed)"

write_world_probe "$d2"
world_out2="$( cd "$d2" && node probe-world.mjs 2>&1 )"
ok "$(yn "$(has "$world_out2" 'requires the optional @volter-ai-dev/twin package')")" N "world-annotations subpath loads the (compiled-JS) peer cleanly under plain node — no missing-peer hint"
ok "$(yn "$(has "$world_out2" 'MODULE_NOT_FOUND')")" N "world-annotations subpath never leaks a raw MODULE_NOT_FOUND/ERR_MODULE_NOT_FOUND when peers are present"

echo
if [ "$fails" -eq 0 ]; then echo "missing-peer-gate: ALL PASS"; else echo "missing-peer-gate: $fails FAIL"; exit 1; fi
