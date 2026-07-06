# The ztrack plugin

A Claude Code plugin that runs an autonomy **loop** whose completion *oracle* is `ztrack`
— a ralph loop that automatically knows how to prove success. While the loop is armed, no
turn ending in the armed root can end until the issue passes `ztrack check` — the main
agent's turn (`Stop`) or a subagent's (`SubagentStop`); it's an executable gate, not a
phrase match or an LLM judging a transcript. Compose it with the
[`ralph-loop`](https://github.com/anthropics/claude-code) plugin if you like: ralph
re-prompts, the ztrack gate decides *done*.

## Turn it on

```
/plugin marketplace add volter-ai/ztrack
/plugin install ztrack@ztrack
```

Enabling the plugin registers the Stop **and** SubagentStop hooks automatically (no
`settings.json` editing) — see [Subagents](#subagents) for why both. It's **armed**, not
always-on, so it leaves interactive work alone.

## What's in the plugin

- **The gate** (`hooks/`) — the Stop/SubagentStop hook above: enforcement.
- **The `ztrack` skill** (`skills/ztrack/`) — knowledge: teaches the agent the tracker
  workflow (findings → fix commands, the resolution verbs, evidence rules, document-source
  editing and authoring, loop etiquette, and the honest escapes) the moment it encounters a
  tracker or an armed gate. The gate holds a turn; the skill is why the held agent knows
  what to do next instead of reverse-engineering `--help`.

Deliberately **not** bundled: an MCP server config (ztrack has one — `ztrack mcp serve` — but
the CLI-plus-skill path costs no context when idle; add MCP yourself via
`claude mcp add ztrack -- npx ztrack mcp serve` if your host has no shell), and slash
commands (`ztrack loop start` is already the human entry point).

## Use it

```
ztrack loop start ZT-1     # arm: hold the turn until ZT-1 is green
# ...the agent works; each turn-end runs `ztrack check`. red → held (with the findings as
#    the next-step list); green → released + auto-disarmed; iteration cap → stop, surface.
ztrack loop status         # what's armed
ztrack loop stop           # disarm (issue stays open/red; you just stop the loop)
```

- **Armed + red** → the turn is **blocked (exit 2)** and the findings are handed back to the
  agent to resolve.
- **Armed + green** → released, and the loop **disarms itself**.
- **Not armed** → the turn ends normally. Enable the plugin globally and it never bothers you
  outside a loop you started.
- **Iteration cap** (`--max`, default 8) → if it can't go green, the loop stops and surfaces
  what's left, rather than grinding forever.

## Subagents

A subagent's turn ends via `SubagentStop`, not `Stop` — a different hook event, with its own
payload (`agent_id` alongside `session_id`). The plugin registers the identical hook under
both events (`hooks/hooks.json`), so **while a root is armed, no turn ending in that root ends
until the target is green — the main agent's or any subagent's it delegates to.** Delegating
to a subagent is not a way to bypass an armed loop: a subagent that returns "done" while the
target is still red is itself held by `SubagentStop`, exactly like the main agent would be at
`Stop`.

- **The gate is root-scoped, not agent-scoped.** There is no documented way to know, at `ztrack
  loop start` time, which agent is arming the loop or which agents will later act in that root
  — so the marker names a *target*, not an *owner*. Isolation between two unrelated loops comes
  from running them in **separate worktrees** (each worktree has its own gitignored marker
  namespace over the shared tracker — see `ztrack loop start`'s help), not from per-agent
  scoping within one root.
- **Per-actor counters and exemptions.** Within one armed root, the iteration cap and the
  self-exempt escape hatch are keyed to an *actor id* — a subagent's `agent_id` when the
  payload has one, else the (main-agent) `session_id`. A subagent's held turns advance only
  its own iteration counter, never its parent session's (or a sibling subagent's); an
  exemption file one actor creates (`.volter/.ztrack-loop-exempt-<actor id>`) is honored only
  for that exact actor — not for the session that spawned it, and not for a different
  subagent even in the same session. The held/exempt messages the hook prints name the actor
  id, so the exact exemption path is always in the feedback.
- **Where the feedback goes.** Per the Claude Code hook docs, a `SubagentStop` block's stderr
  is fed back to **the subagent itself**, as its next instruction — the same decision
  semantics as `Stop`. A held subagent sees the `ztrack check` findings and keeps working (or
  self-exempts); it is not silently swallowed and it does not surface as a *main*-agent
  message unless the subagent reports it up.
- **Arm-collision refusal.** `ztrack loop start <target>` refuses — nonzero exit, marker
  unchanged — if a *different* target is already armed in this root; re-arming the *same*
  target (a refresh: new `--max`, a runtime sweep, clearing a cap breadcrumb) still succeeds.
  This exists so a main agent can't route around its own armed gate by delegating to a
  subagent that arms a different, easier-to-satisfy target — the second `loop start` simply
  fails instead of silently stealing the gate.
- **`ZTRACK_TRACKER_ROOT`** — set this env var to skip the upward directory walk and pin the
  gate to a specific tracker root explicitly. Useful when a subagent's cwd isn't under the
  tracker (e.g. it works in a scratch directory outside the repo). If the path has no tracker
  at `$ZTRACK_TRACKER_ROOT/.volter/tracker-config.json`, the hook **fails open**: a one-line
  warning to stderr and exit 0 — a typo in the override never traps a turn.

## Escapes

A loop you can't get out of is a trap, so there are three honest ways out — graded by how
durable they are, none of which silently lies about "done":

- **Disarm** — `ztrack loop stop`. Ends the loop for everyone; the issue stays red. The
  blunt instrument.
- **Per-actor self-exempt** — when blocked, the held turn's message prints an exact path
  (`.volter/.ztrack-loop-exempt-<actor id>`, where the actor id is a subagent's `agent_id` or
  the main session's `session_id` — see [Subagents](#subagents)). Create that file and *this*
  actor's turn may end. It's keyed to the live actor id (so a fresh session, or any other
  subagent, is still held) and gitignored (so it can't be committed) — it cannot outlive the
  actor that made it.
- **Durable waiver** — `ztrack waiver sign <issue> --code <finding-code> --reason "…"`. Records
  that the named finding is knowingly accepted; the matching errors become `acknowledged` and
  `check` passes. `sign` pins the waiver to the single offending occurrence when it can (a `ref:`
  field, auto-captured; if the finding has several occurrences it refuses and tells you to pass
  `--ref <subject>` for the one you mean) — so one waiver silences one occurrence,
  `// eslint-disable-next-line` style, and self-expires when that occurrence changes.
  Sign-off is your **git identity** (captured automatically — the same identity that authors
  commits), not a free-text name. Unlike the others this lives in the tracker and survives
  sessions — but it's **anchored to a fingerprint of the acceptance criteria**, so it
  auto-stales the instant those criteria change (the errors come back); an unrelated commit
  elsewhere does *not* invalidate it. An unreasoned waiver is itself an error.
  `ztrack waiver clear <issue>` removes it.

  This is the **last resort**. Before reaching for it, prefer the more honest fix: finish the
  work, fix a false-positive rule, or — when a criterion is over-specified or genuinely out of
  scope — **amend the acceptance criterion itself** through the sanctioned edit path: reword it
  to what is actually in scope, or remove it from the issue body. That is a recorded, in-the-open
  scope decision, and the AC-version re-anchor stales any evidence cited against the old wording —
  the designed freshness behavior, not a loophole. (No shipped preset has a "descoped" AC status;
  narrowing scope is an ordinary AC edit, gated like any other write.)

### A fourth honest escape, specific to document sources

When the tracker is a `format: "document"` source (one hand-authored file, many issues — a
plan or backlog), some writes fail closed **by design**: state, assignee, label,
parent/children, comments, writes to the umbrella issue, delete, and any write to a
`readonly:true` source. That's not the loop being stuck — the fix is exactly what the failing
finding's `path:line` names. **Edit the document directly** at that span and re-run `ztrack
check` (or sign a waiver, if policy forbids direct edits to that file). `ac patch` and
title/body edits don't hit this — they splice into the recorded span through the CLI same as
always.

## Trust boundary — cooperative, not a sandbox

The loop fixes one specific failure of a **well-intentioned** agent: stopping too early /
trusting its own judgement of "done". It replaces "declare victory and halt" with a
deterministic gate. It does **not** *contain* an agent that wants out — by design. An
operator (or any process with a shell in the repo) can `ztrack loop stop`, `ztrack waiver
sign`, create the exempt file, or just edit the tracker markdown; these are operator tools,
not access we try to prevent. Real containment (what an agent may run, read, or write) is
the **harness's** job — its permission and sandbox layer — not ztrack's. What ztrack
guarantees is narrower and honest: while the loop is armed, a turn ends only when the issue
*actually passes `ztrack check`*, and every sanctioned way out is **recorded** (a waiver in
the tracker, a capped breadcrumb in `loop status`) rather than silent.

## Requirements

The repo must have `ztrack` installed as a dependency (`npm i -D ztrack`) and a tracker
(`ztrack init`). The hook runs that **local** ztrack — the same engine the repo-local preset
imports (binary == library) — so "done" only moves on a reviewed lockfile bump. Override the
binary with `ZTRACK_BIN`.

## Try it locally first

Add this repo as a local-path marketplace, no publishing needed:

```
/plugin marketplace add /path/to/volter-ztrack
/plugin install ztrack@ztrack
```

The real end-to-end test (live headless agent + the loop + real ztrack) is
`demos/loop-e2e.sh`.
