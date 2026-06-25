# AI Agent Playbook

Use this when you are an AI coding agent adopting ztrack in a repository.

## One-Shot Prompt

From a target repository, a user should be able to run an agent with a prompt
like this:

```bash
claude -p 'Adopt ztrack in this repository. Start by reading https://github.com/volter-ai/ztrack/blob/main/README.md, https://github.com/volter-ai/ztrack/blob/main/docs/GUIDE.md, https://github.com/volter-ai/ztrack/blob/main/docs/AGENT-PLAYBOOK.md, and https://github.com/volter-ai/ztrack/blob/main/docs/PRESETS.md. Choose exactly one install preset: simple-sdlc for a dev lifecycle (the PR-free baseline, the primary choice), simple-gh-sdlc for a GitHub PR-based flow, spec for lightweight issue-shaped specs, or speckit for GitHub Spec Kit style repos. Initialize ztrack, create one demo issue, prove one fake-SHA failure and one real-SHA pass, add the smallest appropriate CI or final-check instructions, and leave a concise adoption note. Do not invent evidence; if a needed commit, PR, screenshot, source, or token does not exist, leave the claim unchecked and report the blocker. Run ztrack check before finishing.'
```

If the target repository cannot access the internet, first install or vendor the
`ztrack` package and provide these local docs to the agent:

- `README.md`
- `docs/GUIDE.md`
- `docs/AGENT-PLAYBOOK.md`
- `docs/PRESETS.md`
- `docs/WORLD-INTEGRATION.md` only if the project needs world/source grounding

## Mission

Make task completion falsifiable. A checked acceptance criterion must have real
evidence. Do not create prose-only done states.

## First Pass

```bash
npx ztrack init --team APP --preset simple-sdlc
npx ztrack issue scaffold --title "Adopt ztrack" > body.md
npx ztrack issue create --title "Adopt ztrack" --label type:case --state ready --assignee agent --body-file body.md
npx ztrack check
```

If the command fails because git is missing, report that environment
blocker. Otherwise continue.

Use `spec` or `speckit` only when the repository already has that workflow shape.
After init, project-specific rules are added by editing the standalone
`.volter/tracker/validation/preset.mts`.

## Prove The Gate

1. Create a real git commit or use the current repository HEAD.
2. Mark one AC passed (`[x]` + `status: passed`) and cite a fake commit in its
   evidence sub-line: `evidence ev1: commit=deadbee acv=1`, plus a
   `proof:` line.
3. Run `npx ztrack check --json`.
4. Confirm the finding code is `evidence_commit_not_found`.
5. Replace `deadbee` with a real commit SHA.
6. Run `npx ztrack check --json` again.
7. Confirm `summary.status` is `pass`.

Do not commit scratch files created only for the proof, such as `body.md`,
`red.json`, or `green.json`, unless the repository intentionally keeps them as
fixtures.

## Working Rules

- Never mark an AC passed unless you can also cite evidence.
- Never invent a commit SHA, PR number, screenshot, video, or source.
- If evidence does not exist, leave the AC pending and explain what is missing.
- Run `ztrack check` before final response.
- Treat `ztrack lint` as guidance and `ztrack check` as the gate.

## Preset Selection

- `simple-sdlc`: first adoption and the primary choice — a PR-free dev lifecycle (the `default` alias)
  (draft→ready→in-progress→in-review→done) with image+commit evidence and proof.
- `spec`: lightweight issue bodies whose ACs cite commit-backed evidence.
- `speckit`: feature records follow GitHub Spec Kit sections (read-only).

Do not invent a new preset name. Pick the nearest starter, then edit the
installed repo-local `preset.mts` when the project has documented rules.

## Final Response Shape

When adoption is complete, report:

- Config path created.
- Preset installed.
- Demo issue id.
- Failing finding code from the fake-SHA proof.
- Passing check result after real evidence.
- CI/MCP/stop-hook integration added or intentionally deferred.
