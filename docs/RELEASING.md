# Releasing

ztrack has two public distribution surfaces:

- the npm package, installed with `npx ztrack`
- the GitHub Action, used as `volter-ai/ztrack@v0`

Keep package versions, git tags, and action tags aligned. A release is not complete
until all three surfaces point at the intended code.

## Before releasing

1. Confirm `main` is green in CI.
2. Run the local checks:

   ```bash
   bun install --frozen-lockfile
   bun run typecheck
   bun test
   bash demos/real-project-cycle.sh
   bash demos/full-dev-cycle.sh
   npm pack --dry-run
   ```

3. Update `package.json` with the new semver version.
4. Update `CHANGELOG.md` with user-facing changes.

## Publish

Publishing is automated. Pushing an exact version tag (`vX.Y.Z`) triggers the
`Publish` workflow (`.github/workflows/publish.yml`), which verifies the tag
matches `package.json`, runs typecheck + tests, then `npm publish` with
provenance using the repo secret `NPM_TOKEN`. **No local npm token is needed** —
do not run `npm publish` by hand.

1. Commit the version and changelog update, and push `main`.
2. Create and push the exact version tag on that commit — this publishes:

   ```bash
   git tag v0.1.2
   git push origin v0.1.2
   ```

3. Watch it: `gh run watch` (or the Actions tab). On success the version is live on npm.
4. Move the major action tag only after the exact version tag exists:

   ```bash
   git tag -f v0 v0.1.2
   git push origin v0 --force
   ```

## Credentials (one-time / rotation)

The `Publish` workflow authenticates with the repo secret `NPM_TOKEN`
(Settings → Secrets and variables → Actions). It must be an npm token with
publish access and 2FA bypass (Granular or Automation token). Rotate it on
npmjs.com → Access Tokens before it expires and update the secret:

```bash
gh secret set NPM_TOKEN --repo volter-ai/ztrack   # paste the new token when prompted
```

Prefer a Granular token scoped to just the `ztrack` package over a broad
account-wide token.

## Rules

- Never move an exact version tag such as `v0.1.2` after publishing.
- Never tag code that differs from the npm package with the same version.
- Move `v0` only to a release commit that has already been published and exact-tagged.
- If a publish fails after the commit lands, release a new patch version instead of
  reusing a version number.

## Public launch check

Before making the repository public, verify:

- the README CI badge resolves
- `npx ztrack --help` runs from a clean shell
- `volter-ai/ztrack@v0` resolves in a throwaway GitHub Actions workflow
- GitHub Security Advisories are enabled
- Dependabot is quiet except for expected patch/minor updates
