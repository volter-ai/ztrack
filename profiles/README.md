# ztrack Profiles

Profiles are operating kits for agent-run projects after ztrack is installed.
They are not install presets. Install presets create validation; profiles run
PM/develop/review cycles around that validation.

Available profiles:

- `simple-sdlc/`: scheduler config, scheduled scripts, and skills for PM, draft,
  develop, and review agents using the `simple-sdlc` install preset.

Use the setup script when adopting a repo:

```bash
npx -p ztrack ztrack-setup --repo /path/to/repo --team APP --preset simple-sdlc --profile simple-sdlc
```

For a new demo repo:

```bash
npx -p ztrack ztrack-setup --new /tmp/demo --team DEMO --seed-demo-issues
```
