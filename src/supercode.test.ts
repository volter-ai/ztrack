import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ExternalWorkActivitySchema,
  WorkContextResolutionSchema,
  WorkItemReferenceSchema,
  ZTRACK_WORK_ITEM_CONTEXT_KIND,
} from './supercode.ts';

const PromptContextFixtureSchema = z.object({
  id: z.string().optional(),
  kind: z.string().optional(),
  label: z.string(),
  detail: z.string(),
}).strict();

const SessionFixtureSchema = z.object({
  sessionIdentity: z.string(),
  contextTurns: z.array(z.object({
    turn: z.number().int().nonnegative(),
    items: z.array(PromptContextFixtureSchema),
  }).strict()),
  expected: WorkContextResolutionSchema,
}).strict();

const ContractFixtureSchema = z.object({
  schema: z.literal('ztrack.supercode-contract-fixtures.v1'),
  references: z.array(WorkItemReferenceSchema),
  scenarios: z.array(z.object({
    name: z.string(),
    sessions: z.array(SessionFixtureSchema),
  }).strict()),
  activity: z.array(ExternalWorkActivitySchema),
}).strict();

function loadFixture(): z.infer<typeof ContractFixtureSchema> {
  const path = resolve(import.meta.dir, '../fixtures/supercode/contract-v1.json');
  return ContractFixtureSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

describe('ztrack/Supercode browser contract', () => {
  test('the published versioned fixture parses through the authored schemas', () => {
    const fixture = loadFixture();
    expect(fixture.schema).toBe('ztrack.supercode-contract-fixtures.v1');
    expect(fixture.scenarios.length).toBeGreaterThanOrEqual(6);
  });

  test('the fixture pins every association outcome and multiple sessions per issue', () => {
    const fixture = loadFixture();
    const states = fixture.scenarios.flatMap((scenario) => scenario.sessions.map((session) => session.expected.state));
    expect(new Set(states)).toEqual(new Set(['resolved', 'unresolved', 'conflict', 'stale']));
    const shared = fixture.activity.filter((activity) => activity.issueId === 'ZT-1');
    expect(shared.map((activity) => activity.sessionIdentity)).toEqual(['session-active', 'session-review']);
  });

  test('unknown prompt context kinds remain fixture data instead of being rejected or coerced', () => {
    const fixture = loadFixture();
    const kinds = fixture.scenarios.flatMap((scenario) => scenario.sessions)
      .flatMap((session) => session.contextTurns)
      .flatMap((turn) => turn.items)
      .map((item) => item.kind);
    expect(kinds).toContain('design-reference');
    expect(kinds).toContain(ZTRACK_WORK_ITEM_CONTEXT_KIND);
  });

  test('retarget history keeps old turns but makes the latest structured work item current', () => {
    const fixture = loadFixture();
    const retarget = fixture.scenarios.find((scenario) => scenario.name === 'retarget-history')!.sessions[0]!;
    expect(retarget.contextTurns).toHaveLength(2);
    expect(retarget.contextTurns[0]!.items[0]!.id).toContain('/ZT-1');
    expect(retarget.contextTurns[1]!.items[0]!.id).toContain('/ZT-2');
    expect(retarget.expected.state).toBe('resolved');
    expect(retarget.expected.issueId).toBe('ZT-2');
  });

  test('strict schemas reject accidental contract widening', () => {
    expect(() => WorkItemReferenceSchema.parse({
      version: 1,
      provider: 'ztrack',
      uri: 'ztrack://project-a/ZT-1',
      label: 'ZT-1 — First issue',
      hiddenSidecar: true,
    })).toThrow();
  });
});
