# Programmatic API

ztrack is a CLI first, but its core is a library you can import — to run a check from code, read the
validated model, or drive issue CRUD from a script or dashboard.

> Stability: ztrack is **pre-beta**. The package **root** (`import … from 'ztrack'`) is the
> supported surface — it is a hand-curated subset, not a blanket re-export. Other `ztrack/*`
> subpaths are deeper building blocks (documented below) and may change; `ztrack/preset-kit` is the
> one stable deep subpath (see [Preset reference](PRESETS.md)).

## Run a check from code

`checkTracker` validates the live tracker store and returns structured findings — the same pipeline
as `ztrack check`.

```js
import { checkTracker } from 'ztrack';

const result = await checkTracker({ projectRoot: process.cwd() });
// result.ok       → boolean (no error-severity findings)
// result.findings → [{ code, severity, message, issueId?, acId?, ... }]
// result.export   → the validated root ({ issues: [...] }) — this IS the snapshot

if (!result.ok) {
  for (const f of result.findings) console.log(`${f.severity} ${f.code}: ${f.message}`);
  process.exitCode = 1;
}
```

`TrackerCheckOptions`: `{ projectRoot?, config?, issues?, failOnWarning?, categories?, verifyCommits?, now?, phase? }`.
- `issues: ['A-1']` scopes the check; `phase: 'gate'` runs only the continuous-gate rules (skip
  transition/promotion checks); `verifyCommits: false` is the escape hatch for shallow/CI checkouts.

To validate an already-exported root (no disk read), use `checkTrackerRoot(root, options)`.

## Read / write issues

`createTrackerClient` is the programmatic form of the issue CLI.

```js
import { createTrackerClient } from 'ztrack';

const client = createTrackerClient({ projectRoot: process.cwd() });
const list = await client.issue.list({ state: 'open' });
const issue = await client.issue.view('A-1', { json: 'identifier,title,state,body' });
await client.issue.create({ title: 'New case', body: '## Acceptance Criteria\n\n- [ ] dev/01 v1 …' });
```

A runnable example ships at [`demos/sdk-api/run.mjs`](../demos/sdk-api/run.mjs).

## Export and parse

```js
import { exportTrackerRoot } from 'ztrack';                 // validated root, no findings
import { parseRawIssueMarkdown, renderPresetCanonicalIssueMarkdown } from 'ztrack';

const root = await exportTrackerRoot({ projectRoot });
```

## The exports map

The package exposes a deliberately small set of entry points. The root re-exports everything most
callers need; the subpaths exist only where they carry their own weight (the preset-authoring
mechanism, two demoed narrow imports, and the world-integration extension).

| Import | Purpose | Audience |
|---|---|---|
| `ztrack` (root) | **The supported public API**: `checkTracker`, `checkTrackerRoot`, `createTrackerClient`, `exportTrackerRoot`, `serveTrackerApi`, `parseRawIssueMarkdown`/`renderPresetCanonicalIssueMarkdown`, config helpers (`loadTrackerConfig`, `projectRootFrom`, `trackerConfigPath`, …), and types (`TrackerCheckResult`, `Finding`, `CoreRoot`, `Preset`, …) | app / tooling authors |
| `ztrack/preset-kit` | Mechanism to author a **standalone preset** (schema/parse/rules) | preset authors → [PRESETS.md](PRESETS.md) |
| `ztrack/check` | `checkTracker` / `checkFile` directly (also on the root) | tooling |
| `ztrack/sdk` | `createTrackerClient` directly (also on the root) | tooling |
| `ztrack/world-annotations`, `ztrack/world-source-books` | the world-integration extension a world-using preset imports | [WORLD-INTEGRATION.md](WORLD-INTEGRATION.md) |

Prefer the package **root**. Everything else a CLI subcommand needs (mcp, lint, tx, attest, dsse, …)
is an internal module, intentionally **not** a published entry point.

## CommonJS

The package is ESM. From a CommonJS module, use a dynamic import:

```js
const { checkTracker } = await import('ztrack');
```

## GraphQL API server

`serveTrackerApi` (and `ztrack api serve` / `ztrack api query` on the CLI) exposes the tracker over
GraphQL for a dashboard backend. See [Architecture](../ARCHITECTURE.md) for the schema.
