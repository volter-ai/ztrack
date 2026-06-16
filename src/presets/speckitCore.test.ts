import { describe, expect, test } from 'bun:test';
import { buildSpeckitBundle, checkSpeckit, parseSpeckit, SpeckitPreset, SpeckitRootSchema } from './speckitCore.ts';

const HEAD = 'cafe1234beef';
const SPEC = `# Feature Specification: Appointment Search

**Feature Branch**: \`001-appointment-search\`
**Status**: Draft
**Created**: 2026-06-15
**Input**: User description: "search appointments"

## Clarifications

- Session 2026-06-15: filtering is client-side only.

## User Scenarios & Testing

### User Story 1 - Filter by status (Priority: P1)

**Acceptance Scenarios**:

1. **Given** mixed statuses, **When** the member selects Completed, **Then** only completed appointments show

### User Story 2 - Search by provider (Priority: P2)

**Acceptance Scenarios**:

1. **Given** multiple providers, **When** the member searches "Lee", **Then** only Dr. Lee's appointments show

## Requirements

### Functional Requirements

- **FR-001**: System MUST allow members to filter appointments by status.
- **FR-002**: Users MUST be able to search appointments by provider name.

### Key Entities

- **Appointment**: a scheduled visit with a provider, date, and status.
- **Provider**: a clinician with a name and specialty.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Members find a completed appointment in under 10 seconds.

## Edge Cases

- What happens when there are no appointments?

## Assumptions

- Appointments are loaded client-side.
`;
const TASKS = (foundationalDone = true) => `# Tasks: Appointment Search

## Phase 1: Setup

- [x] T001 Create the search route shell

## Phase 2: Foundational (Blocking Prerequisites)

- [${foundationalDone ? 'x' : ' '}] T002 Load appointment data into memory

## Phase 3: User Story 1 - Filter by status (Priority: P1) 🎯 MVP

- [x] T003 [P] [US1] Add status filter control (commit: ${HEAD})
- [x] T004 [US1] Wire filter to list (commit: ${HEAD}) (depends on T003)

## Phase 4: User Story 2 - Search by provider (Priority: P2)

- [ ] T005 [US2] Add provider search field
`;
const PLAN = (gateOk = true) => `# Implementation Plan: Appointment Search

## Technical Context

**Language/Version**: TypeScript 5

**Primary Dependencies**: none (vanilla)

**Storage**: in-memory

## Constitution Check

| Principle | Gate | Status |
|-----------|------|--------|
| Simplicity | smallest design | ✅ PASS |
| Tests | each story has tests | ${gateOk ? '✅ PASS' : '❌ FAIL'} |

## Complexity Tracking

- None
`;
const CONSTITUTION = `# Constitution

## Core Principles

### I. Test-first

Every feature ships with tests.

### II. Simplicity

Prefer the simplest design.

## Governance

Amendments require review; versioning follows semver.
`;
const bundle = (opts: { spec?: string; tasks?: string; plan?: string; extra?: Array<{ path: string; content: string }> } = {}) => buildSpeckitBundle([
  { path: 'specs/001-appointment-search/spec.md', content: opts.spec ?? SPEC },
  { path: 'specs/001-appointment-search/tasks.md', content: opts.tasks ?? TASKS() },
  { path: 'specs/001-appointment-search/plan.md', content: opts.plan ?? PLAN() },
  { path: '.specify/memory/constitution.md', content: CONSTITUTION },
  ...(opts.extra ?? []),
]);
const ctx = { git: { existingCommits: [HEAD] } };

describe('speckit core preset (full process capture)', () => {
  test('captures spec metadata', () => {
    const i = SpeckitRootSchema.parse(parseSpeckit(bundle())).issues[0]!;
    expect(i.metadata).toEqual({ featureBranch: '001-appointment-search', status: 'Draft', created: '2026-06-15', input: 'User description: "search appointments"' });
  });

  test('ACs are user stories with MVP flag + verification evidence', () => {
    const i = SpeckitRootSchema.parse(parseSpeckit(bundle())).issues[0]!;
    expect(i.acceptanceCriteria.map((a) => [a.id, a.priority, a.status, a.mvp])).toEqual([
      ['US1', 'P1', 'done', true],
      ['US2', 'P2', 'pending', false],
    ]);
    expect(i.acceptanceCriteria[0]!.evidence).toEqual([
      { id: 'US1/T003', task: 'T003', commit: HEAD },
      { id: 'US1/T004', task: 'T004', commit: HEAD },
    ]);
    expect(i.status).toBe('in-progress');
  });

  test('captures task phases (setup, foundational; story phases excluded from phases list)', () => {
    const i = SpeckitRootSchema.parse(parseSpeckit(bundle())).issues[0]!;
    expect(i.phases.map((p) => [p.name.replace(/ \(.*/, ''), p.kind])).toEqual([
      ['Phase 1: Setup', 'setup'],
      ['Phase 2: Foundational', 'foundational'],
    ]);
    expect(i.phases[1]!.tasks.map((t) => t.id)).toEqual(['T002']);
  });

  test('captures plan technical context + constitution-check gates', () => {
    const i = SpeckitRootSchema.parse(parseSpeckit(bundle())).issues[0]!;
    expect(i.plan.present).toBe(true);
    expect(i.plan.technicalContext).toEqual([
      { field: 'Language/Version', value: 'TypeScript 5' },
      { field: 'Primary Dependencies', value: 'none (vanilla)' },
      { field: 'Storage', value: 'in-memory' },
    ]);
    expect(i.plan.constitutionGates).toEqual([
      { text: 'Simplicity', passed: true },
      { text: 'Tests', passed: true },
    ]);
  });

  test('captures constitution principles + key entities + edge cases + assumptions + clarifications', () => {
    const i = SpeckitRootSchema.parse(parseSpeckit(bundle())).issues[0]!;
    expect(i.constitution).toEqual({ present: true, principles: ['I. Test-first', 'II. Simplicity'] }); // ### under ## Core Principles; ## Governance excluded
    expect(i.keyEntities.map((e) => e.name)).toEqual(['Appointment', 'Provider']);
    expect(i.edgeCases).toEqual(['What happens when there are no appointments?']);
    expect(i.assumptions).toEqual(['Appointments are loaded client-side.']);
    expect(i.clarifications).toEqual([{ text: 'Session 2026-06-15: filtering is client-side only.' }]);
  });

  test('captures design-artifact presence', () => {
    const i = SpeckitRootSchema.parse(parseSpeckit(bundle({ extra: [
      { path: 'specs/001-appointment-search/research.md', content: '# Research' },
      { path: 'specs/001-appointment-search/data-model.md', content: '# Data Model' },
      { path: 'specs/001-appointment-search/contracts/api.json', content: '{}' },
    ] }))).issues[0]!;
    expect(i.artifacts).toEqual({ research: true, dataModel: true, quickstart: false, contracts: ['specs/001-appointment-search/contracts/api.json'] });
  });

  test('status pipeline: planning when no plan; specifying when clarification', () => {
    const noPlan = buildSpeckitBundle([{ path: 'specs/x/spec.md', content: SPEC }, { path: 'specs/x/tasks.md', content: TASKS() }]);
    expect(SpeckitRootSchema.parse(parseSpeckit(noPlan)).issues[0]!.status).toBe('planning');
    const unclear = SPEC.replace('only completed appointments show', 'only [NEEDS CLARIFICATION: which?] show');
    expect(SpeckitRootSchema.parse(parseSpeckit(bundle({ spec: unclear }))).issues[0]!.status).toBe('specifying');
  });

  test('rule: a story done while foundational tasks are pending is an error', () => {
    const r = checkSpeckit(bundle({ tasks: TASKS(false) }), ctx);
    expect(r.findings.some((f) => f.code === 'speckit_story_done_before_foundational' && f.acId === 'US1')).toBe(true);
    expect(r.ok).toBe(false);
  });

  test('rule: a failed Constitution Check gate is an error', () => {
    const r = checkSpeckit(bundle({ plan: PLAN(false) }), ctx);
    expect(r.findings.some((f) => f.code === 'speckit_constitution_gate_failed')).toBe(true);
  });

  test('rule: needs-clarification + commit-existence', () => {
    expect(checkSpeckit(bundle({ spec: SPEC.replace('by status.', 'by [NEEDS CLARIFICATION: ?].') }), ctx).findings.some((f) => f.code === 'speckit_needs_clarification')).toBe(true);
    expect(checkSpeckit(bundle(), { git: { existingCommits: ['deadbeef'] } }).findings.some((f) => f.code === 'speckit_evidence_commit_not_found')).toBe(true);
  });

  test('clean bundle passes', () => {
    const r = checkSpeckit(bundle(), ctx);
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('idiomatic: no [FR] task tags parsed', () => {
    expect(JSON.stringify(parseSpeckit(bundle()))).not.toContain('requirementId');
  });

  test('require: a feature with no user stories is an error', () => {
    const spec = `# Feature Specification: X\n\n## Requirements\n\n### Functional Requirements\n\n- **FR-001**: do the thing.\n`;
    const r = checkSpeckit(buildSpeckitBundle([{ path: 'specs/x/spec.md', content: spec }]), ctx);
    expect(r.findings.some((f) => f.code === 'speckit_no_user_stories')).toBe(true);
    expect(r.ok).toBe(false);
  });

  test('require: no functional requirements is an error; a story without scenarios warns', () => {
    const spec = `# Feature Specification: X\n\n### User Story 1 - A (Priority: P1)\n\nNo scenarios written.\n`;
    const r = checkSpeckit(buildSpeckitBundle([{ path: 'specs/x/spec.md', content: spec }]), ctx);
    expect(r.findings.some((f) => f.code === 'speckit_no_functional_requirements')).toBe(true);
    expect(r.findings.some((f) => f.code === 'speckit_story_no_scenarios' && f.acId === 'US1')).toBe(true);
  });

  test('require: tasks.md without plan.md is an error; missing constitution warns', () => {
    const r = checkSpeckit(buildSpeckitBundle([{ path: 'specs/x/spec.md', content: SPEC }, { path: 'specs/x/tasks.md', content: TASKS() }]), ctx);
    expect(r.findings.some((f) => f.code === 'speckit_tasks_without_plan')).toBe(true);
    expect(r.findings.some((f) => f.code === 'speckit_no_constitution')).toBe(true);
  });

  test('primitives: none implemented; strict rejects stray fields', () => {
    expect(SpeckitPreset.primitives).toMatchObject({ proof: false, category: false });
    expect(SpeckitRootSchema.safeParse({ issues: [{ id: 'x', extra: 1 }] }).success).toBe(false);
  });

  test("duplicate user-story ids are flagged", () => {
    const s = `# Feature Specification: Foo\n\n## User Scenarios\n\n### User Story 1 - A (Priority: P1)\n- Given x When y Then z\n\n### User Story 1 - B (Priority: P2)\n- Given a When b Then c\n`;
    const r = checkSpeckit(buildSpeckitBundle([{ path: "specs/foo/spec.md", content: s }]));
    expect(r.findings.some((f) => f.code === "speckit_duplicate_ac_id")).toBe(true);
  });


  test("a soft-wrapped task line is still parsed (first line only)", () => {
    const spec = `# Feature Specification: Foo\n\n## User Scenarios\n\n### User Story 1 - A (Priority: P1)\n- Given x When y Then z\n`;
    const tasks = `# Tasks\n\n- [x] T001 [US1] do the thing\n  and wire it up (commit: abc1234)\n`;
    const root = SpeckitRootSchema.parse(parseSpeckit(buildSpeckitBundle([{ path: "specs/foo/spec.md", content: spec }, { path: "specs/foo/tasks.md", content: tasks }])));
    expect(root.issues[0]!.acceptanceCriteria[0]!.tasks.length).toBe(1);
  });

});
