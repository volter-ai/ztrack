# AI Agent Playbook

Two jobs an agent does with ztrack: **drive** work under it (the daily development loop), and
**adopt** it into a repo (one-time setup). Both are below — start with whichever you were asked to do.

## Driving work under ztrack (the main loop)

The recommended flow: a user arms a loop with `ztrack loop start <issue>` and runs you on that issue.
While the loop is armed, a Stop hook holds your turn and re-runs `ztrack check` — so **you cannot end
your turn on a fabricated "done."** When it's red, keep working until it's genuinely green (the loop
then disarms), or take an honest escape. Your job:

- Do the work, then cite **real** evidence on each passed AC: a commit SHA that **exists** in git,
  plus a `proof:` line that names what it shows (and a committed image if the AC requires one).
- **Never** mark an AC passed without evidence you can cite. **Never** invent a commit SHA, PR number,
  screenshot, video, or source to make the gate go green.
- If a claim genuinely cannot be satisfied, take an **honest escape** — never fake it to end the turn:
  leave the AC pending and report the blocker; descope the AC; or, for a finding an authority
  knowingly accepts, `ztrack waiver sign` it. (Per-session self-exempt and `ztrack loop stop` also
  exist; none of them fabricate "done.")
- Mirror this even without a loop: with MCP, call `tracker_check` before finishing; with no hooks at
  all, run `ztrack check` as your last step and treat a non-zero exit as incomplete work.
- Treat `ztrack lint` as guidance and `ztrack check` as the gate.

The target grammar is the same everywhere: an issue id, a `./body.md` file, or — inside a worktree
named for an issue — that issue automatically.

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

For a document source, `ac patch` and title/body edits (`issue edit --title`/`--body`) still work
on **top-level leaf items** — they splice the change back into the issue's recorded line span,
leaving every other byte untouched. (An item with an id-bearing child, or one nested inside another
item's section, currently fails closed too.)
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
   `evidence ev1: commit=deadbee acv=1`, plus a `proof:` line.
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
