# Preset Reference

A ztrack preset is the repo-local rulebook for what "done" means. `ztrack init`
always installs one editable runtime at:

```text
.volter/tracker/validation/preset.cjs
```

After installation, that file belongs to the target repository. Teams should
edit it as their workflow becomes more specific.

## Install Presets

| Preset | Use When | What It Enforces |
|---|---|---|
| `basic` | Unknown or early-stage repos | checked ACs need commit + evidence refs; non-canceled cases need an assignee |
| `simple-sdlc` | A small software lifecycle | `basic` plus source markers, at least one AC on active cases, and all ACs passed before done |
| `simple-spec` | Repos that write issue-shaped specs | `simple-sdlc` evidence style plus required `## Requirements` and `## Acceptance Criteria` sections |
| `speckit` | Repos following GitHub Spec Kit conventions | `simple-sdlc` evidence style plus required `## User Stories`, `## Functional Requirements`, and `## Tasks` sections |

Install one with:

```bash
npx ztrack init --team APP --preset basic
npx ztrack init --team APP --preset simple-sdlc
npx ztrack init --team APP --preset simple-spec
npx ztrack init --team APP --preset speckit
```

Omitting `--preset` uses `basic`.

## Which Preset To Start With

Use `basic` if you are adopting ztrack into an existing repo and do not yet have
written workflow rules. It proves the core value quickly: checked work must cite
real evidence.

Use `simple-sdlc` if the repo already treats tickets as lifecycle records and
you want ztrack to block unsourced or AC-less active work.

Use `simple-spec` if issues are the spec surface and should always carry
requirements plus acceptance criteria.

Use `speckit` if the project already uses, or is adopting, GitHub Spec Kit style
feature records.

## Installed Runtime Contract

The installed file is plain CommonJS so a fresh repo can edit it without a build
step. It exports a runtime object:

```js
module.exports = {
  name: "basic",
  scaffoldIssueBody(title) {
    return `# ${title}\n\n## Acceptance Criteria\n\n- [ ] dev/01 status: pending Describe the work.\n\n## Evidence\n`;
  },
  parseIssueMarkdown(body) {
    return { preset: "basic", acceptanceCriteria: [], evidence: [], proofs: [] };
  },
  markdownDiagnostics() {
    return [];
  },
  snapshot: {
    exportSnapshot(options) {
      throw new Error("exportSnapshot must load your tracker store");
    },
    checkSnapshot(snapshot, options) {
      return { valid: true, summary: { cases: 0, openCases: 0, errors: 0, warnings: 0, status: "pass" }, findings: [] };
    }
  }
};
```

The generated starter already includes a local-store exporter and common
commit/evidence checks. Most teams should edit that file instead of creating a
new package.

## Evidence Grammar

Installed presets recognize checkbox acceptance criteria:

```markdown
- [ ] dev/01 status: pending Implement the behavior. [1]
- [x] dev/02 status: passed Wire the API. commit: abc1234 [E1]
```

And evidence rows:

```markdown
[E1] type: pr ac: dev/02 repo: owner/repo number: 12 head: abc1234 justification: Shows the implementation.
```

Common checks:

- Non-canceled cases need an assignee.
- Checked or `status: passed` ACs need a commit hash.
- In a git repo, cited commits must exist.
- Checked ACs need evidence refs.
- Evidence refs must point to `[E...]` rows.

## Evolving The Preset

There is no separate public `custom` preset. Customization is the normal state:
install the closest starter, then edit `.volter/tracker/validation/preset.cjs`.

Before adding rules, write down:

- What work item types count as cases.
- What states exist and which transitions should fail.
- What AC families exist.
- What evidence each AC family needs.
- Which external systems are sources.
- Which finding codes agents should learn to fix.

Keep hard, deterministic checks in `ztrack check`. Put subjective guidance in
`ztrack lint` or documentation.
