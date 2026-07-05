# AI Agent Playbook

Two jobs an agent does with ztrack: **drive** work under it (the daily development loop), and
**adopt** it into a repo (one-time setup). Both are below — start with whichever you were asked to do.

Route by situation before anything else. Adopting where the team already tracks work in **GitHub
Issues** → init linked (`ztrack init --sync github --repo o/n`; the issues pull in). Adopting onto
**a pile of tasks and no tracker** → init local, then `ztrack import` the written-down backlog
(both are step 1 of [Running a whole backlog](#running-a-whole-backlog-not-just-one-issue)).
Driving **one issue** → the loop right below. Driving a **whole backlog** as an
orchestrator/PM agent dispatching subagents → [Running a whole
backlog](#running-a-whole-backlog-not-just-one-issue).

## Driving work under ztrack (the main loop)

The recommended flow: a user arms a loop with `ztrack loop start <issue>` and runs you on that issue.
While the loop is armed, a Stop/SubagentStop hook holds your turn — and any subagent's you delegate
to — and re-runs `ztrack check` — so **you cannot end your turn (or hand off to a subagent that
ends its turn) on a fabricated "done."** When it's red, keep working until it's genuinely green (the
loop then disarms), or take an honest escape. Your job:

Two things a loop can be armed to do — check which one you were given:
- **Bare** `ztrack loop start <issue>` — validate the issue's CURRENT stage. It disarms as soon as
  `check` is green at whatever status the issue already has; it says nothing about whether that
  status is far enough along.
- `ztrack loop start <issue> --until <stage>` — drive the issue's status all the way to `<stage>`
  (e.g. `ready`, `done`). The turn is held until the issue's status has genuinely reached `<stage>`
  AND `check` is green there. **Do not flip the status to `<stage>` early to end the turn** — the
  stage's own lifecycle gates (e.g. every AC passed before `in-review`) still fire for real, so an
  early `--state done` before the ACs are actually passed just trades one held reason for another.
  Reach the stage by doing the work: pass every AC with real evidence, THEN move the status.
  You may also be run under `--until ready` while WRITING an issue — that's a loop for drafting: it
  holds until the order has real dev ACs and passes `ready`'s own gates, not until any code exists.

- Do the work, then cite **real** evidence on each passed AC: a commit SHA that **exists** in git,
  plus a `proof:` line that names what it shows (and a committed image if the AC requires one).
- **Never** mark an AC passed without evidence you can cite. **Never** invent a commit SHA, PR number,
  screenshot, video, or source to make the gate go green.
- If a claim genuinely cannot be satisfied, take an **honest escape** — never fake it to end the turn:
  leave the AC pending and report the blocker; amend the over-specified AC itself (reword or remove
  it through the sanctioned edit path — a recorded scope decision, and the AC-version re-anchor
  stales evidence cited against the old wording); or, for a finding an authority knowingly accepts,
  `ztrack waiver sign <issue> --code <finding-code>` it. (Per-actor self-exempt and `ztrack loop
  stop` also exist; none of them fabricate "done.")
- Mirror this even without a loop: with MCP, call `tracker_check` before finishing; with no hooks at
  all, run `ztrack check` as your last step and treat a non-zero exit as incomplete work.
- Treat `ztrack lint` as guidance and `ztrack check` as the gate.

The target grammar is the same everywhere: an issue id, a `./body.md` file, or — inside a worktree
named for an issue — that issue automatically.

### Running a whole backlog, not just one issue

Everything above is written as if you're driving one issue. That's the short-running special case of
a bigger job you may be given instead: **one long-lived orchestrator session** taking a whole backlog
— write it down once, then drive it to done — without a human re-pointing you at the next issue by
hand. Four moves, in order (full detail, with commands, in
[Guide → Orchestrating a whole backlog](GUIDE.md#orchestrating-a-whole-backlog-one-long-lived-session-many-issues)):

1. **Intake.** Get the backlog into the tracker: `ztrack import <file-or-folder>` for a freeform plan
   or a folder of issue-shaped `.md` files, or `ztrack init --sync github --repo o/n` to pull from
   GitHub Issues instead. Don't hand-write issue markdown when one of these fits.
2. **Groom.** For every issue that's still a stub, run a drafting loop —
   `ztrack loop start <id> --until ready` — until it has real acceptance criteria and passes `ready`'s
   own gates. Evidence is a `done`-gate concern; grooming only needs the claim to be checkable, not
   proven yet.
3. **Order.** Encode what actually blocks what — `Blocked by:` / `Blocks:` lines on an issue, or a
   per-AC `blocked-by:` when the dependency is narrower than the whole other issue. `ztrack check`
   proves it's a genuine DAG (cycles, dangling refs, and one-sided relations all fail closed or warn).
4. **Dispatch.** Query the frontier — `ztrack issue list --actionable --json identifier,title,state` —
   and, for each row, arm a loop (`ztrack loop start <id> --until done`) and run one subagent per
   issue, **each in its own worktree** (so concurrent subagents never share a loop marker or files).
   Merge each back **sequentially**, running `ztrack check` after every merge. Then re-query
   `--actionable` — the wave that just landed unblocks the next one — and dispatch again. Repeat until
   the query returns nothing. `ztrack issue list --blocked --json identifier,title,blockers` is the
   diagnostic when a wave stalls: it names the nearest unmet blocker per stuck issue (not the whole
   transitive pile behind it), so you know exactly what to go unblock next.

The single-issue loop above is this same lifecycle degenerated to a backlog of one: intake and
grooming already done by hand, nothing to order, one dispatch, one wave.

### Two source models: issue-per-file vs. document

A tracker declares its `sources:` in `.volter/tracker-config.json`. Most repos use the default,
**issue-per-file** (one `.md` per issue): mutate only through the verbs (`ac patch`, `issue patch`,
`issue edit`) — never hand-edit the stored markdown.

Some repos instead declare a **document** source: one hand-authored file (a plan, a backlog) where
id-bearing headings (`## APP-1 — Title`) are issues, nesting is parenthood, and each item carries its
own `status:`/`assignee:` header lines and an Acceptance Criteria subsection. You can recognize one
because a `ztrack check` finding cites a path like `PLAN.md:42` instead of an issue-per-file path, or
the config says `format:"document"`. The document itself is the source of truth, authored directly by
humans and agents.

With 2+ declared sources, `issue list --source <name>` and `check --source <name>` scope a listing
or a validation run to one source ([Sources → scoping](SOURCES.md#scoping-to-one-source---source));
the `--actionable/--blocked` frontier stays whole-graph and refuses `--source`.

For a document source, `ac patch` and title/body edits (`issue edit --title`/`--body`) still work
on **leaf items at any nesting depth** — they splice the change back into the issue's recorded line
span, leaving every other byte untouched. (An item with an id-bearing child still fails closed —
its recorded span doesn't map cleanly onto just its own bytes.)
Everything else **fails closed** by design: state, assignee, label, parent/children, comments, any
write to the umbrella issue (the file's preamble `Title:`/`Status:`/`Assignee:` block), delete, and
any write to a `readonly:true` source all raise an error naming the file. When you hit one of these,
**edit the document directly at the cited line, then re-run `ztrack check`** — that's the sanctioned
path, not a workaround.

## Adopting ztrack into a repo (one-time)

From a target repository, a user should be able to run an agent with a prompt like this:

```bash
claude -p 'Adopt ztrack in this repository. Start by reading https://github.com/volter-ai/ztrack/blob/main/README.md, https://github.com/volter-ai/ztrack/blob/main/docs/GUIDE.md, https://github.com/volter-ai/ztrack/blob/main/docs/AGENT-PLAYBOOK.md, and https://github.com/volter-ai/ztrack/blob/main/docs/PRESETS.md. Choose exactly one install preset: simple-sdlc for a dev lifecycle (the PR-free baseline, the primary choice), simple-gh-sdlc for a GitHub PR-based flow, spec for lightweight issue-shaped specs, or speckit for GitHub Spec Kit style repos. Initialize ztrack, create one demo issue, prove one fake-SHA failure and one real-SHA pass, add the smallest appropriate CI or final-check instructions, and leave a concise adoption note. Do not invent evidence; if a needed commit, PR, screenshot, source, or token does not exist, leave the claim unchecked and report the blocker. Run ztrack check before finishing.'
```

If the target repository cannot access the internet, first install or vendor the `ztrack` package and
provide these local docs to the agent:

- `README.md`
- `docs/GUIDE.md`
- `docs/AGENT-PLAYBOOK.md`
- `docs/PRESETS.md`
- `docs/EVIDENCE.md` only if the project needs world/source grounding

### Mission

Make task completion falsifiable. A checked acceptance criterion must have real evidence. Do not
create prose-only done states.

### First pass

```bash
npx ztrack init --team APP --preset simple-sdlc
npx ztrack issue scaffold --title "Adopt ztrack" > body.md
npx ztrack issue create --title "Adopt ztrack" --label type:case --state ready --assignee agent --body-file body.md
npx ztrack check
```

(`--state`/`--assignee` are shown explicit above for the demo issue; they're not required — a bare
`issue create` mints preset-conforming defaults: `state: draft`, `assignee:` your git `user.name`.)

If the command fails because git is missing, report that environment blocker. Otherwise continue.
Use `spec` or `speckit` only when the repository already has that workflow shape. After init,
project-specific rules are added by editing the standalone `.volter/tracker/validation/preset.mts`.

### Prove the gate

1. Create a real git commit or use the current repository HEAD.
2. Mark one AC passed (`[x]` + `status: passed`) and cite a fake commit in its evidence sub-line:
   `evidence ev1: commit=deadbee acv=1`, plus a `proof:` line. Write it onto the STORED issue —
   author the body in a local `body.md`, then `npx ztrack issue edit <id> --body-file body.md`
   (the issue is stored independently, so editing your local file alone changes nothing).
3. Run `npx ztrack check --json`.
4. Confirm the finding code is `evidence_commit_not_found`.
5. Replace `deadbee` with a real commit SHA.
6. Run `npx ztrack check --json` again.
7. Confirm `summary.status` is `pass`.

Do not commit scratch files created only for the proof, such as `body.md`, `red.json`, or
`green.json`, unless the repository intentionally keeps them as fixtures.

### Preset selection

- `simple-sdlc`: first adoption and the primary choice — a PR-free dev lifecycle (the `default` alias)
  (draft→ready→in-progress→in-review→done) with image+commit evidence and proof.
- `simple-gh-sdlc`: the same, plus a GitHub PR at in-review and a merged PR for done.
- `spec`: lightweight issue bodies whose ACs cite commit-backed evidence.
- `speckit`: feature records follow GitHub Spec Kit sections (read-only).

Do not invent a new preset name. Pick the nearest starter, then edit the installed repo-local
`preset.mts` when the project has documented rules.

### Final response shape

When adoption is complete, report: config path created; preset installed; demo issue id; failing
finding code from the fake-SHA proof; passing check result after real evidence; CI/MCP/stop-hook
integration added or intentionally deferred.
