# ztrack-gate

A Claude Code plugin that turns `ztrack`'s deterministic done-oracle into a **Stop hook**:
the agent's turn can't end while the active issue's `ztrack check --auto-scope` is red. It's
the "keep going until the work is *actually* done" mechanism — an executable gate, not a
phrase match or an LLM judging a transcript. Compose it with the
[`ralph-loop`](https://github.com/anthropics/claude-code) plugin: ralph re-prompts (the
loop), ztrack-gate decides *done* (the oracle).

## Turn it on

```
/plugin marketplace add volter-ai/ztrack
/plugin install ztrack-gate@ztrack
```

That's it — enabling the plugin registers the Stop hook automatically (no `settings.json`
editing). Enable it globally and forget about it: it's **self-gating**.

## Self-gating

On every turn-end the hook looks for a ztrack tracker (`.volter/tracker-config.json`) in the
current repo or an ancestor:

- **No tracker** → it exits 0 and lets the turn end. Safe to enable for *all* your repos —
  it never bothers you in ones that don't use ztrack.
- **Tracker present** → it runs that repo's installed `ztrack check --auto-scope` and
  **blocks the turn (exit 2)** if the issue this branch/worktree is for is red, handing the
  agent the findings to fix. Green → the turn ends.

## Requirements

The repo being gated must have `ztrack` installed as a dependency (`npm i -D ztrack`) and a
tracker (`ztrack init`). The hook runs that **local** ztrack — the same engine the repo-local
preset imports (binary == library) — so "done" only moves on a reviewed lockfile bump.
Override the binary path with `ZTRACK_BIN`.

## Try it locally first

From a checkout of this repo you can add it as a local-path marketplace without publishing:

```
/plugin marketplace add /path/to/volter-ztrack
/plugin install ztrack-gate@ztrack
```
