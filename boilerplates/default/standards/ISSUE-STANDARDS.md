# Issue Standards — `default` profile

These are the rules `draft` follows when writing an issue (and `review` when
re-checking one). The machine-checkable subset is enforced by the `default`
preset's validator; this document covers that subset **and** the judgment the
validator cannot make.

## The body template

Every issue body is exactly this markdown. The parser reads only these
designated positions — nothing is mined from free prose.

```
# <ISSUE-ID>: <Title>

Assignee: <name>
Summary: <one line of user-facing outcome>
Status: <draft | ready | in-progress | in-review | done>
PR: <branch>                    # omit until a PR exists
Labels: <a, b>                  # optional primitive
Children: <ID, ID>              # optional primitive
Blocks: <ID> / Blocked by: <ID> / Relates: <ID>   # optional relations primitive
Linked: <system> <key> <url>    # optional linked-issue primitive

## Acceptance Criteria

- [ ] <AC-ID> v<N> <testable statement>
  - status: <pending | passed | failed>
  - evidence <EV-ID>: image=<path> commit=<7–40 hex> acv=<N>
  - proof: "<how that evidence demonstrates this AC>" -> <EV-ID>
```

> **You never hand-edit this file.** State changes go through the **mutation
> affordances** (`core/mutate.ts`: `create / set-status / set-pr / ac-add /
> ac-status / evidence-add / proof-set`), which rewrite the body *and* append the
> separate audit log — that is what makes the audit history automatic. The
> template above is what those affordances produce and what the parser reads.

## What the validator enforces (structural — it will fail the issue)

- H1 is `<ID>: <Title>`, both non-empty.
- `Assignee` is non-empty — **every issue is assigned**.
- `Status` is one of the five states.
- Each AC has a checkbox, an id, a version `vN`, text, and a `status`.
- The checkbox agrees with the status (`[x]` ⇔ `passed`).
- AC ids are unique.
- A `passed` AC has at least one evidence; each evidence has an image, a commit
  that **exists in git**, that commit is the PR's **current head** (fresh), and
  `acv` equals the AC's **current version** (evidence captured against stale AC
  text is rejected).
- A `passed` AC has a **proof** — an explanation of how the evidence demonstrates
  the criterion, citing real evidence ids. Evidence without proof is incomplete.
- State gates: `ready`/`in-progress` need ≥1 AC; `in-review` needs a PR and every
  AC passed with fresh evidence; `done` needs the PR merged.

## Primitives this SDLC implements

`proof`, `labels`, `relations`, `linkedIssues`, `children`, and `audit` (the
automatic log). `sources` and AC `category` are **not implemented** by this SDLC.
These are the standard task-management primitives; other SDLCs implement a
different subset.

## What the validator can't check — your job when drafting

- **One AC type: dev.** Every AC is something a developer implements and proves
  with a screenshot. No process, approval, or external ACs exist in this profile.
- **Atomic & testable.** One observable behavior per AC, phrased so a reviewer
  can look at a single screenshot and say pass/fail. Split compound ACs.
- **No vacuous ACs.** "Code is clean" is not an AC. "The appointment list shows
  the provider name on each row" is.
- **Versioning discipline.** When you change an AC's wording, bump its `vN`. That
  invalidates any evidence captured against the old text — the validator flags it,
  forcing recapture. Never edit an AC's meaning without bumping.
- **Title & summary** describe the user-facing outcome, not the implementation.

## Lifecycle meaning

| State | Means | Enter when |
|---|---|---|
| draft | being written | created |
| ready | spec complete, not started | dev ACs exist and read well |
| in-progress | being implemented | a develop agent picked it up |
| in-review | implemented, awaiting review | PR open, all ACs passed with fresh evidence |
| done | shipped | PR merged |

When an issue fails the validator, **rewrite the body to satisfy the rule** —
never loosen the rule or weaken an AC to make it pass. The checks exist to keep
the issue writing honest.
