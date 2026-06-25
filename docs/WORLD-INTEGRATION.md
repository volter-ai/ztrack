# World Integration

ztrack can be extended to validate evidence against a mirrored "world" of
external systems such as GitHub, Jira, Slack, or Linear.

The world/event runtime is **`@volter-ai-dev/twin`** — a regular dependency of
ztrack (it is also the substrate behind `ztrack sync github`), bundled into the
CLI and installed with the package. There is nothing extra to install. What's
opt-in is the *policy*: a baseline tracker never consults the world. You wire
world-backed checks into your installed preset only when your validation needs
claims to trace back to external conversations, tickets, reviews, or other
mirrored vendor events.

Day-one ztrack usage touches none of it:

```bash
npx ztrack init
npx ztrack issue scaffold --title "First verified task" > body.md
npx ztrack issue create --title "First verified task" --label type:case --body-file body.md
npx ztrack check
```

## Package boundary

- `@volter-ai-dev/twin` (+ `@volter-ai-dev/twin-github`): the external event log,
  world config, and service-event APIs — and the engine behind `ztrack sync
  github`. A regular dependency on the public npm registry, so it's always present.
- `ztrack`: issue validation and the installed-preset boundary where world source
  rows can be consumed.

## Using it from a preset

A preset that grounds claims in the world imports the adapters from ztrack's
published world subpaths in its `loadContext`:

```ts
import { loadWorldSourceBooks } from 'ztrack/world-source-books';
// or the annotation adapter:
import { listAnnotations, isAnnotationExemptEvent } from 'ztrack/world-annotations';
```

These resolve against the installed `@volter-ai-dev/twin` — no extra install or
registry configuration. A baseline preset that imports neither stays world-free.
