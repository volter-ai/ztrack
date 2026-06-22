# ztrack-gate

A Claude Code plugin that runs an autonomy **loop** whose completion *oracle* is `ztrack`
— a ralph loop that automatically knows how to prove success. While the loop is armed, the
agent's turn can't end until the issue passes `ztrack check`; it's an executable gate, not a
phrase match or an LLM judging a transcript. Compose it with the
[`ralph-loop`](https://github.com/anthropics/claude-code) plugin if you like: ralph
re-prompts, ztrack-gate decides *done*.

## Turn it on

```
/plugin marketplace add volter-ai/ztrack
/plugin install ztrack-gate@ztrack
```

Enabling the plugin registers the Stop hook automatically (no `settings.json` editing). It's
**armed**, not always-on, so it leaves interactive work alone.

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

## Escapes

A loop you can't get out of is a trap, so there are three honest ways out — graded by how
durable they are, none of which silently lies about "done":

- **Disarm** — `ztrack loop stop`. Ends the loop for everyone; the issue stays red. The
  blunt instrument.
- **Per-session self-exempt** — when blocked, the held turn's message prints an exact path
  (`.volter/.ztrack-loop-exempt-<session_id>`). Create that file and *this* session's turn
  may end. It's keyed to the live session id (so a fresh session is held again) and
  gitignored (so it can't be committed) — it cannot outlive the session that made it.
- **Durable waiver** — `ztrack waiver sign <issue> --reason "…"`. Records that the failing
  state is knowingly accepted; the issue's errors become `acknowledged` and `check` passes.
  Sign-off is your **git identity** (captured automatically — the same identity that authors
  commits), not a free-text name. Unlike the others this lives in the tracker and survives
  sessions — but it's **anchored to a fingerprint of the acceptance criteria**, so it
  auto-stales the instant those criteria change (the errors come back); an unrelated commit
  elsewhere does *not* invalidate it. An unreasoned waiver is itself an error.
  `ztrack waiver clear <issue>` removes it.

  This is the **last resort**. Before reaching for it, prefer the more honest fix: finish the
  work, correct an over-specified AC, fix a false-positive rule, or — when a criterion is
  genuinely out of scope — **descope the AC** (`- [ ] AC-03 status: descoped reason: …`),
  which is a recorded, in-the-open scope decision rather than an acknowledged failure.
  (Descope counts toward "done" only on presets that gate done-ness — `simple-sdlc` and
  other SDLC-gated presets; the default `basic` preset doesn't gate done-ness, so there the
  waiver is the durable escape.)

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
/plugin install ztrack-gate@ztrack
```

The real end-to-end test (live headless agent + the loop + real ztrack) is
`demos/loop-e2e.sh`.
