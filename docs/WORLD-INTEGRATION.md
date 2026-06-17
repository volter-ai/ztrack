# World Integration

ztrack can be extended to validate evidence against a mirrored "world" of
external systems such as GitHub, Jira, Slack, or Linear.

The world/event runtime is intentionally separate. The ztrack source tree keeps
adapter code for `@volter/twin`, but those adapters are not part of the default
npm runtime surface. Day-one CLI, SDK, MCP, and installed presets do not require
or import `@volter/twin`.

Day-one ztrack usage does not require `@volter/twin`:

```bash
npx ztrack init
npx ztrack issue scaffold --title "First verified task" > body.md
npx ztrack issue create --title "First verified task" --label type:case --body-file body.md
npx ztrack check
```

Use world integration only when your validation policy needs claims to trace back
to external conversations, tickets, reviews, or other mirrored vendor events, and
expect to wire that policy in your installed preset.

## Package Boundary

- `@volter/twin`: external event log, world config, service event APIs.
- `ztrack`: issue validation and the installed preset boundary where source rows
  can be consumed.

The peer is intentionally absent from baseline adoption so the ztrack CLI, SDK,
MCP server, and installed presets work without installing any world packages.

## Installing the Optional Peer

`@volter/twin` is distributed through GitHub Packages under `volter-ai`, not the
public npm registry. The package name is scoped as `@volter/twin`; configure
that scope to use GitHub's npm registry before installing it:

```ini
@volter:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install the peer in projects that explicitly build world-backed validation:

```bash
npm install @volter/twin
```

If `npm view @volter/twin --registry=https://npm.pkg.github.com` returns `403`,
the package is present but the token/account does not have access to the
`volter-ai` GitHub Packages package.
