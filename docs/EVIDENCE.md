# Evidence and attestation

ztrack's core promise is that work marked done is backed by **real, verifiable proof**. This page
covers how evidence is cited, stored, and verified — and the optional cryptographic attestation.

The `simple-sdlc` preset (installed by default) is used throughout. Evidence is a property of an **acceptance criterion (AC)**.

## The model: commit + proof (image optional)

Every passed AC must cite at least one **evidence** row and a **proof** that explains how that
evidence demonstrates the AC. The backbone of an evidence row is a **git commit** — verified to
exist (and, by default, that it isn't fabricated). An **image/artifact is optional**; when you cite
one, it is verified too.

```markdown
- [x] AC-1 v1 Members can filter appointments by status
  - status: passed
  - evidence ev1: commit=<sha> acv=1
  - proof: "the cited commit adds the status filter and its test" -> ev1
```

With an image:

```markdown
  - evidence ev1: image=shots/status-filter.png commit=<sha> acv=1
  - proof: "the screenshot shows the applied status filter" -> ev1
```

### Evidence-line syntax

```
- evidence <id>: [image=<path-or-url>] [sha256=<digest>] commit=<sha> acv=<n>
```

- `commit` and `acv` (the AC version the evidence was captured against) are **required**.
- `image` and `sha256` are **optional**.
- **Fields may be written in any order** (since 0.26.1). `commit=<sha> acv=1 image=<file>` and
  `image=<file> commit=<sha> acv=1` parse identically — a cited image is always captured and
  therefore always verified. (`ztrack fmt` rewrites a row to the canonical `image … sha256 … commit
  … acv` order.)

## What the gate verifies (`ztrack check`, offline)

| Check | Finding when it fails |
|---|---|
| The cited `commit` exists in git | `evidence_commit_not_found` |
| A cited **file** `image=<path>` exists in the tree **at that commit** (`git cat-file -e <sha>:<path>`) | `evidence_file_not_found` |
| The `acv` matches the AC's current version | `evidence_ac_version_stale` |
| A passed AC has evidence and a proof | `passed_ac_missing_evidence`, `passed_ac_missing_proof` |

So a **fabricated screenshot path fails** the gate — the path must be a real file committed at the
cited commit. `check` stays fully offline and deterministic; it never fetches a URL (see Verify).

## Storing evidence

`ztrack evidence add` ingests a file and prints what to cite. Two storage modes:

### Commit mode (default) — the file travels with your code

```bash
ztrack evidence add shots/status-filter.png
# → { "path": ".volter/evidence/status-filter.png", "sha256": "sha256:…" }
# cite image=.volter/evidence/status-filter.png, then COMMIT the file
```

The file is copied (friendly-named) into the evidence dir (default `.volter/evidence/`, set via
`config.evidence.dir`). Commit it; the gate then resolves it at the cited commit. Works in both
local and linked trackers, offline-verifiable. This is the strongest model and the default.

### Attach mode — upload to the linked GitHub repo

```bash
ztrack evidence add shots/status-filter.png --attach
# → { "image": "https://github.com/<repo>/releases/download/ztrack-evidence/…", "sha256": "sha256:…" }
# cite image=<url> sha256=<digest>
```

The file is uploaded as an asset on the linked repo's `ztrack-evidence` release. You cite the URL
**pinned by `sha256=`**. `check` accepts it **offline** — the digest is a tamper-evident
commitment, so the gate makes no network call. Requires a linked repo (`ztrack init --sync github
--repo o/n`) and `gh`/`GITHUB_TOKEN` auth.

### Choosing the mode

`config.evidence.store` selects it: `commit` (default), `attach`, `external`, or `auto` (resolves
to `commit`). A single call can override with `--attach` or `--commit`.

```jsonc
// .volter/tracker-config.json
{ "evidence": { "store": "commit", "dir": ".volter/evidence" } }
```

> Most evidence should be **text** (test output, a command transcript committed as a file), not
> images. Images are supported and verified, but a committed text artifact is the cheapest proof.

## Verifying attached (URL) evidence

The gate skips the network on purpose. To actually fetch URL-pinned evidence and confirm its bytes
still match the pinned digest — e.g. in CI, or to catch a swapped/rotted asset — run:

```bash
ztrack evidence verify              # every URL-pinned row across the tracker
ztrack evidence verify --issues A-1,A-2
```

It fetches each cited URL (gh-auth for private repos), compares `sha256`, and exits non-zero on any
mismatch. Committed (path) evidence needs no network step — `ztrack check` already verified it at
its commit.

## Attestation (in-toto + DSSE signing)

Optional, for teams that want a signed, portable record of what was verified.

```bash
# 1. one-time: generate an ed25519 signing keypair (default .volter/keys/)
ztrack evidence keygen
# → { "keyid": "…", "privateKey": ".volter/keys/evidence-signing.pem",
#      "publicKey": ".volter/keys/evidence-signing.pub.pem" }

# 2. export in-toto Statements for the tracker (unsigned)
ztrack evidence export --format in-toto --out attestations.json
ztrack evidence export --format in-toto --issues A-1   # scope to issues

# 3. or SIGN each statement into a DSSE envelope
ztrack evidence export --format in-toto --sign-key .volter/keys/evidence-signing.pem --out envelopes.json

# 4. verify the signed bundle against the public key
ztrack evidence verify --bundle envelopes.json --key .volter/keys/evidence-signing.pub.pem
```

- `export` emits in-toto `Statement` objects (`https://in-toto.io/Statement/v1`) with
  `predicateType https://volter.ai/attestation/evidence/v1`; the subject is the git commit.
- `--sign-key <private.pem>` wraps each statement in a **DSSE envelope** (signed). Signing requires
  the key — a bare `--sign` is rejected with a hint (it would otherwise emit an *unsigned*
  statement that falsely looks attested).
- `verify --bundle … --key <public.pem>` checks the envelope signatures.

## See also

- [Preset reference](PRESETS.md) — the exact evidence rules per preset.
- [Storage scope design](DESIGN-storage-scope-and-evidence.md) — why verification is
  commit/locator-anchored rather than working-tree-anchored.
