# Design: storage scope, worktrees, and evidence

Status: agreed, in build. This is the north star for the evidence + linked-worktree work
(targets 0.22.0, breaking).

## The one principle

**Storage scope follows the source of truth. Verification is commit/locator-anchored,
never working-tree-anchored.**

Everything below derives from that.

## Two modes, two scopes

| | Source of truth | Scope | Where it lives | Pushed/cloned? |
|---|---|---|---|---|
| **Local** | git | **branch / per-worktree** | working tree: `.volter/tracker/markdown/` (committed) | **yes** — issues travel as code |
| **Linked** | GitHub / Linear / Jira | **per-clone (shared by all worktrees)** | `<git-common-dir>/ztrack/` (machine-local cache) | **never** |

- **Local** issues are branch-scoped *on purpose*: a feature branch carries its in-flight
  issue state **and** the commits that prove its ACs done, and they merge atomically with the
  code. One file per issue → parallel worktrees touching different issues merge cleanly; two
  branches editing the same issue conflict, which is correct. (Proven: the 25-feature / 4-worktree
  simulation.)
- **Linked** issues are GitHub's — one set, *not* per-branch. So the local cache (issue
  markdown + sync cursor/base/bindings + evidence staging) belongs to the **clone**, shared by
  every worktree, repopulated by `ztrack sync`. Today it's wrongly scoped per-worktree, so a fresh
  worktree sees the link but **0 issues** — that's the bug Phase 1 fixes.

## Why `<git-common-dir>/ztrack/`, resolved at runtime

- `git rev-parse --git-common-dir` resolves to the **same `.git` for every worktree of a clone**
  (verified), so the cache is shared with **no symlink** (nothing to create on `git worktree add`,
  nothing to commit, no Windows/symlink fragility).
- Files under `.git/` are **never pushed or cloned** (push transfers objects reachable from refs,
  not the contents of `.git/`) — verified. That's exactly the property a throwaway local cache
  wants. Same pattern as git-lfs (`.git/lfs`) and git-annex (`.git/annex`).
- Must resolve via the plumbing command, never hard-code `.git/` (it's a *file* in worktrees,
  elsewhere for submodules/bare).

## Evidence

- **Real, human-readable files** (screenshots → webp, video → compact codec). The **name** is what
  humans read (in the issue and as the uploaded attachment); `sha256` is **optional integrity
  metadata, not the filename**. Content-addressing isn't needed for correctness — commit-anchored
  verification gives worktree stability without it (the existing blob store steps aside, available
  as an optional dedup/`external` backend).
- **`config.evidence.store`**: `auto` (default — local→commit, linked→attach) | `commit` |
  `attach` | `external`. Plus `dir`, `image` (`webp`/`off`), `video` (`webm`/`off`).
- **Verify**:
  - committed (local): the file exists at the **cited commit** — `git cat-file -e <commit>:<path>`,
    checkout-independent. (This is the `gitFileExistsAtCommit` rule already built.)
  - attached/external (linked): the **locator resolves and the digest matches** (a URL alone is
    weak — 200 ≠ the artifact, rot → silent false-green; URL **+ digest** is strong: fetch, hash,
    compare → tamper-evident, rot becomes a loud failure).
- `image` becomes a real, optional path. The backbone of evidence stays **commit + proof**; an
  image is an optional, integrity-pinned attachment, never load-bearing on its own.

## Build phases

1. **Foundation — linked-cache scope fix.** Mode-aware path resolver; relocate linked-mode issue
   cache + sync state to `<git-common-dir>/ztrack/`. Fixes the worktree empty-cache bug for the
   issue markdown. Migration: move an existing `.volter/tracker/markdown/` linked cache on first
   run, else let `sync` repopulate.
2. **Evidence — local/commit path.** Friendly-named committed evidence, `config.evidence`, verify
   at the cited commit (rule built). The common case, fully git-native.
3. **Evidence — linked/attach path.** Per-provider attachment upload (Linear `fileUpload`, Jira
   `/attachments`, GitHub release-asset); staging in the shared cache; verify by locator + digest.

Each phase ships behind the full gate (typecheck, suite, the consumer-path demos) and is verified
in a clean room across the Node matrix before release.
