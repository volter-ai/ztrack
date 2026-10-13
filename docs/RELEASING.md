# Releasing

ztrack has two public distribution surfaces:

- the npm package, installed with `npx @volter/ztrack`
- the GitHub Action, used as `volter-ai/ztrack@v2`

Keep package versions, git tags, and action tags aligned. A release is not complete
until all three surfaces point at the intended code.

## Publish

Every push to `main` publishes (`.github/workflows/publish.yml`). When anything ztrack ships
changed since its last release, the workflow moves `package.json` to the next patch version,
builds and publishes with provenance, commits the release back to `main`, tags `vX.Y.Z`, moves the
major Action tag (`v2`) to it, and creates the GitHub release with notes generated from history. A push that changes nothing
shipped (a workflow edit, say) publishes nothing.

There is no changelog (company RFC 0025 decision 5): a change's commit message says what it does
for its users. A minor or major version is set by hand in `package.json` in the change that needs
it; the workflow publishes that version as it stands.

## Credentials (one-time / rotation)

The workflow authenticates with the repo secret `NPM_TOKEN`, the npm publish token the
other Volter package repositories share; it is re-set in every repository when it rotates.

## Rules

- Never move an exact version tag such as `v0.1.2` after publishing.
- Never tag code that differs from the npm package with the same version.
- Move the current major tag (`v2`) only to a release commit that has already been published
  and exact-tagged; never move a retired major's tag (`v0`, `v1`).
- If a publish fails after the commit lands, the next push releases a new patch version; a
  version number is never reused.

## Public launch check

Before making the repository public, verify:

- the README publish badge resolves
- `npx @volter/ztrack --help` runs from a clean shell
- `volter-ai/ztrack@v2` resolves in a throwaway GitHub Actions workflow
- GitHub Security Advisories are enabled
- Dependabot is quiet except for expected patch/minor updates
