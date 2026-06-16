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
   npm pack --dry-run
   ```

3. Update `package.json` with the new semver version.
4. Update `CHANGELOG.md` with user-facing changes.

## Publish

1. Commit the version and changelog update.
2. Publish the package from that exact commit:

   ```bash
   npm publish
   ```

3. Create the exact version tag on the same commit:

   ```bash
   git tag v0.1.2
   git push origin v0.1.2
   ```

4. Move the major action tag only after the exact version tag exists:

   ```bash
   git tag -f v0 v0.1.2
   git push origin v0 --force
   ```

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
